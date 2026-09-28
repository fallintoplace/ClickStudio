import type { MergeTreePart, MergeTreePartsSnapshot } from '../shared/parts';
import { api, isFrontendDemoPreview } from './api';
import { loadPlaygroundTableParts, PLAYGROUND_CONNECTION_ID } from './playground';

const PART_TEXT_FIELDS = ['partition', 'name', 'rows', 'marks', 'compressedBytes', 'uncompressedBytes', 'minBlockNumber', 'maxBlockNumber', 'modifiedAt', 'diskName'];
const TOTAL_TEXT_FIELDS = ['rows', 'marks', 'compressedBytes', 'uncompressedBytes'];

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMergeTreePart(value: unknown): value is MergeTreePart {
    if (!isRecord(value)) return false;
    return typeof value.active === 'boolean' && typeof value.level === 'number' && Number.isFinite(value.level) &&
        PART_TEXT_FIELDS.every(field => typeof value[field] === 'string');
}

function isPartsSnapshot(value: unknown): value is MergeTreePartsSnapshot {
    if (!isRecord(value)) return false;
    const totals = value.totals;
    return typeof value.database === 'string' && typeof value.table === 'string' &&
        Array.isArray(value.parts) && value.parts.every(isMergeTreePart) &&
        typeof value.totalParts === 'string' && typeof value.activeParts === 'string' &&
        typeof value.inactiveParts === 'string' && typeof value.truncated === 'boolean' &&
        typeof value.measuredAt === 'string' && isRecord(totals) &&
        TOTAL_TEXT_FIELDS.every(field => typeof totals[field] === 'string');
}

export async function loadTableParts(connectionId: string, database: string, table: string, signal: AbortSignal): Promise<MergeTreePartsSnapshot> {
    const snapshot: unknown = isFrontendDemoPreview && connectionId === PLAYGROUND_CONNECTION_ID
        ? await loadPlaygroundTableParts(database, table, signal)
        : await api<unknown>(`/connections/${encodeURIComponent(connectionId)}/table-parts`, {
            method: 'POST',
            body: { database, table },
            signal,
        });
    if (!isPartsSnapshot(snapshot)) throw new Error('The server returned invalid table-parts data. Reopen the visualizer to try again.');
    return snapshot;
}
