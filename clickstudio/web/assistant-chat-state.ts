import { MAX_SQL_CHARS } from '../shared/query-limits.js';
import { isResult } from '../shared/run-wire.js';
import { parseAssistantProposal } from '../shared/assistant-proposal.js';
import type { Proposal, Result } from '../shared/types.js';

export type AssistantTurnStatus = 'pending' | 'complete' | 'failed' | 'cancelled';

export interface AssistantChatRunContext {
    result?: Result;
    evidenceSql?: string;
    error?: string;
}

export interface AssistantChatTurn {
    id: string;
    question: string;
    contextSql: string;
    includeRun: boolean;
    runId?: string;
    runContext?: AssistantChatRunContext;
    status: AssistantTurnStatus;
    proposal?: Proposal;
    error?: string;
}

export interface AssistantChat {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    turns: AssistantChatTurn[];
}

export interface AssistantChatState {
    version: 1;
    activeChatId: string;
    chats: AssistantChat[];
}

export const MAX_ASSISTANT_CHAT_TITLE_LENGTH = 4_000;

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

export const assistantChatsStorageKey = (connectionId: string) => `clickstudio:assistant-chats:${encodeURIComponent(connectionId)}:v1`;

export function createAssistantChat(): AssistantChat {
    const now = new Date().toISOString();
    return { id: crypto.randomUUID(), title: 'New chat', createdAt: now, updatedAt: now, turns: [] };
}

export function createAssistantChatState(): AssistantChatState {
    const chat = createAssistantChat();
    return { version: 1, activeChatId: chat.id, chats: [chat] };
}

function recoverRunContext(value: unknown): AssistantChatRunContext | undefined {
    if (!record(value)) return undefined;
    try {
        const serialized = JSON.stringify(value);
        if (typeof serialized !== 'string' || serialized.length > 60_000) return undefined;
    } catch {
        return undefined;
    }
    if (
        (value.evidenceSql !== undefined && (typeof value.evidenceSql !== 'string' || value.evidenceSql.length > MAX_SQL_CHARS)) ||
        (value.error !== undefined && (typeof value.error !== 'string' || value.error.length > 3_000))) return undefined;
    let result: Result | undefined;
    if (value.result !== undefined) {
        const candidate = value.result;
        if (!isResult(candidate) ||
            candidate.columns.length > 100 || candidate.rows.length > 100 ||
            candidate.rows.some(row => row.length !== candidate.columns.length)) return undefined;
        result = candidate;
    }
    return {
        ...(result ? { result } : {}),
        ...(typeof value.evidenceSql === 'string' ? { evidenceSql: value.evidenceSql } : {}),
        ...(typeof value.error === 'string' ? { error: value.error } : {}),
    };
}

function isAssistantTurnStatus(value: unknown): value is AssistantTurnStatus {
    return value === 'pending' || value === 'complete' || value === 'failed' || value === 'cancelled';
}

function recoverTurn(value: unknown): AssistantChatTurn | undefined {
    if (!record(value) || typeof value.id !== 'string' || typeof value.question !== 'string' || value.question.length > 4_000 ||
        typeof value.contextSql !== 'string' || value.contextSql.length > MAX_SQL_CHARS || typeof value.includeRun !== 'boolean' ||
        !isAssistantTurnStatus(value.status)) return undefined;
    const proposal = value.proposal === undefined ? undefined : parseAssistantProposal(value.proposal);
    if (value.proposal !== undefined && !proposal) return undefined;
    const runContext = value.runContext === undefined ? undefined : recoverRunContext(value.runContext);
    if (value.runContext !== undefined && !runContext) return undefined;
    const interrupted = value.status === 'pending';
    return {
        id: value.id,
        question: value.question,
        contextSql: value.contextSql,
        includeRun: value.includeRun,
        ...(typeof value.runId === 'string' ? { runId: value.runId } : {}),
        ...(runContext ? { runContext } : {}),
        status: interrupted ? 'cancelled' : value.status,
        ...(proposal ? { proposal } : {}),
        ...(interrupted
            ? { error: 'This request was interrupted when the page closed. Send another message to continue.' }
            : typeof value.error === 'string' ? { error: value.error.slice(0, 4_000) } : {}),
    };
}

function recoverChat(value: unknown): AssistantChat | undefined {
    if (!record(value) || typeof value.id !== 'string' || typeof value.title !== 'string' ||
        value.title.length > MAX_ASSISTANT_CHAT_TITLE_LENGTH || typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string' || !Array.isArray(value.turns)) return undefined;
    const turns = value.turns.flatMap((turn): AssistantChatTurn[] => {
        const recovered = recoverTurn(turn);
        return recovered ? [recovered] : [];
    });
    const firstQuestion = turns[0]?.question.replace(/\s+/g, ' ').trim();
    const legacyTitle = firstQuestion && firstQuestion.length > 48
        ? `${firstQuestion.slice(0, 47).trimEnd()}…`
        : firstQuestion;
    const title = firstQuestion && value.title === legacyTitle ? firstQuestion : value.title;
    return { id: value.id, title, createdAt: value.createdAt, updatedAt: value.updatedAt, turns };
}

export function recoverAssistantChatState(value: unknown): AssistantChatState | undefined {
    if (!record(value) || value.version !== 1 || !Array.isArray(value.chats)) return undefined;
    const chats = value.chats.flatMap((chat): AssistantChat[] => {
        const recovered = recoverChat(chat);
        return recovered ? [recovered] : [];
    });
    if (!chats.length) return undefined;
    const activeChatId = chats.some(chat => chat.id === value.activeChatId) ? String(value.activeChatId) : chats[0]!.id;
    return { version: 1, activeChatId, chats };
}

export function loadAssistantChatState(key: string, storage: Pick<Storage, 'getItem'> = localStorage): { state: AssistantChatState; error?: string } {
    try {
        const stored = storage.getItem(key);
        const recovered = stored ? recoverAssistantChatState(JSON.parse(stored) as unknown) : undefined;
        return { state: recovered ?? createAssistantChatState() };
    } catch {
        return { state: createAssistantChatState(), error: 'Chat history storage is unavailable. Chats will stay available until this page closes.' };
    }
}
