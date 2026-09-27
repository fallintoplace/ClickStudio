import type { AssistantAction, AssistantSource, Proposal, Result } from '../shared/types.js';

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

const actions = ['ask', 'generate', 'explain', 'repair', 'result', 'performance', 'review'] as const satisfies readonly AssistantAction[];
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');

function recoverSources(value: unknown): AssistantSource[] | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.length > 20) return undefined;
    const sources = value.flatMap((source): AssistantSource[] => {
        if (!record(source) || typeof source.title !== 'string' || source.title.length > 512 || typeof source.url !== 'string' || source.url.length > 2048) return [];
        try {
            const url = new URL(source.url);
            if ((url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password)
                return [{ title: source.title, url: url.href }];
        } catch { return []; }
        return [];
    });
    return sources.length === value.length ? sources : undefined;
}

export const assistantChatsStorageKey = (connectionId: string) => `clickstudio:assistant-chats:${encodeURIComponent(connectionId)}:v1`;

export function createAssistantChat(): AssistantChat {
    const now = new Date().toISOString();
    return { id: crypto.randomUUID(), title: 'New chat', createdAt: now, updatedAt: now, turns: [] };
}

export function createAssistantChatState(): AssistantChatState {
    const chat = createAssistantChat();
    return { version: 1, activeChatId: chat.id, chats: [chat] };
}

function recoverProposal(value: unknown): Proposal | undefined {
    if (!record(value) || typeof value.id !== 'string' || typeof value.owner !== 'string' ||
        typeof value.connectionId !== 'string' || !actions.includes(value.action as AssistantAction) ||
        typeof value.createdAt !== 'string' || typeof value.baseSql !== 'string' || typeof value.responseId !== 'string' ||
        typeof value.model !== 'string' || typeof value.promptVersion !== 'string' || !strings(value.contextSummary) ||
        typeof value.summary !== 'string' || (value.sql !== null && typeof value.sql !== 'string') ||
        !strings(value.assumptions) || !strings(value.tables) || !strings(value.caveats) ||
        !(value.clarification === null || typeof value.clarification === 'string') ||
        !Array.isArray(value.findings) || !['pending', 'accepted', 'rejected'].includes(String(value.decision))) return undefined;
    const sources = recoverSources(value.sources);
    if (value.sources !== undefined && !sources) return undefined;
    const findings = value.findings.every(item => record(item) && ['high', 'medium', 'low'].includes(String(item.severity)) &&
        typeof item.message === 'string' && typeof item.evidence === 'string');
    if (!findings) return undefined;
    return { ...value, ...(sources ? { sources } : {}) } as unknown as Proposal;
}

function recoverRunContext(value: unknown): AssistantChatRunContext | undefined {
    if (!record(value) || JSON.stringify(value).length > 60_000 ||
        (value.evidenceSql !== undefined && (typeof value.evidenceSql !== 'string' || value.evidenceSql.length > 200_000)) ||
        (value.error !== undefined && (typeof value.error !== 'string' || value.error.length > 3_000))) return undefined;
    if (value.result !== undefined) {
        const result = value.result;
        if (!record(result) || !Array.isArray(result.columns) || !Array.isArray(result.rows) ||
            result.columns.length > 100 || result.rows.length > 100 ||
            typeof result.runId !== 'string' || typeof result.queryId !== 'string' ||
            typeof result.createdAt !== 'string' || typeof result.expiresAt !== 'string' ||
            !['complete', 'truncated'].includes(String(result.completeness))) return undefined;
        const columns = result.columns as unknown[];
        const rows = result.rows as unknown[];
        const columnsValid = columns.every(column => record(column) && typeof column.name === 'string' && typeof column.type === 'string');
        const rowsValid = rows.every(row => Array.isArray(row) && row.length === columns.length);
        if (!columnsValid || !rowsValid) return undefined;
    }
    return value as unknown as AssistantChatRunContext;
}

function recoverTurn(value: unknown): AssistantChatTurn | undefined {
    if (!record(value) || typeof value.id !== 'string' || typeof value.question !== 'string' || value.question.length > 4_000 ||
        typeof value.contextSql !== 'string' || value.contextSql.length > 200_000 || typeof value.includeRun !== 'boolean' ||
        !['pending', 'complete', 'failed', 'cancelled'].includes(String(value.status))) return undefined;
    const proposal = value.proposal === undefined ? undefined : recoverProposal(value.proposal);
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
        status: interrupted ? 'cancelled' : value.status as AssistantTurnStatus,
        ...(proposal ? { proposal } : {}),
        ...(interrupted
            ? { error: 'This request was interrupted when the page closed. Send another message to continue.' }
            : typeof value.error === 'string' ? { error: value.error.slice(0, 4_000) } : {}),
    };
}

function recoverChat(value: unknown): AssistantChat | undefined {
    if (!record(value) || typeof value.id !== 'string' || typeof value.title !== 'string' ||
        typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string' || !Array.isArray(value.turns)) return undefined;
    const turns = value.turns.flatMap((turn): AssistantChatTurn[] => {
        const recovered = recoverTurn(turn);
        return recovered ? [recovered] : [];
    });
    return { id: value.id, title: value.title.slice(0, 80), createdAt: value.createdAt, updatedAt: value.updatedAt, turns };
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
