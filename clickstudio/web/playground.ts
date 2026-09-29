import { type Column, type Json, type Row, type Schema } from '../shared/types.js';
import { lexSql, splitSql } from '../shared/sql.js';
import { isSchema } from '../shared/schema.js';
import { mergeTreePartsQuery, parseMergeTreeParts, type MergeTreePartsSnapshot } from '../shared/parts.js';
import { decodeClickHouseStringValue } from '../shared/playground-values.js';
import { ClickHouseError, createClient } from '@clickhouse/client-web';
import { PLAYGROUND_CONNECTION_ID, PLAYGROUND_URL } from '../shared/playground.js';
export { PLAYGROUND_CONNECTION, PLAYGROUND_CONNECTION_ID } from '../shared/playground.js';

export const PLAYGROUND_STARTER_ID = 'playground-starter-github-events';
export const PLAYGROUND_STARTER_NAME = 'GitHub events.sql';
export const PLAYGROUND_STARTER_SQL = `SELECT
    event_type,
    repo_name,
    actor_login,
    created_at
FROM github.events
LIMIT 50`;
const PLAYGROUND_USER = 'demo';
const PLAYGROUND_FORMAT = 'JSONCompactStringsEachRowWithNamesAndTypes';
const REQUEST_TIMEOUT_MS = 65_000;
const MAX_RESULT_ROWS = 1_000;
const MAX_RESPONSE_BYTES = 2_000_000;
const RESPONSE_BYTE_WARNING_THRESHOLD = 0.9;
const SCHEMA_MAX_TABLES = 1_000;
const SCHEMA_MAX_COLUMNS = 1_000;
const SCHEMA_CACHE_KEY = 'clickstudio:playground-schema:v1';
const SCHEMA_CACHE_AGE_MS = 60 * 60 * 1_000;
const NULL_MARKER = 'ᴺᵁᴸᴸ';
const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

const playgroundClient = createClient({
    url: PLAYGROUND_URL, username: PLAYGROUND_USER, password: '', database: 'github',
    request_timeout: REQUEST_TIMEOUT_MS,
});

let playgroundServerVersion: string | undefined;
let playgroundServerVersionRequest: Promise<string | undefined> | undefined;

export class PlaygroundError extends Error {
    constructor(public readonly code: string, message: string) { super(message); }
}

export type PlaygroundQueryResult = {
    columns: Column[];
    rows: Row[];
    queryId: string;
    elapsedMs: number;
    bytes: number;
    truncated: boolean;
};

function valueForType(value: unknown, type: string): Json {
    if (value === null) return null;
    if (typeof value === 'boolean' || typeof value === 'number') return value;
    if (typeof value !== 'string') throw new PlaygroundError('INVALID_PLAYGROUND_RESPONSE', 'ClickHouse Playground returned a value with an unsupported type.');
    return decodeClickHouseStringValue(value, type, NULL_MARKER);
}

function parseCompactRows(body: string) {
    const lines = body.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length < 2) throw parsePlaygroundError(body);

    let names: unknown, types: unknown;
    try {
        names = JSON.parse(lines[0]!);
        types = JSON.parse(lines[1]!);
    } catch {
        throw parsePlaygroundError(body);
    }
    if (!Array.isArray(names) || !names.every(name => typeof name === 'string') ||
        !Array.isArray(types) || !types.every(type => typeof type === 'string') || names.length !== types.length)
        throw new PlaygroundError('INVALID_PLAYGROUND_RESPONSE', 'ClickHouse Playground returned invalid column metadata.');

    const columns = names.map((name, index) => ({ name, type: types[index] as string }));
    const rows = lines.slice(2).map((line, rowIndex) => {
        let values: unknown;
        try { values = JSON.parse(line); }
        catch { throw new PlaygroundError('INVALID_PLAYGROUND_RESPONSE', `ClickHouse Playground returned an invalid row at position ${rowIndex + 1}.`); }
        if (!Array.isArray(values) || values.length !== columns.length)
            throw new PlaygroundError('INVALID_PLAYGROUND_RESPONSE', `ClickHouse Playground returned an invalid row at position ${rowIndex + 1}.`);
        return values.map((value, columnIndex) => valueForType(value, columns[columnIndex]!.type));
    });
    return { columns, rows };
}

function parsePlaygroundError(body: string, status?: number) {
    const trimmed = body.trim();
    const match = trimmed.match(/^(?:Code:\s*(\d+)\.\s*)?(?:DB::Exception:\s*)?([\s\S]*)$/);
    const code = match?.[1] ? `CLICKHOUSE_${match[1]}` : status ? `PLAYGROUND_HTTP_${status}` : 'PLAYGROUND_QUERY_ERROR';
    const message = (match?.[2] ?? trimmed).replace(/\s+\(version [^)]+\)\s*$/, '').trim().slice(0, 1_500);
    return new PlaygroundError(code, message || 'ClickHouse Playground could not run this query.');
}

function validateQuery(sql: string) {
    const statements = splitSql(sql);
    if (statements.length !== 1) throw new PlaygroundError('SINGLE_STATEMENT', 'Run one SQL statement at a time on the public Playground.');
    const command = lexSql(statements[0]!.sql).find(token => token.kind === 'word')?.text.toUpperCase();
    if (!command || !['SELECT', 'WITH', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN'].includes(command))
        throw new PlaygroundError('READ_ONLY_SQL', 'The public Playground connection accepts read-only SQL only.');
}

async function executePlaygroundQuery(sql: string, signal: AbortSignal | undefined, maxRows: number, maxBytes: number, queryParams: Record<string, string> = {}): Promise<PlaygroundQueryResult> {
    if (!sql.trim()) throw new PlaygroundError('EMPTY_QUERY', 'Write a SQL statement before running it.');
    validateQuery(sql);

    const controller = new AbortController();
    let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, REQUEST_TIMEOUT_MS);
    const abortRequest = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abortRequest, { once: true });
    const startedAt = performance.now();
    try {
        const queryId = crypto.randomUUID();
        const response = await playgroundClient.query({
            query: sql,
            query_params: queryParams,
            format: PLAYGROUND_FORMAT,
            query_id: queryId,
            abort_signal: controller.signal,
            clickhouse_settings: {
                max_result_rows: String(maxRows),
                max_result_bytes: String(maxBytes),
                max_execution_time: 60,
                result_overflow_mode: 'break',
            },
        });
        const body = await response.text();
        const bytes = new TextEncoder().encode(body).byteLength;
        if (bytes > maxBytes) throw new PlaygroundError('PLAYGROUND_RESPONSE_TOO_LARGE', 'The Playground result is too large to display. Add a LIMIT and try again.');
        const parsed = parseCompactRows(body);
        const mayBeTruncated = parsed.rows.length >= maxRows || bytes >= maxBytes * RESPONSE_BYTE_WARNING_THRESHOLD;
        const summaryHeader = response.response_headers['x-clickhouse-summary'];
        const summary = typeof summaryHeader === 'string' ? summaryHeader : undefined;
        let summaryElapsed = 0;
        try {
            const parsedSummary: unknown = summary ? JSON.parse(summary) : undefined;
            summaryElapsed = isRecord(parsedSummary) ? Number(parsedSummary.elapsed_ns) / 1_000_000 : 0;
        } catch { }
        return {
            ...parsed, queryId: response.query_id || queryId, bytes,
            elapsedMs: Number.isFinite(summaryElapsed) && summaryElapsed > 0 ? summaryElapsed : performance.now() - startedAt,
            truncated: mayBeTruncated,
        };
    } catch (error) {
        if (error instanceof PlaygroundError) throw error;
        if (error instanceof ClickHouseError)
            throw new PlaygroundError(`CLICKHOUSE_${error.code}`, error.message);
        if (timedOut) throw new PlaygroundError('PLAYGROUND_TIMEOUT', 'ClickHouse Playground did not respond within 65 seconds.');
        if (controller.signal.aborted) throw new PlaygroundError('PLAYGROUND_REQUEST_ABORTED', 'The ClickHouse Playground request was interrupted.');
        throw new PlaygroundError('PLAYGROUND_UNAVAILABLE', 'Could not reach ClickHouse Playground. Check the network and try again.');
    } finally {
        window.clearTimeout(timeout);
        signal?.removeEventListener('abort', abortRequest);
    }
}

export function queryPlayground(sql: string, signal?: AbortSignal) {
    return executePlaygroundQuery(sql, signal, MAX_RESULT_ROWS, MAX_RESPONSE_BYTES);
}

export function loadPlaygroundServerVersion(): Promise<string | undefined> {
    if (playgroundServerVersion) return Promise.resolve(playgroundServerVersion);
    if (playgroundServerVersionRequest) return playgroundServerVersionRequest;
    const request = queryPlayground('SELECT version() AS version').then(result => {
        const version = result.rows[0]?.[0];
        if (typeof version !== 'string' || !version.trim()) return undefined;
        playgroundServerVersion = version.trim();
        return playgroundServerVersion;
    }).catch(() => undefined).finally(() => {
        if (!playgroundServerVersion && playgroundServerVersionRequest === request)
            playgroundServerVersionRequest = undefined;
    });
    playgroundServerVersionRequest = request;
    return request;
}

export async function queryPlaygroundQueryTree(sql: string, signal?: AbortSignal) {
    validateQuery(sql);
    const result = await executePlaygroundQuery(`EXPLAIN QUERY TREE\n${sql}`, signal, 4_000, 4_000_000);
    if (result.truncated)
        throw new PlaygroundError('PLAYGROUND_ANALYZER_TOO_LARGE', 'The ClickHouse analyzer tree is too large to display. Simplify the statement and try again.');
    return result;
}

export function queryPlaygroundWithParams(sql: string, queryParams: Record<string, string>, signal?: AbortSignal) {
    return executePlaygroundQuery(sql, signal, MAX_RESULT_ROWS, MAX_RESPONSE_BYTES, queryParams);
}

export async function loadPlaygroundTableParts(database: string, table: string, signal?: AbortSignal): Promise<MergeTreePartsSnapshot> {
    const result = await queryPlaygroundWithParams(mergeTreePartsQuery(), { database, table }, signal);
    return parseMergeTreeParts(database, table, result.rows);
}

const tablesSql = `SELECT database, name, engine, sorting_key, primary_key, partition_key, sampling_key,
       total_rows, total_bytes, total_bytes_uncompressed
FROM system.tables
WHERE database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema') AND is_temporary = 0
ORDER BY database, name
LIMIT ${SCHEMA_MAX_TABLES + 1}`;
const columnsSql = `SELECT database, table, name, type, default_kind, comment
FROM system.columns
WHERE database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')
ORDER BY database, table, position
LIMIT ${SCHEMA_MAX_COLUMNS + 1}`;

const text = (value: Json | undefined) => value === null || value === undefined ? '' : String(value);
const nullableText = (value: Json | undefined) => value === null || value === undefined ? null : String(value);

function cachedSchema(): Schema | undefined {
    try {
        const stored: unknown = JSON.parse(localStorage.getItem(SCHEMA_CACHE_KEY) ?? 'null');
        if (!isRecord(stored) || typeof stored.savedAt !== 'number' || !Number.isFinite(stored.savedAt)) return undefined;
        const age = Date.now() - stored.savedAt;
        const schema = stored.schema;
        if (age < 0 || age > SCHEMA_CACHE_AGE_MS || !isSchema(schema) || schema.connectionId !== PLAYGROUND_CONNECTION_ID) return undefined;
        return schema;
    } catch { return undefined; }
}

export async function loadPlaygroundSchema(signal?: AbortSignal, refresh = false): Promise<Schema> {
    if (!refresh) {
        const cached = cachedSchema();
        if (cached) return cached;
    }

    const [tableResult, columnResult] = await Promise.all([
        executePlaygroundQuery(tablesSql, signal, SCHEMA_MAX_TABLES + 1, 4_000_000),
        executePlaygroundQuery(columnsSql, signal, SCHEMA_MAX_COLUMNS + 1, 6_000_000),
    ]);
    const tableRows = tableResult.rows.slice(0, SCHEMA_MAX_TABLES);
    const columnRows = columnResult.rows.slice(0, SCHEMA_MAX_COLUMNS);
    const truncated = tableResult.rows.length >= MAX_RESULT_ROWS || columnResult.rows.length >= MAX_RESULT_ROWS;
    const schema: Schema = {
        connectionId: PLAYGROUND_CONNECTION_ID, fetchedAt: new Date().toISOString(),
        tables: tableRows.map(row => ({
            database: text(row[0]), name: text(row[1]), engine: text(row[2]),
            orderBy: text(row[3]), primaryKey: text(row[4]), partitionKey: text(row[5]), samplingKey: text(row[6]),
            rowEstimate: nullableText(row[7]), sizeBytes: nullableText(row[8]), uncompressedBytes: nullableText(row[9]),
        })),
        columns: columnRows.map(row => ({
            database: text(row[0]), table: text(row[1]), name: text(row[2]), type: text(row[3]),
            defaultKind: text(row[4]), comment: text(row[5]),
        })),
        warnings: truncated ? [`The public Playground returned its ${MAX_RESULT_ROWS.toLocaleString()}-row limit. Some tables or columns may be missing.`] : [],
        truncated,
    };
    try { localStorage.setItem(SCHEMA_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), schema })); } catch { }
    return schema;
}
