import { useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { Proposal, Result, Schema } from '../shared/types';
import { isFrontendDemoPreview, message, post } from './api';
import { checkpoint, type Draft, type WorkspaceState } from './workspace-state';
import { useScopedValue } from './useScopedValue';

function isProposal(value: unknown): value is Proposal {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const proposal = value as { id?: unknown; baseSql?: unknown; decision?: unknown; sql?: unknown; summary?: unknown; assumptions?: unknown; caveats?: unknown; findings?: unknown };
    return typeof proposal.id === 'string' && typeof proposal.baseSql === 'string' &&
        ['pending', 'accepted', 'rejected'].includes(String(proposal.decision)) &&
        (proposal.sql === null || typeof proposal.sql === 'string') && typeof proposal.summary === 'string' &&
        Array.isArray(proposal.assumptions) && Array.isArray(proposal.caveats) && Array.isArray(proposal.findings);
}

function boundedAssistantResult(result?: Result): Result | undefined {
    if (!result) return undefined;
    const columns = result.columns.slice(0, 100);
    const bounded: Result = { ...result, columns, rows: [] };
    let bytes = JSON.stringify(bounded).length;
    for (const row of result.rows) {
        const boundedRow = row.slice(0, columns.length);
        const rowBytes = JSON.stringify(boundedRow).length;
        if (bounded.rows.length >= 100 || bytes + rowBytes > 24_000) break;
        bounded.rows.push(boundedRow);
        bytes += rowBytes;
    }
    return bounded;
}

function assistantRequestKey(
    connectionId: string,
    draftId: string,
    sql: string,
    parameters: Record<string, string>,
    runId: string | undefined,
    includeRun: boolean,
    question: string,
) {
    return JSON.stringify({
        connectionId,
        draftId,
        sql,
        parameters: Object.entries(parameters).sort(([left], [right]) => left.localeCompare(right)),
        runId,
        includeRun,
        question,
    });
}

export function useWorkspaceAssistant({
    active,
    activeRunId,
    connectionId,
    trusted,
    workspaceRef,
    setWorkspace,
}: {
    active: Draft;
    activeRunId?: string;
    connectionId: string;
    trusted: boolean;
    workspaceRef: { current: WorkspaceState };
    setWorkspace: Dispatch<SetStateAction<WorkspaceState>>;
}) {
    const [assistantQuestion, setAssistantQuestion] = useState('');
    const [assistantProposalState, setAssistantProposalForDraft] = useScopedValue<{ key: string; value: Proposal } | undefined>(active.id);
    const [assistantBusyKey, setAssistantBusyKey] = useState<string>();
    const [assistantErrors, setAssistantErrors] = useState<Record<string, string>>({});
    const [includeRun, setIncludeRunState] = useState(false);
    const requestRef = useRef(0);

    const assistantKey = assistantRequestKey(
        connectionId,
        active.id,
        active.sql,
        active.parameters,
        activeRunId,
        includeRun,
        assistantQuestion,
    );
    const assistantKeyRef = useRef(assistantKey);
    assistantKeyRef.current = assistantKey;
    const assistantBusy = assistantBusyKey === assistantKey;
    const assistantError = assistantErrors[active.id] ?? '';
    const setAssistantError = (error: string) => setAssistantErrors(current => ({ ...current, [active.id]: error }));
    const assistantProposal = assistantProposalState && (
        assistantProposalState.key === assistantKey ||
        (assistantProposalState.value.decision === 'accepted' && assistantProposalState.value.sql === active.sql)
    ) ? assistantProposalState.value : undefined;

    const clearAssistantReview = () => {
        requestRef.current++;
        setAssistantBusyKey(undefined);
        setAssistantProposalForDraft(active.id, undefined);
        setAssistantError('');
    };

    const changeAssistantQuestion = (question: string) => {
        requestRef.current++;
        setAssistantBusyKey(undefined);
        setAssistantQuestion(question);
        setAssistantProposalForDraft(active.id, undefined);
        setAssistantError('');
    };

    const setIncludeRun = (include: boolean) => {
        if (include === includeRun) return;
        setIncludeRunState(include);
        clearAssistantReview();
    };

    const requestAssistantSql = async (schema?: Schema, serverVersion?: string, database?: string, result?: Result, evidenceSql?: string, runError?: string) => {
        if (!trusted) return;
        if (!assistantQuestion.trim()) {
            setAssistantError('Ask a question or describe the SQL you want first.');
            return;
        }
        if (!schema) {
            setAssistantError('Refresh the ClickHouse schema before asking the assistant.');
            return;
        }
        if (includeRun && !activeRunId) {
            setAssistantError('Run a query before including its run context.');
            return;
        }
        const draftId = active.id;
        const requestKey = assistantRequestKey(
            connectionId,
            draftId,
            active.sql,
            active.parameters,
            activeRunId,
            includeRun,
            assistantQuestion,
        );
        const requestId = ++requestRef.current;
        assistantKeyRef.current = requestKey;
        setAssistantBusyKey(requestKey);
        setAssistantError('');
        setAssistantProposalForDraft(draftId, undefined);
        try {
            const proposal = await post<unknown>('/assistant/sql', {
                connectionId,
                question: assistantQuestion,
                sql: active.sql,
                schema: { ...schema, columns: schema.columns.map(({ database: columnDatabase, table, name, type }) => ({ database: columnDatabase, table, name, type })) },
                serverVersion,
                database,
                action: 'ask',
                runId: includeRun ? activeRunId : undefined,
                includeRun,
                result: includeRun ? boundedAssistantResult(result) : undefined,
                evidenceSql: includeRun ? evidenceSql : undefined,
                error: includeRun ? runError : undefined,
            });
            if (!isProposal(proposal)) throw new Error('The assistant returned incomplete data. Try again.');
            if (requestRef.current !== requestId || assistantKeyRef.current !== requestKey) return;
            setAssistantProposalForDraft(draftId, { key: requestKey, value: proposal });
        } catch (caught) {
            if (requestRef.current === requestId && assistantKeyRef.current === requestKey) setAssistantError(message(caught));
        } finally {
            if (requestRef.current === requestId) setAssistantBusyKey(undefined);
        }
    };

    const decideAssistantProposal = async (decision: 'accepted' | 'rejected') => {
        if (!assistantProposal || assistantProposal.decision !== 'pending' || assistantProposal.baseSql !== active.sql) return;
        const proposal = assistantProposal;
        const draftId = active.id;
        const requestKey = assistantRequestKey(
            connectionId,
            draftId,
            active.sql,
            active.parameters,
            activeRunId,
            includeRun,
            assistantQuestion,
        );
        const requestId = ++requestRef.current;
        setAssistantBusyKey(requestKey);
        setAssistantError('');
        try {
            const reviewed = isFrontendDemoPreview && proposal.owner === 'vercel-session'
                ? { ...proposal, decision, decidedAt: new Date().toISOString() }
                : await post<Proposal>(
                    `/assistant/proposals/${encodeURIComponent(proposal.id)}/decision`,
                    { decision, connectionId, currentSql: active.sql },
                );
            setAssistantProposalForDraft(draftId, { key: requestKey, value: reviewed }, true);
            const currentDraft = workspaceRef.current.tabs.find(draft => draft.id === draftId);
            if (decision === 'accepted' && reviewed.sql !== null && currentDraft?.sql === proposal.baseSql) {
                setWorkspace(current => ({
                    ...current,
                    tabs: current.tabs.map(draft => draft.id === draftId
                        ? { ...checkpoint(draft, 'Before accepted AI proposal'), sql: reviewed.sql!, from: 0, to: 0 }
                        : draft),
                }));
            }
        } catch (caught) {
            if (requestRef.current === requestId && assistantKeyRef.current === requestKey) setAssistantError(message(caught));
        } finally {
            if (requestRef.current === requestId) setAssistantBusyKey(undefined);
        }
    };

    return {
        assistantQuestion,
        changeAssistantQuestion,
        assistantProposal,
        assistantBusy,
        assistantError,
        includeRun,
        setIncludeRun,
        requestAssistantSql,
        decideAssistantProposal,
    };
}
