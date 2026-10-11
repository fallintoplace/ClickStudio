import {
    metadataFlag,
    metadataInteger,
    metadataNumber,
    metadataProgress,
    metadataStrings,
    metadataText,
    metadataTime,
    type MetadataRow,
    type MetadataSnapshot,
} from '../metadata.js';

export const ACTIVITY_LIMIT = 50;
export interface MergeActivity {
    id: string;
    resultPart: string;
    sourceParts: string[];
    sourcePartsTruncated: boolean;
    progress?: number;
    elapsedSeconds?: number;
    bytesRead?: string;
    bytesWritten?: string;
    memory?: string;
    isMutation: boolean;
}
export interface MutationActivity {
    id: string;
    command: string;
    createdAt?: string;
    partsRemaining?: string;
    done?: boolean;
    latestFailure?: string;
    latestFailureAt?: string;
    failedPart?: string;
}
export interface MergeSnapshot extends MetadataSnapshot {
    kind: 'merges';
    table: string;
    items: MergeActivity[];
}
export interface MutationSnapshot extends MetadataSnapshot {
    kind: 'mutations';
    table: string;
    items: MutationActivity[];
}
export const activityScopeNote =
    'Metadata from the connected server; this view does not issue a cluster-wide aggregation.';

export function parseMergeActivity(
    database: string,
    table: string,
    rows: MetadataRow[],
    observedAt = new Date().toISOString(),
): MergeSnapshot {
    return {
        kind: 'merges',
        database,
        table,
        observedAt,
        source: 'clickhouse',
        notes: [activityScopeNote],
        truncated: rows.length > ACTIVITY_LIMIT,
        items: rows.slice(0, ACTIVITY_LIMIT).map(row => ({
            id: metadataText(row.result_part_name),
            resultPart: metadataText(row.result_part_name),
            sourceParts: metadataStrings(row.source_part_names),
            sourcePartsTruncated: metadataFlag(row.source_parts_truncated) === true,
            progress: metadataProgress(row.progress),
            elapsedSeconds: metadataNumber(row.elapsed),
            bytesRead: metadataInteger(row.bytes_read_uncompressed),
            bytesWritten: metadataInteger(row.bytes_written_uncompressed),
            memory: metadataInteger(row.memory_usage),
            isMutation: metadataFlag(row.is_mutation) === true,
        })),
    };
}
export function parseMutationActivity(
    database: string,
    table: string,
    rows: MetadataRow[],
    observedAt = new Date().toISOString(),
): MutationSnapshot {
    return {
        kind: 'mutations',
        database,
        table,
        observedAt,
        source: 'clickhouse',
        notes: [
            activityScopeNote,
            'Parts remaining is not a percentage. Zero remaining parts can still be waiting for an insert; completion comes from is_done.',
        ],
        truncated: rows.length > ACTIVITY_LIMIT,
        items: rows.slice(0, ACTIVITY_LIMIT).map(row => ({
            id: metadataText(row.mutation_id),
            command: metadataText(row.command),
            createdAt: metadataTime(row.create_time),
            partsRemaining: metadataInteger(row.parts_to_do),
            done: metadataFlag(row.is_done),
            latestFailure: metadataText(row.latest_fail_reason) || undefined,
            latestFailureAt: metadataTime(row.latest_fail_time),
            failedPart: metadataText(row.latest_failed_part) || undefined,
        })),
    };
}
export function mutationStatus(item: MutationActivity): string {
    if (item.done === true) return 'Completed';
    if (item.latestFailure) return 'Incomplete · last attempt failed';
    if (item.done === undefined) return 'Completion unknown';
    return item.partsRemaining === '0' ? 'Waiting for completion' : 'Pending / processing';
}
