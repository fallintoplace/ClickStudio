import { createClient } from '@clickhouse/client';
import { randomUUID } from 'node:crypto';
import type { Column, Json, Row, Schema, SchemaColumn, SchemaTable } from '../shared/types.js';
import { lexSql, splitSql } from '../shared/sql.js';

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

async function queryRows<T>(client: ReturnType<typeof makeClient>, query: string, database: string): Promise<T[]> {
    const result = await client.query({
        query,
        format: 'JSONEachRow',
        query_params: { database },
        abort_signal: AbortSignal.timeout(48_000),
        clickhouse_settings: { ...clickhouseSettings, max_result_rows: '2000', max_result_bytes: String(MAX_RESULT_BYTES), result_overflow_mode: 'throw' },
    });
    return await result.json<T>();
}

async function testConnection(credentials: CloudCredentials, url: string) {
    const client = makeClient(credentials, url);
    try {
        const rows = await queryRows<{ version: string; database: string }>(
            client,
            'SELECT version() AS version, currentDatabase() AS database',
            credentials.database,
        );
        return { host: credentials.host, database: credentials.database, username: credentials.username, serverVersion: rows[0]?.version ?? 'unknown' };
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
                credentials.database),
            queryRows<Record<string, unknown>>(client,
                'SELECT database, table, name, type, default_kind, comment FROM system.columns WHERE database = {database:String} ORDER BY table, position LIMIT 2_000',
                credentials.database),
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
        return fail('CLOUD_ACTION', 'Choose test, schema, or run.');
    } catch (error) {
        return safeError(error, credentials.password);
    }
}

export default {
    async fetch(request: Request): Promise<Response> {
        return await post(request);
    },
};
