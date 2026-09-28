import { createClient } from '@clickhouse/client';
import { randomUUID } from 'node:crypto';
import { AppError } from '../core/errors.js';
import { parseInput } from '../core/imports.js';
import type { Column, Json, Row, Schema, SchemaColumn, SchemaTable } from '../shared/types.js';
import { lexSql, quoteIdentifier, splitSql } from '../shared/sql.js';
import { CREATE_TABLE_COLUMN_TYPES, type CreateTableColumn, type CreateTableColumnType } from '../shared/table-creation.js';
import { createTableSql } from '../core/table-creation.js';
import { parseReplicationSnapshot, replicationQueueQuery, replicationReplicasQuery, type ReplicationCapabilities } from '../shared/replication.js';
import { parseWorkloadSnapshot, WORKLOAD_WINDOWS, workloadFamiliesQuery, workloadPointsQuery, type QueryLogSource, type WorkloadWindow } from '../shared/workload.js';

type CloudCredentials = { host: string; database: string; username: string; password: string };
const MAX_SQL_LENGTH = 200_000;
const MAX_RESULT_ROWS = 1_000;
const MAX_RESULT_BYTES = 2_000_000;
const MAX_EXECUTION_SECONDS = 45;
const MAX_IMPORT_FILE_BYTES = 2_000_000;
const MAX_IMPORT_REQUEST_BYTES = 4_000_000;
const clickhouseSettings = {
    max_execution_time: MAX_EXECUTION_SECONDS,
    max_result_rows: String(MAX_RESULT_ROWS),
    max_result_bytes: String(MAX_RESULT_BYTES),
    result_overflow_mode: 'break' as const,
    max_threads: 4 as const,
    output_format_json_quote_64bit_integers: 1 as const,
};

type CloudImportJob = { id: string; connectionId: 'clickhouse-cloud'; table: string; queryId: string; rows: number; createdAt: string; status: 'running' | 'succeeded' | 'unknown'; error?: string; reviewedAt?: string; reconciliationRequired?: boolean };

function isSameOrigin(request: Request) {
    const origin = request.headers.get('origin');
    return !origin || origin === new URL(request.url).origin;
}

function validImportQueryId(value: unknown): value is string {
    return typeof value === 'string' && /^clickstudio-import-[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
}

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

function makeClient(credentials: CloudCredentials, url: string, sessionId?: string) {
    return createClient({
        url,
        database: credentials.database,
        username: credentials.username,
        password: credentials.password,
        ...(sessionId ? { session_id: sessionId } : {}),
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

async function createCloudTable(credentials: CloudCredentials, url: string, body: Record<string, unknown>) {
    if (!isImportIdentifier(body.name)) throw new AppError(400, 'TABLE_NAME', 'Use a valid table name.');
    if (!Array.isArray(body.columns) || body.columns.length > 50) throw new AppError(400, 'TABLE_COLUMNS', 'A table needs 1–50 columns.');
    const columns: CreateTableColumn[] = body.columns.map(value => {
        if (!isRecord(value) || !isImportIdentifier(value.name) || typeof value.type !== 'string' ||
            !(CREATE_TABLE_COLUMN_TYPES as readonly string[]).includes(value.type))
            throw new AppError(400, 'TABLE_COLUMNS', 'Check the table column names and types.');
        return { name: value.name, type: value.type as CreateTableColumnType };
    });
    const orderBy = typeof body.orderBy === 'string' ? body.orderBy : '';
    const table = `${credentials.database}.${body.name}`;
    if (body.confirmation !== `CREATE TABLE ${table}`)
        throw new AppError(400, 'TABLE_CREATE_CONFIRMATION', 'Confirm the exact table name before creating it.');
    const query = createTableSql(table, columns, orderBy);
    const queryId = `clickstudio-create-table-${randomUUID()}`;
    const client = makeClient(credentials, url);
    try {
        await client.command({ query, query_id: queryId, abort_signal: AbortSignal.timeout(48_000), clickhouse_settings: clickhouseSettings });
    } finally {
        await client.close();
    }
    return { database: credentials.database, table: body.name, columns, orderBy, queryId };
}

function isReadQuery(sql: string) {
    const first = lexSql(sql).find(token => token.kind === 'word')?.text.toUpperCase();
    return ['SELECT', 'WITH', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN'].includes(first ?? '');
}

function safeRowCount(value: unknown): number | undefined {
    if (typeof value !== 'string' || !/^\d+$/.test(value)) return undefined;
    const count = Number(value);
    return Number.isSafeInteger(count) ? count : undefined;
}

async function runSql(credentials: CloudCredentials, url: string, sql: string, sessionId?: string) {
    const statement = sql.trim();
    if (!statement || statement.length > MAX_SQL_LENGTH)
        throw new Error(`Enter one SQL statement under ${MAX_SQL_LENGTH.toLocaleString()} characters.`);
    if (splitSql(statement).length !== 1)
        throw new Error('Run one SQL statement at a time on ClickHouse Cloud.');

    const client = makeClient(credentials, url, sessionId);
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
            const writtenRows = safeRowCount(result.summary?.written_rows);
            return {
                queryId: result.query_id || queryId,
                columns: [] as Column[],
                rows: [] as Row[],
                elapsedMs: performance.now() - startedAt,
                bytes: 0,
                truncated: false,
                ...(writtenRows === undefined ? {} : { writtenRows }),
            };
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

function parseFormJson<T>(form: FormData, key: string): T | undefined {
    const value = form.get(key);
    if (typeof value !== 'string') return undefined;
    try { return JSON.parse(value) as T; }
    catch { throw new AppError(400, 'IMPORT_REQUEST', `The ${key} field is not valid JSON.`); }
}

function isImportFormat(value: unknown): value is 'csv' | 'json' | 'ndjson' {
    return value === 'csv' || value === 'json' || value === 'ndjson';
}

function isImportIdentifier(value: unknown): value is string {
    return typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value);
}

function isImportTableName(value: string) {
    return value.length > 0 && value.length <= 512 && !Array.from(value).some(character => {
        const code = character.charCodeAt(0);
        return code < 32 || code === 127;
    });
}

async function inspectCloudImport(credentials: CloudCredentials, url: string, queryId: string, table: string, rows: number): Promise<CloudImportJob> {
    const job: CloudImportJob = { id: queryId.slice('clickstudio-import-'.length), connectionId: 'clickhouse-cloud', table, queryId, rows, createdAt: new Date().toISOString(), status: 'unknown', error: 'ClickHouse could not confirm the insert. The rows may already be there.' };
    const client = makeClient(credentials, url);
    try {
        try {
            const running = await queryRows<{ query_id: string }>(client,
                'SELECT query_id FROM system.processes WHERE query_id = {queryId:String} LIMIT 1', { queryId }, 8_000, 6);
            if (running.length) return { ...job, status: 'running', reconciliationRequired: true, error: 'ClickHouse still reports this insert as active.' };
        } catch { }
        for (const source of ['user_query_log', 'query_log'] as const) {
            try {
                const entries = await queryRows<{ type: string; event_time: string }>(client,
                    `SELECT type, event_time FROM system.${source} WHERE query_id = {queryId:String} ORDER BY event_time DESC LIMIT 10`, { queryId }, 8_000, 6);
                if (entries.some(entry => entry.type === 'QueryFinish')) return { ...job, status: 'succeeded', error: undefined };
                if (entries.some(entry => entry.type.startsWith('Exception'))) return { ...job, error: 'ClickHouse recorded an insert error. Check the destination before retrying.' };
                if (entries.some(entry => entry.type === 'QueryStart')) return { ...job, status: 'running', reconciliationRequired: true, error: 'ClickHouse still reports this insert as active.' };
            } catch { }
        }
        return job;
    } finally {
        await client.close();
    }
}

async function commitCloudImport(form: FormData, credentials: CloudCredentials, url: string): Promise<CloudImportJob> {
    const file = form.get('file');
    if (!(file instanceof File)) throw new AppError(400, 'IMPORT_FILE', 'Choose a file to import.');
    if (file.size > MAX_IMPORT_FILE_BYTES) throw new AppError(413, 'IMPORT_BYTE_LIMIT', 'Imports are limited to 2 MB.');
    const format = form.get('format');
    if (!isImportFormat(format)) throw new AppError(400, 'IMPORT_FORMAT', 'Use a CSV, JSON, or NDJSON file.');
    const queryIdValue = form.get('queryId');
    if (!validImportQueryId(queryIdValue)) throw new AppError(400, 'IMPORT_QUERY_ID', 'The import request id is invalid.');
    const queryId = queryIdValue;
    const confirmation = form.get('confirmation');
    const target = form.get('target');
    const fields = parseFormJson<Record<string, unknown>>(form, 'fields');
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw new AppError(400, 'IMPORT_MAPPING', 'Choose at least one destination column.');
    const source = await file.text();
    const parsed = parseInput(source, format);
    if (!parsed.rows.length) throw new AppError(400, 'IMPORT_EMPTY', 'The input contains no data rows.');
    if (confirmation !== `INSERT ${parsed.rows.length} ROWS`) throw new AppError(400, 'IMPORT_CONFIRMATION', 'Confirm the exact row count before inserting.');

    const createTable = parseFormJson<{ name?: unknown; columns?: unknown }>(form, 'createTable');
    const creating = createTable !== undefined;
    let tableName: string;
    let destinationColumns: SchemaColumn[];
    let createColumns: { source: string; name: string; type: CreateTableColumnType }[] = [];
    let expectedColumns: { name: string; type: string; defaultKind: string }[] | undefined;

    if (creating) {
        if (!createTable || !isImportIdentifier(createTable.name) || !Array.isArray(createTable.columns) || createTable.columns.length === 0 || createTable.columns.length > 200)
            throw new AppError(400, 'IMPORT_CREATE_TABLE', 'Enter a table name and at least one column.');
        tableName = createTable.name;
        createColumns = createTable.columns.map(value => {
            if (!isRecord(value) || typeof value.source !== 'string' || !parsed.columns.includes(value.source) || !isImportIdentifier(value.name) ||
                typeof value.type !== 'string' || !(CREATE_TABLE_COLUMN_TYPES as readonly string[]).includes(value.type))
                throw new AppError(400, 'IMPORT_CREATE_TABLE', 'Check the new table column names and types.');
            return { source: value.source, name: value.name, type: value.type as CreateTableColumnType };
        });
        if (new Set(createColumns.map(column => column.source)).size !== createColumns.length || new Set(createColumns.map(column => column.name)).size !== createColumns.length)
            throw new AppError(400, 'IMPORT_CREATE_TABLE', 'New table column names must be unique.');
        const schema = await readSchema(credentials, url);
        if (schema.tables.some(table => table.name === tableName)) throw new AppError(409, 'TABLE_EXISTS', 'A table with this name already exists. Choose an existing table or a different name.');
        destinationColumns = createColumns.map(column => ({ database: credentials.database, table: tableName, name: column.name, type: column.type, defaultKind: '', comment: '' }));
    } else {
        const databasePrefix = `${credentials.database}.`;
        if (typeof target !== 'string' || !target.startsWith(databasePrefix)) throw new AppError(400, 'IMPORT_TABLE', 'Choose a table in the connected database.');
        tableName = target.slice(databasePrefix.length);
        if (!isImportTableName(tableName)) throw new AppError(400, 'IMPORT_TABLE', 'Choose a valid table in the connected database.');
        const schema = await readSchema(credentials, url);
        const selectedTable = schema.tables.find(table => table.database === credentials.database && table.name === tableName);
        if (!selectedTable || ['View', 'MaterializedView', 'LiveView', 'WindowView'].includes(selectedTable.engine))
            throw new AppError(404, 'IMPORT_TABLE', 'The selected table is not available for inserts.');
        const allColumns = schema.columns.filter(column => column.database === credentials.database && column.table === tableName);
        if (!allColumns.length) throw new AppError(404, 'IMPORT_TABLE', 'The selected table has no visible columns.');
        expectedColumns = parseFormJson<{ name: string; type: string; defaultKind: string }[]>(form, 'expectedColumns');
        if (!Array.isArray(expectedColumns) || JSON.stringify(expectedColumns) !== JSON.stringify(allColumns.map(({ name, type, defaultKind }) => ({ name, type, defaultKind }))))
            throw new AppError(409, 'SCHEMA_CHANGED', 'The destination schema changed. Review the updated mapping before importing.');
        destinationColumns = allColumns;
    }

    const entries = Object.entries(fields);
    const destinations = entries.map(([, destination]) => destination);
    if (!entries.length || entries.length > 200 || destinations.some(destination => typeof destination !== 'string') || new Set(destinations).size !== destinations.length)
        throw new AppError(400, 'IMPORT_MAPPING', 'Map each destination column once.');
    for (const [sourceName, destination] of entries) {
        if (!parsed.columns.includes(sourceName) || typeof destination !== 'string' || !destinationColumns.some(column => column.name === destination && !['MATERIALIZED', 'ALIAS'].includes(column.defaultKind)))
            throw new AppError(400, 'IMPORT_MAPPING', 'Mapping references an unknown source or a non-writable destination column.');
    }

    const columnTypes = new Map(destinationColumns.map(column => [column.name, column.type]));
    const mappedRows = parsed.rows.map((row, index) => {
        const mapped = Object.create(null) as Record<string, Json>;
        for (const [sourceName, destination] of entries) {
            if (!Object.hasOwn(row, sourceName)) throw new AppError(400, 'IMPORT_MISSING_FIELD', `Input row ${index + 1} is missing ${sourceName}.`);
            const value = row[sourceName]!;
            const type = columnTypes.get(destination as string) ?? '';
            mapped[destination as string] = value !== null && typeof value !== 'string' && /String\)?$/.test(type)
                ? typeof value === 'object' ? JSON.stringify(value) : String(value)
                : value;
        }
        return mapped;
    });

    const client = makeClient(credentials, url);
    try {
        if (creating) {
            const definitions = createColumns.map(column => `${quoteIdentifier(column.name)} Nullable(${column.type})`).join(', ');
            await client.command({
                query: `CREATE TABLE ${quoteIdentifier(credentials.database)}.${quoteIdentifier(tableName)} (${definitions}) ENGINE = MergeTree ORDER BY tuple()`,
                query_id: `clickstudio-create-${queryId.slice('clickstudio-import-'.length)}`,
                abort_signal: AbortSignal.timeout(48_000),
                clickhouse_settings: clickhouseSettings,
            });
        }
        await client.insert({
            table: quoteIdentifier(tableName),
            values: mappedRows,
            format: 'JSONEachRow',
            query_id: queryId,
            abort_signal: AbortSignal.timeout(48_000),
            clickhouse_settings: clickhouseSettings,
        });
    } finally {
        await client.close();
    }
    return { id: queryId.slice('clickstudio-import-'.length), connectionId: 'clickhouse-cloud', table: `${credentials.database}.${tableName}`, queryId, rows: parsed.rows.length, createdAt: new Date().toISOString(), status: 'succeeded' };
}

async function postCloudImport(request: Request): Promise<Response> {
    if (!isSameOrigin(request)) return fail('ORIGIN', 'This endpoint accepts requests from the ClickStudio site only.', 403);
    const length = Number(request.headers.get('content-length'));
    if (Number.isFinite(length) && length > MAX_IMPORT_REQUEST_BYTES) return fail('REQUEST_SIZE', 'The Cloud import request is too large.', 413);
    let form: FormData;
    try { form = await request.formData(); }
    catch { return fail('IMPORT_REQUEST', 'Could not read the import request.'); }
    const credentialsValue = form.get('credentials');
    if (typeof credentialsValue !== 'string') return fail('CLOUD_CREDENTIALS', 'Enter your ClickHouse Cloud connection details.');
    let credentialInput: unknown;
    try { credentialInput = JSON.parse(credentialsValue) as unknown; }
    catch { return fail('CLOUD_CREDENTIALS', 'Check the host, database, username, and password.'); }
    const validated = validateCredentials(credentialInput);
    if (validated instanceof Response) return validated;
    const { credentials, url } = validated;
    if (form.get('action') !== 'import-commit') return fail('CLOUD_ACTION', 'Choose the Cloud import action.');
    try {
        return json(await commitCloudImport(form, credentials, url));
    } catch (error) {
        if (error instanceof AppError) return fail(error.code, error.message, error.status);
        return safeError(error, credentials.password);
    }
}

async function post(request: Request): Promise<Response> {
    const contentType = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
    if (contentType === 'multipart/form-data') return await postCloudImport(request);
    if (contentType !== 'application/json')
        return fail('CONTENT_TYPE', 'Send the ClickHouse request as JSON.', 415);
    if (!isSameOrigin(request))
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
            const sessionId = body.sessionId;
            if (sessionId !== undefined && (typeof sessionId !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(sessionId)))
                return fail('SESSION_ID', 'The SQL session id is invalid.');
            return json(await runSql(credentials, url, body.sql, sessionId));
        }
        if (body.action === 'workload') {
            if (!isWorkloadWindow(body.minutes)) return fail('WORKLOAD_WINDOW', 'Choose a supported workload time window.');
            const source = body.source === 'user_query_log' || body.source === 'query_log' ? body.source : undefined;
            if (!source) return fail('QUERY_LOG_UNAVAILABLE', 'Test the connection to check query-log access.', 409);
            return json(await readWorkload(credentials, url, body.minutes, source));
        }
        if (body.action === 'replication')
            return json(await readReplication(credentials, url));
        if (body.action === 'create-table')
            return json(await createCloudTable(credentials, url, body));
        if (body.action === 'import-status') {
            const tablePrefix = `${credentials.database}.`;
            const targetTable = typeof body.table === 'string' ? body.table : '';
            const tableName = targetTable.startsWith(tablePrefix) ? targetTable.slice(tablePrefix.length) : '';
            if (!validImportQueryId(body.queryId) || !isImportTableName(tableName) ||
                typeof body.rows !== 'number' || !Number.isSafeInteger(body.rows) || body.rows < 1 || body.rows > 10_000)
                return fail('IMPORT_STATUS', 'The saved import details are invalid.');
            return json(await inspectCloudImport(credentials, url, body.queryId, targetTable, body.rows));
        }
        return fail('CLOUD_ACTION', 'Choose test, schema, run, workload, replication, or import status.');
    } catch (error) {
        if (error instanceof AppError) return fail(error.code, error.message, error.status);
        return safeError(error, credentials.password);
    }
}

export default {
    async fetch(request: Request): Promise<Response> {
        return await post(request);
    },
};
