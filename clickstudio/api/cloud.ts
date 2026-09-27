import { createClient } from '@clickhouse/client';
import { randomUUID } from 'node:crypto';
import type { Column, Json, Row, Schema, SchemaColumn, SchemaTable } from '../shared/types.js';
import { lexSql, splitSql } from '../shared/sql.js';
import { parseReplicationSnapshot, replicationQueueQuery, replicationReplicasQuery, type ReplicationCapabilities } from '../shared/replication.js';
import { parseWorkloadSnapshot, WORKLOAD_WINDOWS, workloadFamiliesQuery, workloadPointsQuery, type QueryLogSource, type WorkloadWindow } from '../shared/workload.js';

type CloudCredentials = { host: string; database: string; username: string; password: string };
const MAX_SQL_LENGTH = 200_000;
const MAX_RESULT_ROWS = 1_000;
const MAX_RESULT_BYTES = 2_000_000;
const MAX_EXECUTION_SECONDS = 45;
const clickhouseSettings = {
    max_execution_time: MAX_EXECUTION_SECONDS,
    max_result_rows: String(MAX_RESULT_ROWS),
    max_result_bytes: String(MAX_RESULT_BYTES),
    result_overflow_mode: 'break' as const,
    max_threads: 4 as const,
    output_format_json_quote_64bit_integers: 1 as const,
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function json(body: unknown, status = 200): Response {
    return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function fail(code: string, message: string, status = 400) {
    return json({ error: { code, message } }, status);
}

function validateCredentials(value: unknown): { credentials: CloudCredentials; url: string } | Response {
    if (!isRecord(value)) return fail('CLOUD_CREDENTIALS', 'Enter your ClickHouse Cloud connection details.');
    const host = typeof value.host === 'string' ? value.host.trim() : '';
    const database = typeof value.database === 'string' ? value.database.trim() : '';
    const username = typeof value.username === 'string' ? value.username.trim() : '';
    const password = typeof value.password === 'string' ? value.password : '';
    if (!host || host.length > 512 || !database || database.length > 128 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(database) ||
        !username || username.length > 128 || !password || password.length > 1024)
        return fail('CLOUD_CREDENTIALS', 'Check the host, database, username, and password.');

    let endpoint: URL;
    try {
        endpoint = new URL(host.includes('://') ? host : `https://${host}`);
    } catch {
        return fail('CLOUD_HOST', 'Enter the ClickHouse Cloud HTTPS host from the service connection details.');
    }
    if (endpoint.protocol !== 'https:' || !endpoint.hostname.toLowerCase().endsWith('.clickhouse.cloud') ||
        endpoint.port && endpoint.port !== '8443' || endpoint.pathname !== '/' || endpoint.search || endpoint.hash ||
        endpoint.username || endpoint.password) {
        return fail('CLOUD_HOST', 'Use a ClickHouse Cloud HTTPS host on port 8443.');
    }
    endpoint.port = '8443';
    return { credentials: { host: endpoint.host, database, username, password }, url: endpoint.toString() };
}

function makeClient(credentials: CloudCredentials, url: string) {
    return createClient({
        url,
        database: credentials.database,
        username: credentials.username,
        password: credentials.password,
        application: 'clickstudio-cloud',
        request_timeout: 50_000,
        max_open_connections: 1,
    });
}

function safeError(error: unknown, password: string) {
    const raw = error instanceof Error ? error.message : 'ClickHouse request failed.';
    const message = password ? raw.split(password).join('[redacted]') : raw;
    const denied = /authentication failed|not enough privileges|access denied/i.test(message);
    return fail(denied ? 'CLICKHOUSE_PERMISSION' : 'CLICKHOUSE_ERROR', message.slice(0, 2_000), denied ? 403 : 502);
}

function asString(value: unknown): string {
    return value === null || value === undefined ? '' : String(value);
}

async function queryRows<T>(client: ReturnType<typeof makeClient>, query: string, queryParams: Record<string, string> = {}, timeoutMs = 48_000, maxExecutionSeconds = MAX_EXECUTION_SECONDS): Promise<T[]> {
    const result = await client.query({
        query,
        format: 'JSONEachRow',
        query_params: queryParams,
        query_id: `clickstudio-inspect-${randomUUID()}`,
        abort_signal: AbortSignal.timeout(timeoutMs),
        clickhouse_settings: { ...clickhouseSettings, max_execution_time: maxExecutionSeconds, max_result_rows: '2000', max_result_bytes: String(MAX_RESULT_BYTES), result_overflow_mode: 'throw' },
    });
    return await result.json<T>();
}

async function probe(client: ReturnType<typeof makeClient>, query: string) {
    try {
        await queryRows(client, query, {}, 8_000, 6);
        return true;
    } catch {
        return false;
    }
}

async function testConnection(credentials: CloudCredentials, url: string) {
    const client = makeClient(credentials, url);
    try {
        const [rows, userQueryLog, queryLogFallback, replicas, replicationQueue] = await Promise.all([
            queryRows<{ version: string; database: string }>(
            client,
            'SELECT version() AS version, currentDatabase() AS database',
            ),
            probe(client, "SELECT query_id, type, event_time, query_duration_ms, read_rows, read_bytes, memory_usage, normalized_query_hash, query, user, is_initial_query, normalizeQuery('SELECT 1') FROM system.user_query_log LIMIT 0"),
            probe(client, "SELECT query_id, type, event_time, query_duration_ms, read_rows, read_bytes, memory_usage, normalized_query_hash, query, user, is_initial_query, normalizeQuery('SELECT 1') FROM system.query_log LIMIT 0"),
            probe(client, 'SELECT database, table, replica_name, is_leader, is_readonly, is_session_expired, absolute_delay, queue_size, inserts_in_queue, merges_in_queue, future_parts, total_replicas, active_replicas FROM system.replicas LIMIT 0'),
            probe(client, 'SELECT database, table, type, create_time, num_tries, last_exception, postpone_reason, is_currently_executing FROM system.replication_queue LIMIT 0'),
        ]);
        const queryLogSource: QueryLogSource | undefined = userQueryLog ? 'user_query_log' : queryLogFallback ? 'query_log' : undefined;
        const replicationCapabilities: ReplicationCapabilities = { replicas, queue: replicationQueue };
        return {
            host: credentials.host,
            database: credentials.database,
            username: credentials.username,
            serverVersion: rows[0]?.version ?? 'unknown',
            queryLog: queryLogSource
                ? { available: true as const }
                : { available: false as const, reason: 'No supported system query log is available to this user.' },
            ...(queryLogSource ? { queryLogSource } : {}),
            replication: replicas || replicationQueue
                ? { available: true as const }
                : { available: false as const, reason: 'No supported replication system tables are available to this user.' },
            replicationCapabilities,
        };
    } finally {
        await client.close();
    }
}

async function readSchema(credentials: CloudCredentials, url: string): Promise<Schema> {
    const client = makeClient(credentials, url);
    try {
        const [tableRows, columnRows] = await Promise.all([
            queryRows<Record<string, unknown>>(client,
                'SELECT name, engine, sorting_key, primary_key, partition_key, sampling_key, total_rows, total_bytes FROM system.tables WHERE database = {database:String} AND is_temporary = 0 ORDER BY name LIMIT 500',
                { database: credentials.database }),
            queryRows<Record<string, unknown>>(client,
                'SELECT database, table, name, type, default_kind, comment FROM system.columns WHERE database = {database:String} ORDER BY table, position LIMIT 2_000',
                { database: credentials.database }),
        ]);
        const tables: SchemaTable[] = tableRows.map(row => ({
            database: credentials.database,
            name: asString(row.name),
            engine: asString(row.engine),
            orderBy: asString(row.sorting_key) || undefined,
            primaryKey: asString(row.primary_key) || undefined,
            partitionKey: asString(row.partition_key) || undefined,
            samplingKey: asString(row.sampling_key) || undefined,
            rowEstimate: asString(row.total_rows) || null,
            sizeBytes: asString(row.total_bytes) || null,
        }));
        const columns: SchemaColumn[] = columnRows.map(row => ({
            database: asString(row.database),
            table: asString(row.table),
            name: asString(row.name),
            type: asString(row.type),
            defaultKind: asString(row.default_kind),
            comment: asString(row.comment),
        }));
        return {
            connectionId: 'clickhouse-cloud',
            fetchedAt: new Date().toISOString(),
            tables,
            columns,
            warnings: [],
            truncated: tableRows.length >= 500 || columnRows.length >= 2_000,
        };
    } finally {
        await client.close();
    }
}

function isReadQuery(sql: string) {
    const first = lexSql(sql).find(token => token.kind === 'word')?.text.toUpperCase();
    return ['SELECT', 'WITH', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN'].includes(first ?? '');
}

async function runSql(credentials: CloudCredentials, url: string, sql: string) {
    const statement = sql.trim();
    if (!statement || statement.length > MAX_SQL_LENGTH)
        throw new Error(`Enter one SQL statement under ${MAX_SQL_LENGTH.toLocaleString()} characters.`);
    if (splitSql(statement).length !== 1)
        throw new Error('Run one SQL statement at a time on ClickHouse Cloud.');

    const client = makeClient(credentials, url);
    const queryId = `clickstudio-${randomUUID()}`;
    const startedAt = performance.now();
    try {
        if (!isReadQuery(statement)) {
            const result = await client.command({
                query: statement,
                query_id: queryId,
                abort_signal: AbortSignal.timeout(48_000),
                clickhouse_settings: clickhouseSettings,
            });
            return { queryId: result.query_id || queryId, columns: [] as Column[], rows: [] as Row[], elapsedMs: performance.now() - startedAt, bytes: 0, truncated: false };
        }

        const result = await client.query({
            query: statement,
            format: 'JSON',
            query_id: queryId,
            abort_signal: AbortSignal.timeout(48_000),
            clickhouse_settings: clickhouseSettings,
        });
        const payload = await result.json<Record<string, unknown>>();
        const columns: Column[] = Array.isArray(payload.meta)
            ? payload.meta.flatMap(column => typeof column.name === 'string' && typeof column.type === 'string' ? [{ name: column.name, type: column.type }] : [])
            : [];
        const data = Array.isArray(payload.data) ? payload.data : [];
        const rows: Row[] = data.slice(0, MAX_RESULT_ROWS).map(row => columns.map(column => {
            const value = row[column.name];
            return value === undefined ? null : value as Json;
        }));
        const reportedRows = typeof payload.rows_before_limit_at_least === 'number' ? payload.rows_before_limit_at_least : payload.rows ?? data.length;
        const serverBytes = Number(payload.statistics?.bytes_read);
        const bytes = Number.isFinite(serverBytes) ? serverBytes : Buffer.byteLength(JSON.stringify(data));
        return {
            queryId: result.query_id || queryId,
            columns,
            rows,
            elapsedMs: performance.now() - startedAt,
            bytes,
            truncated: reportedRows > rows.length || data.length > MAX_RESULT_ROWS,
        };
    } finally {
        await client.close();
    }
}

function isWorkloadWindow(value: unknown): value is WorkloadWindow {
    return typeof value === 'number' && (WORKLOAD_WINDOWS as readonly number[]).includes(value);
}

async function readWorkload(credentials: CloudCredentials, url: string, minutes: WorkloadWindow, source: QueryLogSource) {
    const client = makeClient(credentials, url);
    const queryParams = { minutes: String(minutes), username: credentials.username };
    try {
        const [families, points] = await Promise.all([
            queryRows<Record<string, unknown>>(client, workloadFamiliesQuery(source), queryParams, 22_000, 20),
            queryRows<Record<string, unknown>>(client, workloadPointsQuery(source), queryParams, 22_000, 20),
        ]);
        return parseWorkloadSnapshot('clickhouse-cloud', minutes, source, families, points);
    } finally {
        await client.close();
    }
}

async function readReplication(credentials: CloudCredentials, url: string) {
    const client = makeClient(credentials, url);
    try {
        const [replicas, queue] = await Promise.all([
            queryRows<Record<string, unknown>>(client, replicationReplicasQuery(), {}, 22_000, 20).then(rows => ({ rows, available: true })).catch(() => ({ rows: [], available: false })),
            queryRows<Record<string, unknown>>(client, replicationQueueQuery(), {}, 22_000, 20).then(rows => ({ rows, available: true })).catch(() => ({ rows: [], available: false })),
        ]);
        if (!replicas.available && !queue.available)
            throw new Error('This user can no longer read system.replicas or system.replication_queue. Test the connection again.');
        return parseReplicationSnapshot('clickhouse-cloud', { replicas: replicas.available, queue: queue.available }, replicas.rows, queue.rows);
    } finally {
        await client.close();
    }
}

async function post(request: Request): Promise<Response> {
    if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json')
        return fail('CONTENT_TYPE', 'Send the ClickHouse request as JSON.', 415);
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin)
        return fail('ORIGIN', 'This endpoint accepts requests from the ClickStudio site only.', 403);

    let rawBody: string;
    try {
        rawBody = await request.text();
    } catch {
        return fail('REQUEST_BODY', 'Could not read the request body.');
    }
    if (Buffer.byteLength(rawBody) > 220_000)
        return fail('REQUEST_SIZE', 'The Cloud request is larger than 220 KB.', 413);
    let body: unknown;
    try {
        body = JSON.parse(rawBody) as unknown;
    } catch {
        return fail('REQUEST_BODY', 'The request body is not valid JSON.');
    }
    if (!isRecord(body)) return fail('REQUEST_BODY', 'The request body must be a JSON object.');
    const validated = validateCredentials(body.credentials);
    if (validated instanceof Response) return validated;

    const { credentials, url } = validated;
    try {
        if (body.action === 'test')
            return json(await testConnection(credentials, url));
        if (body.action === 'schema')
            return json(await readSchema(credentials, url));
        if (body.action === 'run') {
            if (typeof body.sql !== 'string') return fail('SQL_REQUIRED', 'Enter SQL to run.');
            return json(await runSql(credentials, url, body.sql));
        }
        if (body.action === 'workload') {
            if (!isWorkloadWindow(body.minutes)) return fail('WORKLOAD_WINDOW', 'Choose a supported workload time window.');
            const source = body.source === 'user_query_log' || body.source === 'query_log' ? body.source : undefined;
            if (!source) return fail('QUERY_LOG_UNAVAILABLE', 'Test the connection to check query-log access.', 409);
            return json(await readWorkload(credentials, url, body.minutes, source));
        }
        if (body.action === 'replication')
            return json(await readReplication(credentials, url));
        return fail('CLOUD_ACTION', 'Choose test, schema, run, workload, or replication.');
    } catch (error) {
        return safeError(error, credentials.password);
    }
}

export default {
    async fetch(request: Request): Promise<Response> {
        return await post(request);
    },
};
