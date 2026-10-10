import { MAX_SQL_CHARS } from '../shared/query-limits.js';
import type { ChartConfig, QueryDocument } from '../shared/types.js';
import type { SaveableDraft } from '../shared/workspace-view.js';
export const SAMPLE_SQL = "SELECT\n    toDate('2026-01-01') + number AS day,\n    (number + 1) * 10 AS events\nFROM numbers(7)\nORDER BY day";
export interface Checkpoint {
    id: string;
    at: string;
    reason: string;
    sql: string;
    from: number;
    to: number;
    parentRevision?: number;
}
export interface InvalidatedSource {
    database: string;
    table: string;
    runId: string;
}
/** Saved fields follow the shared document contract; only browser state lives here. */
export interface Draft extends SaveableDraft {
    id: string;
    runIds: string[];
    scriptId?: string;
    parentRunId?: string;
    checkpoints: Checkpoint[];
    from: number;
    to: number;
    invalidatedSource?: InvalidatedSource;
}
export interface WorkspaceState {
    version: 1;
    tabs: Draft[];
    activeId: string | undefined;
    closedTabs?: Draft[];
    recoveryWarning?: string;
}
export const newDraft = (name = 'Untitled Query', sql = ''): Draft => ({ id: crypto.randomUUID(), name, sql, parameters: {}, chart: { kind: 'table', x: 0, ys: [], title: 'Query result' }, runIds: [], checkpoints: [], from: 0, to: 0, kind: 'query', dependencies: [] });
export const MAX_TABS = 30;
export const MAX_CLOSED_TABS = 10;
export function draftFromDocument(document: QueryDocument): Draft {
    return {
        ...newDraft(document.name, document.sql),
        serverId: document.id,
        baseRevision: document.revision,
        parameters: { ...document.parameters },
        chart: { ...document.chart, ys: [...document.chart.ys], ...(document.chart.candlestick ? { candlestick: { ...document.chart.candlestick } } : {}) },
        runIds: document.runId ? [document.runId] : [],
        activeRunId: document.runId,
        parentDocumentId: document.parentDocumentId,
        kind: document.kind,
        metric: document.metric ? {
            ...document.metric,
            dimensions: [...document.metric.dimensions],
            sourceColumns: [...document.metric.sourceColumns],
        } : undefined,
        dependencies: [...document.dependencies],
    };
}

const record = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback;
const id = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(value) ? value : undefined;
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const strings = (value: unknown): string[] => array(value).filter((v): v is string => typeof v === 'string');
const position = (value: unknown, length: number) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(length, Math.trunc(value))) : 0;
const index = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const chartIndex = (value: unknown): value is number => index(value) && value <= 499;
const revision = (value: unknown) => index(value) && value > 0 ? value : undefined;
const chartKinds = ['table', 'number', 'line', 'bar', 'scatter', 'heatmap', 'candlestick'] as const satisfies readonly ChartConfig['kind'][];
const isChartKind = (value: unknown): value is ChartConfig['kind'] => chartKinds.some(kind => kind === value);
function recoveredCandlestick(value: unknown): ChartConfig['candlestick'] {
    if (!record(value)) return undefined;
    return {
        ...(chartIndex(value.open) ? { open: value.open } : {}), ...(chartIndex(value.high) ? { high: value.high } : {}),
        ...(chartIndex(value.low) ? { low: value.low } : {}), ...(chartIndex(value.close) ? { close: value.close } : {}),
        ...(chartIndex(value.bid) ? { bid: value.bid } : {}),
        ...(chartIndex(value.ask) ? { ask: value.ask } : {}),
        ...(chartIndex(value.spread) ? { spread: value.spread } : {}),
        ...(chartIndex(value.quoteActivity) ? { quoteActivity: value.quoteActivity } : {}),
    };
}

/** Browser storage is untrusted input; preserve SQL while repairing optional metadata. */
export function recoverDraft(value: unknown): Draft | undefined {
    if (!record(value) || typeof value.sql !== 'string' || value.sql.length > MAX_SQL_CHARS)
        return undefined;
    const draft = newDraft(text(value.name, 'Recovered.sql'), value.sql);
    const chart = record(value.chart) ? value.chart : {};
    const candlestick = recoveredCandlestick(chart.candlestick);
    const metric = record(value.metric) ? value.metric : undefined;
    const source = record(value.invalidatedSource) ? value.invalidatedSource : undefined;
    const invalidatedRunId = source ? id(source.runId) : undefined;
    const invalidatedSource = source
        && typeof source.database === 'string' && source.database.length > 0 && source.database.length <= 128
        && typeof source.table === 'string' && source.table.length > 0 && source.table.length <= 128
        && invalidatedRunId
        ? { database: source.database, table: source.table, runId: invalidatedRunId }
        : undefined;
    const from = position(value.from, draft.sql.length), to = position(value.to, draft.sql.length);
    return {
        ...draft, id: id(value.id) ?? draft.id,
        serverId: id(value.serverId), baseRevision: revision(value.baseRevision),
        parameters: record(value.parameters) ? Object.fromEntries(Object.entries(value.parameters).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) : {},
        chart: {
            kind: isChartKind(chart.kind) ? chart.kind : 'table',
            x: chartIndex(chart.x) ? chart.x : 0,
            ...(chartIndex(chart.groupBy) ? { groupBy: chart.groupBy } : {}),
            ys: array(chart.ys).filter(chartIndex), title: text(chart.title, 'Query result'),
            ...(candlestick ? { candlestick } : {}),
        },
        runIds: [...new Set(strings(value.runIds).filter(v => id(v)))],
        activeRunId: id(value.activeRunId), scriptId: id(value.scriptId),
        parentRunId: id(value.parentRunId), parentDocumentId: id(value.parentDocumentId),
        from: Math.min(from, to), to: Math.max(from, to),
        kind: value.kind === 'metric' || value.kind === 'snippet' ? value.kind : 'query',
        metric: metric ? {
            definition: text(metric.definition), grain: text(metric.grain), dimensions: strings(metric.dimensions),
            timezone: text(metric.timezone), filters: text(metric.filters), nullTreatment: text(metric.nullTreatment),
            sourceColumns: strings(metric.sourceColumns),
        } : undefined,
        dependencies: strings(value.dependencies).filter(v => id(v)),
        invalidatedSource,
        checkpoints: array(value.checkpoints).flatMap((point): Checkpoint[] => {
            if (!record(point) || typeof point.sql !== 'string' || point.sql.length > MAX_SQL_CHARS)
                return [];
            const a = position(point.from, point.sql.length), b = position(point.to, point.sql.length);
            return [{ id: id(point.id) ?? crypto.randomUUID(), at: text(point.at), reason: text(point.reason, 'Recovered checkpoint'),
                sql: point.sql, from: Math.min(a, b), to: Math.max(a, b), parentRevision: revision(point.parentRevision) }];
        }).slice(0, 30),
    };
}

export function recover(key: string, storage?: Pick<Storage, 'getItem'>): WorkspaceState {
    try {
        const value: unknown = JSON.parse((storage ?? localStorage).getItem(key) ?? 'null');
        if (record(value) && value.version === 1 && (Array.isArray(value.tabs) || Array.isArray(value.closedTabs))) {
            const seen = new Set<string>();
            const recoverTabs = (input: readonly unknown[], limit: number) => {
                const recovered: Draft[] = [];
                for (const value of input) {
                    const draft = recoverDraft(value);
                    if (!draft) continue;
                    // Duplicated local IDs must not make edits affect two tabs.
                    if (seen.has(draft.id)) draft.id = crypto.randomUUID();
                    seen.add(draft.id);
                    recovered.push(draft);
                    if (recovered.length === limit) break;
                }
                return recovered;
            };
            const storedTabs = array(value.tabs);
            const storedClosed = array(value.closedTabs);
            const tabs = recoverTabs(storedTabs, MAX_TABS);
            const closedTabs = recoverTabs(storedClosed, MAX_CLOSED_TABS);
            const incomplete = !Array.isArray(value.tabs) || tabs.length !== storedTabs.length ||
                closedTabs.length !== storedClosed.length || (value.closedTabs !== undefined && !Array.isArray(value.closedTabs));
            // A damaged open-tab list must not erase an otherwise usable closed history.
            if (!tabs.length)
                tabs.push(newDraft('Getting started.sql', SAMPLE_SQL));
            return {
                version: 1, tabs, closedTabs,
                activeId: tabs.find(t => t.id === value.activeId)?.id ?? tabs[0]?.id,
                recoveryWarning: incomplete ? 'Some stored tabs could not be recovered. Valid SQL drafts were kept.' : undefined,
            };
        }
    }
    catch { /* Corrupt or unavailable browser storage never prevents opening the editor. */ }
    const draft = newDraft('Getting started.sql', SAMPLE_SQL);
    return { version: 1, tabs: [draft], activeId: draft.id, closedTabs: [] };
}

/** Closing affects local navigation only: no server deletion or query cancellation. */
export function closeDraft(state: WorkspaceState, draftId: string): WorkspaceState {
    const i = state.tabs.findIndex(d => d.id === draftId);
    if (i === -1) return state;
    const closed = state.tabs[i]!;
    const tabs = state.tabs.filter(d => d.id !== draftId);
    const openTabs = tabs.length ? tabs : [newDraft()];
    return { ...state, tabs: openTabs,
        activeId: state.activeId === draftId ? openTabs[Math.min(i, openTabs.length - 1)]?.id : state.activeId ?? openTabs[0]?.id,
        closedTabs: [closed, ...(state.closedTabs ?? []).filter(d => d.id !== draftId)].slice(0, MAX_CLOSED_TABS),
    };
}

export function reopenDraft(state: WorkspaceState, draftId?: string): WorkspaceState {
    const closedTabs = state.closedTabs ?? [];
    const draftIndex = draftId ? closedTabs.findIndex(draft => draft.id === draftId) : closedTabs.length ? 0 : -1;
    const draft = closedTabs[draftIndex];
    if (!draft || state.tabs.length >= MAX_TABS) return state;
    // Keep the saved revision, selection, checkpoints and run references unchanged.
    const reopened = state.tabs.some(d => d.id === draft.id) ? { ...draft, id: crypto.randomUUID() } : draft;
    return { ...state, tabs: [...state.tabs, reopened], activeId: reopened.id, closedTabs: closedTabs.filter((_, index) => index !== draftIndex) };
}

export function checkpoint(draft: Draft, reason: string): Draft {
    const point = { id: crypto.randomUUID(), at: new Date().toISOString(), reason, sql: draft.sql, from: draft.from, to: draft.to, parentRevision: draft.baseRevision };
    // Repeating a command without changing SQL does not create a useful second full snapshot.
    return { ...draft, checkpoints: [point, ...draft.checkpoints.filter(existing => existing.sql !== draft.sql)].slice(0, 30) };
}
