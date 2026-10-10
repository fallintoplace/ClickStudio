import { buildMaterializedViewLineage, LINEAGE_TABLE_LIMIT, type LineageSnapshot } from './materialized-view-lineage.js';
import { metadataText, type MetadataReader } from './native-metadata.js';
import { ACTIVITY_LIMIT, activityScopeNote, parseMergeActivity, parseMutationActivity, type MergeSnapshot, type MutationSnapshot } from './storage-activity.js';

export const NATIVE_EXPLORER_KINDS = ['lineage', 'merges', 'mutations'] as const;
export type NativeExplorerKind = typeof NATIVE_EXPLORER_KINDS[number];
export type NativeExplorerRequest = { kind: Extract<NativeExplorerKind, 'lineage'>; database: string } | { kind: Exclude<NativeExplorerKind, 'lineage'>; database: string; table: string };

export function isNativeExplorerKind(value: unknown): value is NativeExplorerKind {
    return NATIVE_EXPLORER_KINDS.some(kind => kind === value);
}
export type NativeExplorerSnapshot = LineageSnapshot | MergeSnapshot | MutationSnapshot;

export function mergeActivityQuery(): string {
    return `SELECT result_part_name, arraySlice(source_part_names, 1, 64) AS source_part_names,
        num_parts > 64 AS source_parts_truncated, progress, elapsed, is_mutation,
        toString(bytes_read_uncompressed) AS bytes_read_uncompressed,
        toString(bytes_written_uncompressed) AS bytes_written_uncompressed, toString(memory_usage) AS memory_usage
        FROM system.merges WHERE database = {database:String} AND table = {table:String}
        ORDER BY elapsed DESC, result_part_name LIMIT ${ACTIVITY_LIMIT + 1}`;
}
export function mutationActivityQuery(): string {
    return `SELECT mutation_id, leftUTF8(command, 4096) AS command, toString(create_time, 'UTC') AS create_time,
        toString(parts_to_do) AS parts_to_do, is_done, leftUTF8(latest_fail_reason, 4096) AS latest_fail_reason,
        toString(latest_fail_time, 'UTC') AS latest_fail_time, latest_failed_part
        FROM system.mutations WHERE database = {database:String} AND table = {table:String}
        ORDER BY is_done ASC, create_time DESC, mutation_id LIMIT ${ACTIVITY_LIMIT + 1}`;
}
export function lineageTablesQuery(columns: ReadonlySet<string>): string {
    const targets = ['target_database', 'target_table'].map(column => columns.has(column) ? column : `'' AS ${column}`);
    const loading = ['loading_dependencies_database', 'loading_dependencies_table'].map(column => columns.has(column) ? `arraySlice(t.${column}, 1, 64) AS ${column}` : `CAST([], 'Array(String)') AS ${column}`);
    const loadingOverflow = columns.has('loading_dependencies_table') ? ' OR length(t.loading_dependencies_table) > 64' : '';
    return `SELECT database, name, engine, leftUTF8(t.create_table_query, 8192) AS create_table_query,
        lengthUTF8(t.create_table_query) > 8192 AS definition_truncated,
        arraySlice(t.dependencies_database, 1, 64) AS dependencies_database,
        arraySlice(t.dependencies_table, 1, 64) AS dependencies_table,
        (length(t.dependencies_table) > 64${loadingOverflow}) AS dependencies_truncated,
        ${[...targets, ...loading].join(', ')}
        FROM system.tables AS t WHERE database = {database:String} AND is_temporary = 0
        ORDER BY engine = 'MaterializedView' DESC, length(t.dependencies_table) > 0 DESC, name LIMIT ${LINEAGE_TABLE_LIMIT + 1}`;
}
export function refreshActivityQuery(columns: ReadonlySet<string>): string {
    const timestamps = ['last_success_time', 'last_refresh_time', 'next_refresh_time'];
    const counters = ['last_success_duration_ms', 'read_rows', 'written_rows'];
    const fields = [
        ...timestamps.map(name => `${columns.has(name) ? `toString(r.${name}, 'UTC')` : 'NULL'} AS ${name}`),
        ...counters.map(name => `${columns.has(name) ? `toString(r.${name})` : 'NULL'} AS ${name}`),
        `${columns.has('progress') ? 'r.progress' : 'NULL'} AS progress`,
        `${columns.has('exception') ? 'leftUTF8(r.exception, 4096)' : "''"} AS exception`,
    ];
    return `SELECT database, view, status, ${fields.join(', ')} FROM system.view_refreshes AS r
        WHERE database = {database:String} ORDER BY view LIMIT ${LINEAGE_TABLE_LIMIT + 1}`;
}

/** The reader accepts only these fixed queries and bound parameters, never user SQL. */
export async function loadNativeExplorer(request: NativeExplorerRequest, read: MetadataReader, signal?: AbortSignal): Promise<NativeExplorerSnapshot> {
    signal?.throwIfAborted();
    const parameters: Record<string, string> = request.kind === 'lineage' ? { database: request.database } : { database: request.database, table: request.table };
    if (request.kind === 'merges') return parseMergeActivity(request.database, request.table, await read(mergeActivityQuery(), parameters));
    if (request.kind === 'mutations') return parseMutationActivity(request.database, request.table, await read(mutationActivityQuery(), parameters));
    const notes = [activityScopeNote, 'Solid edges are insert triggers and write targets. Dashed edges show refresh ordering or catalog-loading dependencies, not complete SELECT lineage.'];
    let columns = new Set<string>();
    try {
        const rows = await read("SELECT name FROM system.columns WHERE database = 'system' AND table = 'tables' LIMIT 500", {});
        columns = new Set(rows.map(row => metadataText(row.name)));
    } catch {
        signal?.throwIfAborted();
        notes.push('Optional metadata-column discovery is unavailable. Targets use the CREATE header where possible.');
    }
    const rows = await read(lineageTablesQuery(columns), parameters);
    signal?.throwIfAborted();
    let refreshes: Awaited<ReturnType<MetadataReader>> = [];
    try {
        const refreshColumns = await read("SELECT name FROM system.columns WHERE database = 'system' AND table = 'view_refreshes' LIMIT 100", {});
        refreshes = await read(refreshActivityQuery(new Set(refreshColumns.map(row => metadataText(row.name)))), parameters);
    }
    catch {
        signal?.throwIfAborted();
        notes.push('Refresh telemetry is unavailable to this reader or ClickHouse version. No refresh state is inferred.');
    }
    signal?.throwIfAborted();
    return buildMaterializedViewLineage(request.database, rows, refreshes, notes);
}
