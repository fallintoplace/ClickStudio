import {
    parseMergeTreeParts,
    type MergeTreePart,
    type MergeTreePartsSnapshot,
} from '../shared/parts';
import { api, isFrontendDemoPreview } from './api';
import { CLICKHOUSE_CLOUD_CONNECTION_ID, loadClickHouseCloudTableParts } from './cloud-connection';
import { loadPlaygroundTableParts, PLAYGROUND_CONNECTION_ID } from './playground';

const PART_TEXT_FIELDS = [
    'partition',
    'name',
    'rows',
    'marks',
    'compressedBytes',
    'uncompressedBytes',
    'minBlockNumber',
    'maxBlockNumber',
    'modifiedAt',
    'diskName',
];
const TOTAL_TEXT_FIELDS = ['rows', 'marks', 'compressedBytes', 'uncompressedBytes'];

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMergeTreePart(value: unknown): value is MergeTreePart {
    if (!isRecord(value)) return false;
    return (
        typeof value.active === 'boolean' &&
        typeof value.level === 'number' &&
        Number.isFinite(value.level) &&
        PART_TEXT_FIELDS.every(field => typeof value[field] === 'string')
    );
}

function isPartsSnapshot(value: unknown): value is MergeTreePartsSnapshot {
    if (!isRecord(value)) return false;
    const totals = value.totals;
    return (
        typeof value.database === 'string' &&
        typeof value.table === 'string' &&
        Array.isArray(value.parts) &&
        value.parts.every(isMergeTreePart) &&
        typeof value.totalParts === 'string' &&
        typeof value.activeParts === 'string' &&
        typeof value.inactiveParts === 'string' &&
        typeof value.truncated === 'boolean' &&
        typeof value.measuredAt === 'string' &&
        isRecord(totals) &&
        TOTAL_TEXT_FIELDS.every(field => typeof totals[field] === 'string')
    );
}

function responseShape(value: unknown) {
    if (!isRecord(value))
        return `received ${value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value}`;
    const fields = Object.entries(value)
        .slice(0, 12)
        .map(
            ([key, field]) =>
                `${key}:${field === null ? 'null' : Array.isArray(field) ? 'array' : typeof field}`,
        );
    const firstPart = Array.isArray(value.parts) ? value.parts[0] : undefined;
    const partFields = isRecord(firstPart)
        ? Object.entries(firstPart)
              .slice(0, 12)
              .map(
                  ([key, field]) =>
                      `${key}:${field === null ? 'null' : Array.isArray(field) ? 'array' : typeof field}`,
              )
        : [];
    return `received fields: ${fields.join(', ') || '(none)'}${partFields.length ? `; first part fields: ${partFields.join(', ')}` : ''}`;
}

function textValue(value: unknown, fallback: string) {
    return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback;
}

function normalizePartsSnapshot(value: unknown): MergeTreePartsSnapshot | undefined {
    if (isPartsSnapshot(value)) return value;
    if (
        !isRecord(value) ||
        typeof value.database !== 'string' ||
        typeof value.table !== 'string' ||
        !Array.isArray(value.parts)
    )
        return undefined;
    const parsed = parseMergeTreeParts(value.database, value.table, value.parts);
    const totals = isRecord(value.totals)
        ? {
              rows: textValue(value.totals.rows, parsed.totals.rows),
              marks: textValue(value.totals.marks, parsed.totals.marks),
              compressedBytes: textValue(
                  value.totals.compressedBytes,
                  parsed.totals.compressedBytes,
              ),
              uncompressedBytes: textValue(
                  value.totals.uncompressedBytes,
                  parsed.totals.uncompressedBytes,
              ),
          }
        : parsed.totals;
    const normalized: MergeTreePartsSnapshot = {
        ...parsed,
        totalParts: textValue(value.totalParts, parsed.totalParts),
        activeParts: textValue(value.activeParts, parsed.activeParts),
        inactiveParts: textValue(value.inactiveParts, parsed.inactiveParts),
        truncated: value.truncated === true || parsed.truncated,
        measuredAt: typeof value.measuredAt === 'string' ? value.measuredAt : parsed.measuredAt,
        totals,
    };
    return isPartsSnapshot(normalized) ? normalized : undefined;
}

export async function loadTableParts(
    connectionId: string,
    database: string,
    table: string,
    signal: AbortSignal,
): Promise<MergeTreePartsSnapshot> {
    let snapshot: unknown;
    if (isFrontendDemoPreview && connectionId === PLAYGROUND_CONNECTION_ID) {
        snapshot = await loadPlaygroundTableParts(database, table, signal);
    } else if (connectionId === CLICKHOUSE_CLOUD_CONNECTION_ID) {
        snapshot = await loadClickHouseCloudTableParts(database, table, signal);
    } else {
        snapshot = await api<unknown>(
            `/connections/${encodeURIComponent(connectionId)}/table-parts`,
            {
                method: 'POST',
                body: { database, table },
                signal,
            },
        );
    }
    const normalized = normalizePartsSnapshot(snapshot);
    if (!normalized)
        throw new Error(
            `ClickHouse returned an unexpected MergeTree parts response (${responseShape(snapshot)}). Retry the request or refresh this view.`,
        );
    return normalized;
}
