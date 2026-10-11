export const WORKLOAD_WINDOWS = [15, 60, 360, 1440] as const;
export type WorkloadWindow = (typeof WORKLOAD_WINDOWS)[number];
export const QUERY_LOG_SOURCES = ['user_query_log', 'query_log'] as const;
export type QueryLogSource = (typeof QUERY_LOG_SOURCES)[number];
export function isQueryLogSource(value: unknown): value is QueryLogSource {
    return QUERY_LOG_SOURCES.some(source => source === value);
}

export interface WorkloadFamily {
    hash: string;
    query: string;
    executions: number;
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
    totalMs: number;
    readRows: string;
    readBytes: string;
    peakMemory: string;
    errors: number;
    lastSeen: string;
}

export interface WorkloadPoint {
    hash: string;
    queryId: string;
    at: string;
    durationMs: number;
    memory: string;
    readRows: string;
    readBytes: string;
    failed: boolean;
}

export interface WorkloadSnapshot {
    connectionId: string;
    minutes: WorkloadWindow;
    scope: 'local-user';
    queryLogSource: QueryLogSource;
    families: WorkloadFamily[];
    points: WorkloadPoint[];
    truncated: boolean;
}

type Row = Record<string, unknown>;

const stringValue = (value: unknown, fallback = '') =>
    value === undefined || value === null ? fallback : String(value);
const countValue = (value: unknown) => {
    const count = Number(value);
    return Number.isFinite(count) && count > 0
        ? Math.min(Number.MAX_SAFE_INTEGER, Math.floor(count))
        : 0;
};
const numberValue = (value: unknown) => {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : 0;
};
const boundedText = (value: unknown, max: number) =>
    stringValue(value).replace(/\s+/g, ' ').trim().slice(0, max);

export function workloadFamiliesQuery(source: QueryLogSource) {
    return `SELECT toString(normalized_query_hash) AS hash, normalizeQuery(any(query)) AS query,
        count() AS executions, quantile(0.5)(query_duration_ms) AS p50_ms,
        quantile(0.95)(query_duration_ms) AS p95_ms, quantile(0.99)(query_duration_ms) AS p99_ms,
        toString(sum(query_duration_ms)) AS total_ms, toString(sum(read_rows)) AS read_rows,
        toString(sum(read_bytes)) AS read_bytes, toString(max(memory_usage)) AS peak_memory,
        countIf(type IN ('ExceptionWhileProcessing', 'ExceptionBeforeStart')) AS errors,
        toString(max(event_time)) AS last_seen
    FROM system.${source}
    WHERE event_time >= now() - toIntervalMinute({minutes:UInt16})
        AND user = {username:String} AND is_initial_query = 1
        AND query_id NOT LIKE 'clickstudio-inspect-%'
        AND type IN ('QueryFinish', 'ExceptionWhileProcessing', 'ExceptionBeforeStart')
    GROUP BY normalized_query_hash
    ORDER BY sum(query_duration_ms) DESC, executions DESC
    LIMIT 101`;
}

export function workloadPointsQuery(source: QueryLogSource) {
    return `SELECT toString(normalized_query_hash) AS hash, query_id AS query_id,
        toString(event_time) AS at, query_duration_ms AS duration_ms,
        toString(memory_usage) AS memory, toString(read_rows) AS read_rows,
        toString(read_bytes) AS read_bytes, type != 'QueryFinish' AS failed
    FROM system.${source}
    WHERE event_time >= now() - toIntervalMinute({minutes:UInt16})
        AND user = {username:String} AND is_initial_query = 1
        AND query_id NOT LIKE 'clickstudio-inspect-%'
        AND type IN ('QueryFinish', 'ExceptionWhileProcessing', 'ExceptionBeforeStart')
    ORDER BY event_time DESC
    LIMIT 501`;
}

export function parseWorkloadSnapshot(
    connectionId: string,
    minutes: WorkloadWindow,
    queryLogSource: QueryLogSource,
    familyRows: readonly Row[],
    pointRows: readonly Row[],
): WorkloadSnapshot {
    const families = familyRows
        .slice(0, 100)
        .map(row => ({
            hash: stringValue(row.hash),
            query: boundedText(row.query, 240),
            executions: countValue(row.executions),
            p50Ms: numberValue(row.p50_ms),
            p95Ms: numberValue(row.p95_ms),
            p99Ms: numberValue(row.p99_ms),
            totalMs: numberValue(row.total_ms),
            readRows: stringValue(row.read_rows, '0'),
            readBytes: stringValue(row.read_bytes, '0'),
            peakMemory: stringValue(row.peak_memory, '0'),
            errors: countValue(row.errors),
            lastSeen: stringValue(row.last_seen),
        }))
        .filter(family => family.hash.length > 0);
    const points = pointRows
        .slice(0, 500)
        .map(row => ({
            hash: stringValue(row.hash),
            queryId: boundedText(row.query_id, 160),
            at: stringValue(row.at),
            durationMs: numberValue(row.duration_ms),
            memory: stringValue(row.memory, '0'),
            readRows: stringValue(row.read_rows, '0'),
            readBytes: stringValue(row.read_bytes, '0'),
            failed:
                row.failed === true ||
                row.failed === 1 ||
                row.failed === '1' ||
                row.failed === 'true',
        }))
        .filter(point => point.hash.length > 0 && point.queryId.length > 0);
    return {
        connectionId,
        minutes,
        scope: 'local-user',
        queryLogSource,
        families,
        points,
        truncated: familyRows.length > 100 || pointRows.length > 500,
    };
}
