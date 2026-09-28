import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { parseAssistantProposal } from '../shared/assistant-proposal';
import type { AssistantConversationMessage, Result, Schema } from '../shared/types';
import { isFrontendDemoPreview, message, post } from './api';
import { useAssistantChats } from './useAssistantChats';
import type { AssistantChatTurn } from './assistant-chat-state';
import { checkpoint, type Draft, type WorkspaceState } from './workspace-state';

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

const MAX_ASSISTANT_HISTORY_BYTES = 24_000;
const MAX_ASSISTANT_HISTORY_TURNS = 8;
const MAX_RECENT_ASSISTANT_TURN_BYTES = 12_000;

function compactConversationTurn(turn: AssistantChatTurn): AssistantConversationMessage[] {
    const messages: AssistantConversationMessage[] = [{
        role: 'user',
        content: JSON.stringify({ question: turn.question.slice(0, 2_000) }),
    }];
    if (turn.proposal) {
        messages.push({ role: 'assistant', content: JSON.stringify({
            summary: turn.proposal.summary.slice(0, 1_500),
            clarification: turn.proposal.clarification?.slice(0, 500) ?? null,
        }) });
    } else if (turn.error) {
        messages.push({ role: 'assistant', content: turn.error.slice(0, 800) });
    }
    return messages;
}

function detailedConversationTurn(turn: AssistantChatTurn): AssistantConversationMessage[] {
    const messages: AssistantConversationMessage[] = [{ role: 'user', content: JSON.stringify({
        question: turn.question,
        sql: turn.contextSql,
        includeRun: turn.includeRun,
        ...(turn.runId ? { runId: turn.runId } : {}),
        ...(turn.runContext ? { runContext: turn.runContext } : {}),
    }) }];
    if (turn.proposal) {
        const { summary, clarification, sql, alternatives, assumptions, tables, caveats, sources, findings, decision, quality } = turn.proposal;
        messages.push({ role: 'assistant', content: JSON.stringify({ summary, clarification, sql, alternatives, assumptions, tables, caveats, sources, findings, decision, quality }) });
    } else if (turn.error) {
        messages.push({ role: 'assistant', content: turn.error });
    }
    return messages;
}

function assistantContextKey(
    connectionId: string,
    draftId: string,
    chatId: string,
    sql: string,
    parameters: Record<string, string>,
    runId: string | undefined,
    includeRun: boolean,
) {
    return JSON.stringify({
        connectionId,
        draftId,
        chatId,
        sql,
        parameters: Object.entries(parameters).sort(([left], [right]) => left.localeCompare(right)),
        runId,
        includeRun,
    });
}

function conversationHistory(turns: readonly AssistantChatTurn[]): AssistantConversationMessage[] {
    const completed = turns.filter(turn => turn.status !== 'pending').slice(-MAX_ASSISTANT_HISTORY_TURNS);
    const bundles = completed.map((turn, index) => {
        const compact = compactConversationTurn(turn);
        if (index !== completed.length - 1) return compact;
        const detailed = detailedConversationTurn(turn);
        return new TextEncoder().encode(JSON.stringify(detailed)).length <= MAX_RECENT_ASSISTANT_TURN_BYTES
            ? detailed
            : compact;
    });
    const history = () => bundles.flat();
    const bytes = () => new TextEncoder().encode(JSON.stringify(history())).length;
    while (bundles.length > 1 && bytes() > MAX_ASSISTANT_HISTORY_BYTES) bundles.shift();
    if (bytes() > MAX_ASSISTANT_HISTORY_BYTES && bundles.length)
        bundles[0] = compactConversationTurn(completed[completed.length - 1]!);
    return bytes() <= MAX_ASSISTANT_HISTORY_BYTES ? history() : [];
}

function chatTitle(question: string) {
    const title = question.replace(/\s+/g, ' ').trim();
    return title.length > 48 ? `${title.slice(0, 47).trimEnd()}…` : title;
}

type AssistantPhase = 'preparing' | 'generating' | 'deciding';
type AssistantRunContext = { result?: Result; evidenceSql?: string; error?: string };
type AssistantRunContextLoader = (signal: AbortSignal) => Promise<AssistantRunContext>;
type AssistantActivity = { chatId: string; turnId: string; phase: AssistantPhase };
type ActiveAssistantRequest = { id: number; contextKey: string; chatId: string; draftId: string; turnId: string; controller: AbortController };

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
        if (assistantBusy || defaultedRunIdRef.current === runId) return;
        defaultedRunIdRef.current = runId;
        setIncludeRun(true);
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
    const {
        chats: assistantChats,
        activeChat,
        storageError: assistantChatStorageError,
        updateChat,
        selectChat,
        renameChat,
        createChat,
        deleteChat,
    } = useAssistantChats(connectionId);
    const [questionDrafts, setQuestionDrafts] = useState<Record<string, string>>({});
    const [activity, setActivity] = useState<AssistantActivity>();
    const [assistantErrors, setAssistantErrors] = useState<Record<string, string>>({});
    const [includeRun, setIncludeRunState] = useState(false);
    const requestRef = useRef(0);
    const activeRequestRef = useRef<ActiveAssistantRequest | undefined>(undefined);
    const assistantQuestion = questionDrafts[activeChat.id] ?? '';
    const contextKey = assistantContextKey(connectionId, active.id, activeChat.id, active.sql, active.parameters, activeRunId, includeRun);
    const contextKeyRef = useRef(contextKey);
    contextKeyRef.current = contextKey;
    const assistantBusy = activity?.chatId === activeChat.id;
    const assistantPhase = assistantBusy ? activity.phase : undefined;
    const assistantCancelable = assistantBusy && assistantPhase !== 'deciding';
    const assistantError = assistantErrors[activeChat.id] ?? '';
    const setAssistantError = (error: string, chatId = activeChat.id) => setAssistantErrors(current => ({ ...current, [chatId]: error }));

    const cancelAssistantRequest = (reason: 'cancelled' | 'context-changed', expectedRequestId?: number) => {
        const request = activeRequestRef.current;
        if (!request || (expectedRequestId !== undefined && request.id !== expectedRequestId)) return false;
        activeRequestRef.current = undefined;
        request.controller.abort();
        requestRef.current++;
        setActivity(current => current?.turnId === request.turnId ? undefined : current);
        updateChat(request.chatId, chat => ({
            ...chat,
            updatedAt: new Date().toISOString(),
            turns: chat.turns.map(turn => turn.id === request.turnId && turn.status === 'pending'
                ? { ...turn, status: 'cancelled', error: reason === 'cancelled'
                    ? 'Request cancelled.'
                    : 'Request cancelled because the workspace context changed. Send another message to use the current context.' }
                : turn),
        }));
        return true;
    };
    const cancelAssistantRequestRef = useRef(cancelAssistantRequest);
    cancelAssistantRequestRef.current = cancelAssistantRequest;

    useEffect(() => {
        const request = activeRequestRef.current;
        if (request && request.contextKey !== contextKey)
            cancelAssistantRequestRef.current('context-changed', request.id);
    }, [contextKey]);

    useEffect(() => () => {
        activeRequestRef.current?.controller.abort();
        activeRequestRef.current = undefined;
    }, []);

    const changeAssistantQuestion = (question: string) => {
        setQuestionDrafts(current => ({ ...current, [activeChat.id]: question }));
        setAssistantError('');
    };

    const setIncludeRun = (include: boolean) => {
        if (include === includeRun) return;
        cancelAssistantRequest('context-changed');
        requestRef.current++;
        setActivity(undefined);
        setIncludeRunState(include);
        setAssistantError('');
    };

    const newAssistantChat = () => {
        cancelAssistantRequest('context-changed');
        const chatId = createChat(Boolean(assistantQuestion.trim()));
        setAssistantError('', chatId);
        return chatId;
    };

    const selectAssistantChat = (chatId: string) => {
        if (chatId === activeChat.id) return;
        cancelAssistantRequest('context-changed');
        selectChat(chatId);
    };

    const deleteAssistantChat = (chatId: string) => {
        if (activeRequestRef.current?.chatId === chatId)
            cancelAssistantRequest('context-changed');
        deleteChat(chatId);
        if (assistantChats.length === 1 && activeRunId) setIncludeRunState(true);
        setQuestionDrafts(current => { const next = { ...current }; delete next[chatId]; return next; });
        setAssistantErrors(current => { const next = { ...current }; delete next[chatId]; return next; });
    };

    const requestAssistantSql = async (schema?: Schema, serverVersion?: string, database?: string, loadRunContext?: AssistantRunContextLoader) => {
        if (!trusted) return;
        const question = assistantQuestion.trim();
        if (!question) {
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
        const chatId = activeChat.id;
        const draftId = active.id;
        const turnId = crypto.randomUUID();
        const requestContextKey = contextKey;
        const history = conversationHistory(activeChat.turns);
        const now = new Date().toISOString();
        const turn: AssistantChatTurn = {
            id: turnId,
            question,
            contextSql: active.sql,
            includeRun,
            ...(includeRun && activeRunId ? { runId: activeRunId } : {}),
            status: 'pending' as const,
        };
        if (activeRequestRef.current)
            cancelAssistantRequest('context-changed', activeRequestRef.current.id);
        const requestId = ++requestRef.current;
        const controller = new AbortController();
        activeRequestRef.current = { id: requestId, contextKey: requestContextKey, chatId, draftId, turnId, controller };
        setActivity({ chatId, turnId, phase: includeRun ? 'preparing' : 'generating' });
        setAssistantError('');
        setQuestionDrafts(current => ({ ...current, [chatId]: '' }));
        updateChat(chatId, chat => ({
            ...chat,
            title: chat.turns.length || chat.title !== 'New chat' ? chat.title : chatTitle(question),
            updatedAt: now,
            turns: [...chat.turns, turn],
        }));
        try {
            const runContext = includeRun ? await loadRunContext?.(controller.signal) : undefined;
            controller.signal.throwIfAborted();
            if (includeRun && !runContext) throw new Error('Could not load the selected run context. Try again.');
            const storedRunContext = includeRun && runContext ? {
                ...(runContext.result ? { result: boundedAssistantResult(runContext.result) } : {}),
                ...(runContext.evidenceSql ? { evidenceSql: runContext.evidenceSql } : {}),
                ...(runContext.error ? { error: runContext.error } : {}),
            } : undefined;
            if (storedRunContext && JSON.stringify(storedRunContext).length > 60_000)
                throw new Error('The selected run context is too large to keep in this chat. Start a new chat or select a smaller run.');
            if (storedRunContext)
                updateChat(chatId, chat => ({
                    ...chat,
                    turns: chat.turns.map(current => current.id === turnId ? { ...current, runContext: storedRunContext } : current),
                }));
            setActivity({ chatId, turnId, phase: 'generating' });
            const response = await post<unknown>('/assistant/sql', {
                connectionId,
                question,
                conversation: history,
                sql: active.sql,
                schema: { ...schema, columns: schema.columns.map(({ database: columnDatabase, table, name, type }) => ({ database: columnDatabase, table, name, type })) },
                serverVersion,
                database,
                action: 'ask',
                runId: includeRun ? activeRunId : undefined,
                includeRun,
                result: storedRunContext?.result,
                evidenceSql: storedRunContext?.evidenceSql,
                error: storedRunContext?.error,
            }, { signal: controller.signal });
            const proposal = parseAssistantProposal(response);
            if (!proposal) throw new Error('The assistant returned incomplete data. Try again.');
            if (requestRef.current !== requestId) return;
            if (contextKeyRef.current !== requestContextKey) {
                cancelAssistantRequest('context-changed', requestId);
                return;
            }
            updateChat(chatId, chat => ({
                ...chat,
                updatedAt: new Date().toISOString(),
                turns: chat.turns.map(current => current.id === turnId ? { ...current, status: 'complete', proposal } : current),
            }));
        } catch (caught) {
            if (activeRequestRef.current?.id === requestId && requestRef.current === requestId) {
                const error = message(caught);
                updateChat(chatId, chat => ({
                    ...chat,
                    updatedAt: new Date().toISOString(),
                    turns: chat.turns.map(current => current.id === turnId ? { ...current, status: 'failed', error } : current),
                }));
            }
        } finally {
            if (activeRequestRef.current?.id === requestId) {
                activeRequestRef.current = undefined;
                setActivity(current => current?.turnId === turnId ? undefined : current);
            }
        }
    };

    const decideAssistantProposal = async (turnId: string, decision: 'accepted' | 'rejected') => {
        const turn = activeChat.turns.find(item => item.id === turnId || item.proposal?.id === turnId);
        const proposal = turn?.proposal;
        if (!turn || !proposal || proposal.decision !== 'pending' || (decision === 'accepted' && proposal.baseSql !== active.sql)) return;
        if (activeRequestRef.current)
            cancelAssistantRequest('context-changed', activeRequestRef.current.id);
        const chatId = activeChat.id;
        const draftId = active.id;
        const requestId = ++requestRef.current;
        const chatTurnId = turn.id;
        setActivity({ chatId, turnId: chatTurnId, phase: 'deciding' });
        setAssistantError('');
        try {
            const response: unknown = isFrontendDemoPreview && proposal.owner === 'vercel-session'
                ? { ...proposal, decision, decidedAt: new Date().toISOString() }
                : await post<unknown>(
                    `/assistant/proposals/${encodeURIComponent(proposal.id)}/decision`,
                    { decision, connectionId, currentSql: active.sql },
                );
            const reviewed = parseAssistantProposal(response);
            if (!reviewed) throw new Error('The assistant returned incomplete data. Try again.');
            updateChat(chatId, chat => ({
                ...chat,
                updatedAt: new Date().toISOString(),
                turns: chat.turns.map(current => current.id === chatTurnId ? { ...current, proposal: reviewed } : current),
            }));
            const currentDraft = workspaceRef.current.tabs.find(draft => draft.id === draftId);
            const reviewedSql = reviewed.sql;
            if (decision === 'accepted' && reviewedSql !== null && currentDraft?.sql === proposal.baseSql) {
                setWorkspace(current => ({
                    ...current,
                    tabs: current.tabs.map(draft => draft.id === draftId
                        ? { ...checkpoint(draft, 'Before accepted AI proposal'), sql: reviewedSql, from: 0, to: 0 }
                        : draft),
                }));
            }
        } catch (caught) {
            if (requestRef.current === requestId) setAssistantError(message(caught));
        } finally {
            setActivity(current => current?.turnId === chatTurnId ? undefined : current);
        }
    };

    return {
        assistantQuestion,
        changeAssistantQuestion,
        assistantTurns: activeChat.turns,
        assistantChats,
        activeAssistantChatId: activeChat.id,
        assistantChatStorageError,
        newAssistantChat,
        selectAssistantChat,
        renameAssistantChat: renameChat,
        deleteAssistantChat,
        assistantBusy,
        assistantCancelable,
        assistantPhase,
        assistantError,
        assistantNotice: '',
        includeRun,
        setIncludeRun,
        requestAssistantSql,
        cancelAssistantRequest: () => cancelAssistantRequest('cancelled'),
        decideAssistantProposal,
    };
}
