import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { AssistantAction, Proposal, Schema } from '../shared/types';
import { isFrontendDemoPreview, message, post } from './api';
import { checkpoint, type Draft, type WorkspaceState } from './workspace-state';
import type { Locale } from './i18n';
import type { AssistantContext, SpeechRecognitionLike } from './workspace-types';
import { useScopedValue } from './useScopedValue';

function isAssistantContext(value: unknown): value is Pick<AssistantContext, 'id' | 'summary'> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const context = value as { id?: unknown; summary?: unknown };
    return typeof context.id === 'string' && Array.isArray(context.summary) && context.summary.every(item => typeof item === 'string');
}

function isProposal(value: unknown): value is Proposal {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const proposal = value as { id?: unknown; baseSql?: unknown; decision?: unknown; sql?: unknown; summary?: unknown; assumptions?: unknown; caveats?: unknown; findings?: unknown };
    return typeof proposal.id === 'string' && typeof proposal.baseSql === 'string' &&
        ['pending', 'accepted', 'rejected'].includes(String(proposal.decision)) &&
        (proposal.sql === null || typeof proposal.sql === 'string') && typeof proposal.summary === 'string' &&
        Array.isArray(proposal.assumptions) && Array.isArray(proposal.caveats) && Array.isArray(proposal.findings);
}

function assistantContextKey(
    connectionId: string,
    draftId: string,
    sql: string,
    parameters: Record<string, string>,
    runId: string | undefined,
    includeResult: boolean,
    action: AssistantAction,
    question: string,
) {
    return JSON.stringify({
        connectionId,
        draftId,
        sql,
        parameters: Object.entries(parameters).sort(([left], [right]) => left.localeCompare(right)),
        runId,
        includeResult,
        action,
        question,
    });
}

export function useWorkspaceAssistant({
    active,
    activeRunId,
    connectionId,
    trusted,
    locale,
    workspaceRef,
    setWorkspace,
}: {
    active: Draft;
    activeRunId?: string;
    connectionId: string;
    trusted: boolean;
    locale: Locale;
    workspaceRef: { current: WorkspaceState };
    setWorkspace: Dispatch<SetStateAction<WorkspaceState>>;
}) {
    const [assistantAction, setAssistantAction] = useState<AssistantAction>('generate');
    const [assistantQuestion, setAssistantQuestion] = useState('');
    const [assistantContextState, setAssistantContextForDraft] = useScopedValue<AssistantContext | undefined>(active.id);
    const [assistantProposalState, setAssistantProposalForDraft] = useScopedValue<{ key: string; value: Proposal } | undefined>(active.id);
    const [assistantBusyKey, setAssistantBusyKey] = useState<string>();
    const [assistantErrors, setAssistantErrors] = useState<Record<string, string>>({});
    const [includeResult, setIncludeResultState] = useState(false);
    const [voiceListening, setVoiceListening] = useState(false);
    const [voiceError, setVoiceError] = useState('');
    const recognitionRef = useRef<SpeechRecognitionLike | undefined>(undefined);
    const promptBeforeVoiceRef = useRef('');
    const requestRef = useRef(0);

    const assistantKey = assistantContextKey(
        connectionId,
        active.id,
        active.sql,
        active.parameters,
        activeRunId,
        includeResult,
        assistantAction,
        assistantQuestion,
    );
    const assistantKeyRef = useRef(assistantKey);
    assistantKeyRef.current = assistantKey;
    const assistantBusy = assistantBusyKey === assistantKey;
    const assistantError = assistantErrors[active.id] ?? '';
    const setAssistantError = (error: string) => setAssistantErrors(current => ({ ...current, [active.id]: error }));
    const assistantContext = assistantContextState?.key === assistantKey ? assistantContextState : undefined;
    const assistantProposal = assistantProposalState && (
        assistantProposalState.key === assistantKey ||
        (assistantProposalState.value.decision === 'accepted' && assistantProposalState.value.sql === active.sql)
    ) ? assistantProposalState.value : undefined;

    useEffect(() => () => recognitionRef.current?.abort(), []);

    const clearAssistantReview = () => {
        requestRef.current++;
        setAssistantBusyKey(undefined);
        setAssistantContextForDraft(active.id, undefined);
        setAssistantProposalForDraft(active.id, undefined);
        setAssistantError('');
    };

    const setAssistantContext = (context?: AssistantContext) => {
        requestRef.current++;
        setAssistantBusyKey(undefined);
        setAssistantContextForDraft(active.id, context);
    };

    const setAssistantProposal = (proposal?: Proposal) => {
        requestRef.current++;
        setAssistantBusyKey(undefined);
        setAssistantProposalForDraft(active.id, proposal ? { key: assistantKey, value: proposal } : undefined);
    };

    const changeAssistantAction = (value: AssistantAction) => {
        setAssistantAction(value);
        setAssistantContext(undefined);
        setAssistantProposal(undefined);
    };

    const changeAssistantQuestion = (question: string) => {
        requestRef.current++;
        setAssistantBusyKey(undefined);
        setAssistantQuestion(question);
        setAssistantContextForDraft(active.id, undefined);
        setAssistantProposalForDraft(active.id, undefined);
        setAssistantError('');
    };

    const setIncludeResult = (include: boolean) => {
        if (include === includeResult) return;
        setIncludeResultState(include);
        clearAssistantReview();
    };

    const startVoiceInput = () => {
        if (voiceListening) {
            recognitionRef.current?.stop();
            return;
        }
        const SpeechRecognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            setVoiceError('Voice input is not available in this browser. You can type your question instead.');
            return;
        }
        setVoiceError('');
        promptBeforeVoiceRef.current = assistantQuestion.trimEnd();
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = ({ en: 'en-US', de: 'de-DE', es: 'es-ES', nl: 'nl-NL', zh: 'zh-CN', ru: 'ru-RU' } as const)[locale];
        recognition.onresult = event => {
            const transcript = Array.from(event.results)
                .map(result => result[0]?.transcript ?? '')
                .join(' ')
                .replace(/\s+/g, ' ')
                .trim();
            const base = promptBeforeVoiceRef.current;
            setAssistantQuestion(`${base}${base && transcript ? ' ' : ''}${transcript}`);
            requestRef.current++;
            setAssistantBusyKey(undefined);
            setAssistantContextForDraft(active.id, undefined);
            setAssistantProposalForDraft(active.id, undefined);
        };
        recognition.onerror = event => {
            setVoiceError(event.error === 'not-allowed'
                ? 'Microphone access was denied. Allow access or type your question instead.'
                : `Voice input stopped (${event.error}). You can continue by typing.`);
            setVoiceListening(false);
        };
        recognition.onend = () => setVoiceListening(false);
        recognitionRef.current = recognition;
        try {
            recognition.start();
            setVoiceListening(true);
        } catch {
            setVoiceError('Voice input could not start. Check microphone access or type your question instead.');
            setVoiceListening(false);
        }
    };

    const prepareAssistantContext = async (action = assistantAction, question = assistantQuestion) => {
        if (!trusted) return;
        if (!question.trim() && action === 'generate') {
            setAssistantError('Describe what you want to learn from your data first.');
            return;
        }
        const draftId = active.id;
        const requestKey = assistantContextKey(
            connectionId,
            draftId,
            active.sql,
            active.parameters,
            activeRunId,
            includeResult,
            action,
            question,
        );
        const requestId = ++requestRef.current;
        setAssistantBusyKey(requestKey);
        setAssistantError('');
        setAssistantAction(action);
        try {
            const result = await post<unknown>('/assistant/context', {
                connectionId,
                action,
                question,
                sql: active.sql,
                runId: activeRunId,
                includeResult,
            });
            if (!isAssistantContext(result)) throw new Error('The context preview returned incomplete data. Try again.');
            if (requestRef.current !== requestId || assistantKeyRef.current !== requestKey) return;
            setAssistantContextForDraft(draftId, { ...result, key: requestKey });
            setAssistantProposalForDraft(draftId, undefined);
        } catch (caught) {
            if (requestRef.current === requestId && assistantKeyRef.current === requestKey) setAssistantError(message(caught));
        } finally {
            if (requestRef.current === requestId) setAssistantBusyKey(undefined);
        }
    };

    const requestAssistantProposal = async () => {
        if (!assistantContext || assistantBusy) return;
        const context = assistantContext;
        if (context.key !== assistantKeyRef.current) {
            setAssistantError('The draft changed. Preview the current context before asking for a proposal.');
            return;
        }
        if (!window.confirm(`Send the reviewed SQL and selected context to the configured AI provider? ${assistantContext.summary.join(' ')}`)) return;
        const draftId = active.id;
        const requestId = ++requestRef.current;
        setAssistantBusyKey(context.key);
        setAssistantError('');
        try {
            const proposal = await post<unknown>('/assistant/proposals', { contextId: context.id, consent: true });
            if (!isProposal(proposal)) throw new Error('The AI proposal returned incomplete data. Try again.');
            if (requestRef.current !== requestId || assistantKeyRef.current !== context.key) return;
            setAssistantProposalForDraft(draftId, { key: context.key, value: proposal });
        } catch (caught) {
            if (requestRef.current === requestId && assistantKeyRef.current === context.key) setAssistantError(message(caught));
        } finally {
            if (requestRef.current === requestId) setAssistantBusyKey(undefined);
        }
    };

    const requestAssistantSql = async (schema?: Schema, serverVersion?: string) => {
        if (!trusted) return;
        if (!assistantQuestion.trim()) {
            setAssistantError('Describe the SQL you want to generate first.');
            return;
        }
        if (!schema) {
            setAssistantError('Refresh the ClickHouse schema before generating SQL.');
            return;
        }
        const draftId = active.id;
        const requestKey = assistantContextKey(
            connectionId,
            draftId,
            active.sql,
            active.parameters,
            activeRunId,
            includeResult,
            'generate',
            assistantQuestion,
        );
        const requestId = ++requestRef.current;
        assistantKeyRef.current = requestKey;
        setAssistantBusyKey(requestKey);
        setAssistantError('');
        setAssistantAction('generate');
        setAssistantContextForDraft(draftId, undefined);
        setAssistantProposalForDraft(draftId, undefined);
        try {
            const proposal = await post<unknown>('/assistant/sql', {
                connectionId,
                question: assistantQuestion,
                sql: active.sql,
                schema,
                serverVersion,
            });
            if (!isProposal(proposal)) throw new Error('SQL generation returned incomplete data. Try again.');
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
        const requestKey = assistantContextKey(
            connectionId,
            draftId,
            active.sql,
            active.parameters,
            activeRunId,
            includeResult,
            assistantAction,
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
        assistantAction,
        changeAssistantAction,
        assistantQuestion,
        changeAssistantQuestion,
        assistantContext,
        assistantProposal,
        assistantBusy,
        assistantError,
        includeResult,
        setIncludeResult,
        voiceListening,
        voiceError,
        startVoiceInput,
        prepareAssistantContext,
        requestAssistantProposal,
        requestAssistantSql,
        decideAssistantProposal,
    };
}
