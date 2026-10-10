import type { CandlestickConfig, ChartConfig, MetricContract, QueryDocument } from './types.js';
import { sameParameters } from './evidence.js';

type EditableDocument = Pick<
    QueryDocument,
    | 'name'
    | 'sql'
    | 'parameters'
    | 'chart'
    | 'kind'
    | 'metric'
    | 'dependencies'
    | 'parentDocumentId'
>;
export type SaveableDraft = EditableDocument & {
    serverId?: string;
    baseRevision?: number;
    activeRunId?: string;
};
export type SaveState =
    'local' | 'checking' | 'saving' | 'saved' | 'changed' | 'conflict' | 'deleted' | 'unavailable';
export interface SaveStatus {
    state: SaveState;
    label: string;
    detail: string;
}

function sameArray<T>(left: readonly T[], right: readonly T[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}
function sameMetric(left?: MetricContract, right?: MetricContract): boolean {
    if (!left || !right) return left === right;
    return (
        left.definition === right.definition &&
        left.grain === right.grain &&
        left.timezone === right.timezone &&
        left.filters === right.filters &&
        left.nullTreatment === right.nullTreatment &&
        sameArray(left.dimensions, right.dimensions) &&
        sameArray(left.sourceColumns, right.sourceColumns)
    );
}

function sameCandlestick(left?: CandlestickConfig, right?: CandlestickConfig): boolean {
    if (!left || !right) return left === right;
    return (
        left.open === right.open &&
        left.high === right.high &&
        left.low === right.low &&
        left.close === right.close &&
        left.bid === right.bid &&
        left.ask === right.ask &&
        left.spread === right.spread &&
        left.quoteActivity === right.quoteActivity
    );
}
function sameChart(left: ChartConfig, right: ChartConfig): boolean {
    return (
        left.kind === right.kind &&
        left.title === right.title &&
        left.x === right.x &&
        left.groupBy === right.groupBy &&
        sameArray(left.ys, right.ys) &&
        sameCandlestick(left.candlestick, right.candlestick)
    );
}

/** Compare saved content, not selection, checkpoints, object insertion order or review metadata. */
export function sameSavedContent(draft: SaveableDraft, saved: QueryDocument): boolean {
    return (
        draft.name === saved.name &&
        draft.sql === saved.sql &&
        draft.kind === saved.kind &&
        draft.activeRunId === saved.runId &&
        draft.parentDocumentId === saved.parentDocumentId &&
        sameParameters(draft.parameters, saved.parameters) &&
        sameArray(draft.dependencies, saved.dependencies) &&
        sameChart(draft.chart, saved.chart) &&
        (draft.kind !== 'metric' || sameMetric(draft.metric, saved.metric))
    );
}

export function draftSaveStatus(
    draft: SaveableDraft,
    connectionId: string,
    saved?: QueryDocument,
    options: { saving?: boolean; pending?: boolean; readError?: boolean } = {},
): SaveStatus {
    if (options.saving)
        return {
            state: 'saving',
            label: 'Saving revision…',
            detail: 'Edits made while saving will remain in your local draft.',
        };
    if (!draft.serverId)
        return {
            state: 'local',
            label: 'Private local draft',
            detail: 'This query is only in this browser. Save it to keep a server copy.',
        };
    if (options.readError)
        return {
            state: 'unavailable',
            label: 'Saved revision could not be checked',
            detail: 'Your draft is unchanged. Retry reading saved files before assuming this draft is saved.',
        };
    if (!saved && options.pending)
        return {
            state: 'checking',
            label: 'Checking saved revision…',
            detail: 'Your local draft is available while saved files load.',
        };
    if (
        !Number.isSafeInteger(draft.baseRevision) ||
        !draft.baseRevision ||
        draft.baseRevision < 1 ||
        !saved ||
        saved.id !== draft.serverId ||
        saved.connectionId !== connectionId ||
        saved.revision < draft.baseRevision
    )
        return {
            state: 'unavailable',
            label: 'Saved revision unavailable',
            detail: 'Keep or export this draft. Its saved revision could not be verified.',
        };
    if (saved.deletedAt)
        return {
            state: 'deleted',
            label: 'Saved file is in trash',
            detail: 'Your local edits remain. Restore the saved file in the library before saving again.',
        };
    if (saved.revision !== draft.baseRevision)
        return {
            state: 'conflict',
            label: `Newer saved revision r${saved.revision}`,
            detail: `This draft is based on r${draft.baseRevision ?? '?'}. Compare revisions in the library; saving will not overwrite newer work.`,
        };
    return sameSavedContent(draft, saved)
        ? {
              state: 'saved',
              label: `Matches saved revision r${saved.revision}`,
              detail: 'The current content and selected run match the last checked server revision. Browser autosave is separate.',
          }
        : {
              state: 'changed',
              label: `Unsaved changes since r${saved.revision}`,
              detail: 'The draft differs from its saved revision. Save a revision to keep these changes on the server.',
          };
}

/** Remember script statement runs in the existing draft history without duplicating IDs. */
export function rememberRunIds(current: string[], incoming: readonly string[]): string[] {
    const seen = new Set(current),
        added: string[] = [];
    for (const id of incoming) {
        if (!seen.has(id)) {
            seen.add(id);
            added.push(id);
        }
    }
    return added.length ? [...current, ...added] : current;
}
