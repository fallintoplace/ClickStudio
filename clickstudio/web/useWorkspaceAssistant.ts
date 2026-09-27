import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
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

type AssistantPhase = 'preparing' | 'generating' | 'deciding';
type AssistantRunContext = { result?: Result; evidenceSql?: string; error?: string };
type AssistantRunContextLoader = (signal: AbortSignal) => Promise<AssistantRunContext>;
type ActiveAssistantRequest = { id: number; key: string; draftId: string; controller: AbortController };

export function useDefaultAssistantRunContext(
    runId: string | undefined,
    includeRun: boolean,
    assistantBusy: boolean,
    setIncludeRun: (include: boolean) => void,
) {
    const defaultedRunIdRef = useRef<string | undefined>(undefined);
    useEffect(() => {
        if (!runId) {
            defaultedRunIdRef.current = undefined;
            if (includeRun) setIncludeRun(false);
            return;
        }
        if (defaultedRunIdRef.current === runId) return;
        defaultedRunIdRef.current = runId;
        if (!assistantBusy) setIncludeRun(true);
    }, [assistantBusy, includeRun, runId, setIncludeRun]);
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
    const [assistantPhase, setAssistantPhase] = useState<AssistantPhase>();
    const [assistantErrors, setAssistantErrors] = useState<Record<string, string>>({});
    const [assistantNotices, setAssistantNotices] = useState<Record<string, string>>({});
    const [includeRun, setIncludeRunState] = useState(false);
    const requestRef = useRef(0);
    const activeRequestRef = useRef<ActiveAssistantRequest | undefined>(undefined);

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
    const assistantCancelable = activeRequestRef.current?.key === assistantKey;
    const assistantError = assistantErrors[active.id] ?? '';
    const assistantNotice = assistantNotices[active.id] ?? '';
    const setAssistantError = (error: string) => setAssistantErrors(current => ({ ...current, [active.id]: error }));
    const assistantProposal = assistantProposalState && (
        assistantProposalState.key === assistantKey ||
        (assistantProposalState.value.decision === 'accepted' && assistantProposalState.value.sql === active.sql)
    ) ? assistantProposalState.value : undefined;

    const cancelAssistantRequest = (reason: 'cancelled' | 'context-changed', expectedRequestId?: number) => {
        const request = activeRequestRef.current;
        if (!request || (expectedRequestId !== undefined && request.id !== expectedRequestId)) return false;
        activeRequestRef.current = undefined;
        request.controller.abort();
        requestRef.current++;
        setAssistantBusyKey(undefined);
        setAssistantPhase(undefined);
        setAssistantErrors(current => ({ ...current, [request.draftId]: '' }));
        setAssistantNotices(current => ({
            ...current,
            [request.draftId]: reason === 'cancelled'
                ? 'Request cancelled.'
                : 'Request cancelled because the question or context changed. Ask again to use the updated context.',
        }));
        return true;
    };
    const cancelAssistantRequestRef = useRef(cancelAssistantRequest);
    cancelAssistantRequestRef.current = cancelAssistantRequest;

    useEffect(() => {
        const request = activeRequestRef.current;
        if (request && request.key !== assistantKey)
            cancelAssistantRequestRef.current('context-changed', request.id);
    }, [assistantKey]);

    useEffect(() => () => {
        activeRequestRef.current?.controller.abort();
        activeRequestRef.current = undefined;
    }, []);

    const changeAssistantQuestion = (question: string) => {
        cancelAssistantRequest('context-changed');
        requestRef.current++;
        setAssistantBusyKey(undefined);
        setAssistantPhase(undefined);
        setAssistantQuestion(question);
        setAssistantProposalForDraft(active.id, undefined);
        setAssistantError('');
    };

    const setIncludeRun = (include: boolean) => {
        if (include === includeRun) return;
        cancelAssistantRequest('context-changed');
        requestRef.current++;
        setAssistantBusyKey(undefined);
        setAssistantPhase(undefined);
        setIncludeRunState(include);
        setAssistantProposalForDraft(active.id, undefined);
        setAssistantError('');
    };

    const requestAssistantSql = async (schema?: Schema, serverVersion?: string, database?: string, loadRunContext?: AssistantRunContextLoader) => {
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
        const activeRequest = activeRequestRef.current;
        if (activeRequest?.key === requestKey) return;
        if (activeRequest)
            cancelAssistantRequest('context-changed', activeRequest.id);
        const requestId = ++requestRef.current;
        const controller = new AbortController();
        activeRequestRef.current = { id: requestId, key: requestKey, draftId, controller };
        assistantKeyRef.current = requestKey;
        setAssistantBusyKey(requestKey);
        setAssistantPhase(includeRun ? 'preparing' : 'generating');
        setAssistantError('');
        setAssistantNotices(current => ({ ...current, [draftId]: '' }));
        setAssistantProposalForDraft(draftId, undefined);
        try {
            const runContext = includeRun ? await loadRunContext?.(controller.signal) : undefined;
            controller.signal.throwIfAborted();
            if (includeRun && !runContext) throw new Error('Could not load the selected run context. Try again.');
            setAssistantPhase('generating');
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
                result: includeRun ? boundedAssistantResult(runContext?.result) : undefined,
                evidenceSql: includeRun ? runContext?.evidenceSql : undefined,
                error: includeRun ? runContext?.error : undefined,
            }, { signal: controller.signal });
            if (!isProposal(proposal)) throw new Error('The assistant returned incomplete data. Try again.');
            if (requestRef.current !== requestId) return;
            if (assistantKeyRef.current !== requestKey) {
                cancelAssistantRequest('context-changed', requestId);
                return;
            }
            setAssistantProposalForDraft(draftId, { key: requestKey, value: proposal });
        } catch (caught) {
            if (activeRequestRef.current?.id === requestId && requestRef.current === requestId) {
                if (assistantKeyRef.current !== requestKey)
                    cancelAssistantRequest('context-changed', requestId);
                else setAssistantError(message(caught));
            }
        } finally {
            if (activeRequestRef.current?.id === requestId) {
                activeRequestRef.current = undefined;
                setAssistantBusyKey(undefined);
                setAssistantPhase(undefined);
            }
        }
    };

    const decideAssistantProposal = async (decision: 'accepted' | 'rejected') => {
        if (!assistantProposal || assistantProposal.decision !== 'pending' || assistantProposal.baseSql !== active.sql) return;
        if (activeRequestRef.current)
            cancelAssistantRequest('context-changed', activeRequestRef.current.id);
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
        setAssistantPhase('deciding');
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
            if (requestRef.current === requestId) {
                setAssistantBusyKey(undefined);
                setAssistantPhase(undefined);
            }
        }
    };

    return {
        assistantQuestion,
        changeAssistantQuestion,
        assistantProposal,
        assistantBusy,
        assistantCancelable,
        assistantPhase,
        assistantError,
        assistantNotice,
        includeRun,
        setIncludeRun,
        requestAssistantSql,
        cancelAssistantRequest: () => cancelAssistantRequest('cancelled'),
        decideAssistantProposal,
    };
}
