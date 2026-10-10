import { CLOUD_ACTIONS, type CloudCredentials } from '../shared/cloud-requests.js';
import type { ImportJobStatus } from '../shared/import-status.js';
import { MAX_SQL_CHARS } from '../shared/query-limits.js';
import { IMPORT_FORMATS, IMPORT_FILE_SIZE_LABEL, MAX_IMPORT_FILE_BYTES, MAX_IMPORT_ROWS, MAX_IMPORT_COLUMNS, type ImportFormat } from '../shared/import-limits.js';
import { CLICKHOUSE_CLOUD_CONNECTION_ID, CLOUD_QUERY_LIMITS, MAX_CLOUD_INSPECTOR_RESULT_ROWS, MAX_CLOUD_REFERENCE_RESULT_ROWS, CLOUD_SCHEMA_DATABASE_PAGE_ROWS, CLOUD_SCHEMA_TABLE_PAGE_ROWS, CLOUD_SCHEMA_COLUMN_PAGE_ROWS, CLOUD_REQUEST_TIMEOUT_MS, CLOUD_QUERY_TIMEOUT_MS, MAX_CLOUD_IMPORT_REQUEST_BYTES } from '../shared/cloud-policy.js';
import { createClient } from '@clickhouse/client';
import { randomUUID } from 'node:crypto';
import { AppError } from '../core/errors.js';
import { cloudResultStreamQuery } from '../core/cloud-query.js';
import { collectCompactStream } from '../core/compact-stream.js';
import { parseInput } from '../core/imports.js';
import { ImportMappingError, mapImportRows } from '../core/import-mapping.js';
import type { Capability, ClickHouseDocumentationEntry, ClickHouseDocumentationSummary, Column, Json, Row, Schema, SchemaColumn, SchemaTable } from '../shared/types.js';
import { EXPLORATION_FORMAT_ERROR, hasTopLevelOutputFormat, lexSql, quoteIdentifier, quoteStringLiteral, splitSql } from '../shared/sql.js';
import { buildReferenceEntryQuery, buildReferenceSearchQuery, isMissingDocumentationSourceColumn, isReferenceCategory } from '../shared/reference.js';
import { isFlamegraphSource, flamegraphQuery, parseFlamegraphRows, type FlamegraphSource } from '../shared/flamegraph.js';
import { CREATE_TABLE_COLUMN_TYPES, isValidTableDatabase, type CreateTableColumn, type CreateTableColumnType } from '../shared/table-creation.js';
import { createTableSql } from '../core/table-creation.js';
import { canDropTableTarget, dropTableSql, isSystemDatabaseName, isViewEngine, tableDeletionConfirmation } from '../shared/table-deletion.js';
import { cloudImportQueryLogOutcome } from '../shared/cloud-import-status.js';
import { parseReplicationSnapshot, replicationQueueQuery, replicationReplicasQuery, type ReplicationCapabilities } from '../shared/replication.js';
import { QUERY_LOG_SOURCES, isQueryLogSource, parseWorkloadSnapshot, WORKLOAD_WINDOWS, workloadFamiliesQuery, workloadPointsQuery, type QueryLogSource, type WorkloadWindow } from '../shared/workload.js';
import { isNativeExplorerKind, loadNativeExplorer, type NativeExplorerRequest, type NativeExplorerSnapshot } from '../shared/native-explorers.js';
import { mergeTreePartsQuery, parseMergeTreeParts, type MergeTreePartsSnapshot } from '../shared/parts.js';

const clickhouseSettings = {
    max_execution_time: CLOUD_QUERY_LIMITS.seconds,
    max_result_rows: String(CLOUD_QUERY_LIMITS.rows),
    max_result_bytes: String(CLOUD_QUERY_LIMITS.bytes),
    result_overflow_mode: 'break' as const,
    max_threads: CLOUD_QUERY_LIMITS.threads,
    output_format_json_quote_64bit_integers: 1 as const,
};
const clickhouseRunSettings = {
    ...clickhouseSettings,
    max_result_rows: '0',
    max_result_bytes: '0',
    result_overflow_mode: 'throw' as const,
    output_format_json_quote_decimals: 1 as const,
};

type CloudImportJob = { id: string; connectionId: typeof CLICKHOUSE_CLOUD_CONNECTION_ID; table: string; queryId: string; deduplicationToken?: string; rows: number; createdAt: string; status: ImportJobStatus; error?: string; reviewedAt?: string; reconciliationRequired?: boolean; tableCreated?: boolean; tableExists?: boolean };

function isSameOrigin(request: Request) {
    const origin = request.headers.get('origin');
    return !origin || origin === new URL(request.url).origin;
}

function validImportQueryId(value: unknown): value is string {
    return typeof value === 'string' && /^clickstudio-import-[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
}

function validImportDeduplicationToken(value: unknown): value is string {
    return typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
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
    if (!host || host.length > 512 || !isValidTableDatabase(database) ||
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
        request_timeout: CLOUD_REQUEST_TIMEOUT_MS,
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

export async function queryRows<T>(client: ReturnType<typeof makeClient>, query: string, queryParams: Record<string, string> = {}, timeoutMs = CLOUD_QUERY_TIMEOUT_MS, maxExecutionSeconds = CLOUD_QUERY_LIMITS.seconds, maxResultRows = MAX_CLOUD_INSPECTOR_RESULT_ROWS): Promise<T[]> {
    const result = await client.query({
        query,
        format: 'JSONEachRow',
        query_params: queryParams,
        query_id: `clickstudio-inspect-${randomUUID()}`,
        abort_signal: AbortSignal.timeout(timeoutMs),
        clickhouse_settings: { ...clickhouseSettings, max_execution_time: maxExecutionSeconds, max_result_rows: String(maxResultRows), max_result_bytes: String(CLOUD_QUERY_LIMITS.bytes), result_overflow_mode: 'throw' },
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
        const [rows, userQueryLog, queryLogFallback, replicas, replicationQueue,
            progress, explain, explainPlan, queryTree, explainPipeline, explainAnalyze,
            symbolizedTrace, addressTrace, documentation, parameters] = await Promise.all([
            queryRows<{ version: string; database: string }>(
            client,
            'SELECT version() AS version, currentDatabase() AS database',
            ),
            probe(client, "SELECT query_id, type, event_time, query_duration_ms, read_rows, read_bytes, result_rows, result_bytes, memory_usage, exception_code, normalized_query_hash, query, user, is_initial_query, normalizeQuery('SELECT 1') FROM system.user_query_log LIMIT 0"),
            probe(client, "SELECT query_id, type, event_time, query_duration_ms, read_rows, read_bytes, result_rows, result_bytes, memory_usage, exception_code, normalized_query_hash, query, user, is_initial_query, normalizeQuery('SELECT 1') FROM system.query_log LIMIT 0"),
            probe(client, 'SELECT database, table, replica_name, is_leader, is_readonly, is_session_expired, absolute_delay, queue_size, inserts_in_queue, merges_in_queue, future_parts, total_replicas, active_replicas FROM system.replicas LIMIT 0'),
            probe(client, 'SELECT database, table, type, create_time, num_tries, last_exception, postpone_reason, is_currently_executing FROM system.replication_queue LIMIT 0'),
            probe(client, 'SELECT query_id, read_rows, read_bytes, elapsed, memory_usage FROM system.processes LIMIT 0'),
            probe(client, 'EXPLAIN indexes = 1 SELECT 1'),
            probe(client, 'EXPLAIN PLAN json = 1, indexes = 1, description = 1 SELECT 1'),
            probe(client, 'EXPLAIN QUERY TREE SELECT 1'),
            probe(client, 'EXPLAIN PIPELINE graph = 1, compact = 0 SELECT 1'),
            probe(client, 'EXPLAIN ANALYZE SELECT 1'),
            probe(client, 'SELECT query_id, trace_type, symbols, lines FROM system.trace_log LIMIT 0'),
            probe(client, 'SELECT query_id, trace_type, trace, demangle(addressToSymbol(trace[1])), addressToLine(trace[1]) FROM system.trace_log LIMIT 0'),
            probe(client, 'SELECT name, type, description FROM system.documentation LIMIT 0'),
            queryRows(client, 'SELECT {value:UInt8} AS value', { value: '1' }, 8_000, 6).then(() => true).catch(() => false),
        ]);
        const queryLogSource: QueryLogSource | undefined = userQueryLog ? 'user_query_log' : queryLogFallback ? 'query_log' : undefined;
        const replicationCapabilities: ReplicationCapabilities = { replicas, queue: replicationQueue };
        const traceLogSource: FlamegraphSource | undefined = symbolizedTrace ? 'symbolized' : addressTrace ? 'addresses' : undefined;
        let cancellationAvailable = false;
        try {
            await client.command({ query: 'KILL QUERY WHERE query_id = {queryId:String} AND user = {user:String} SYNC',
                query_params: { queryId: `clickstudio-probe-${randomUUID()}`, user: credentials.username }, abort_signal: AbortSignal.timeout(5_000) });
            cancellationAvailable = true;
        } catch { }
        const unavailable = (reason: string): Capability => ({ available: false, reason });
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
            progress: progress ? { available: true } : unavailable('This user cannot read live query progress from system.processes.'),
            cancellation: cancellationAvailable ? { available: true } : unavailable('This user cannot cancel its own running queries; the server execution deadline still applies.'),
            explain: explain ? { available: true } : unavailable('EXPLAIN indexes is unavailable on this ClickHouse version or account.'),
            explainPlan: explainPlan ? { available: true } : unavailable('EXPLAIN PLAN is unavailable on this ClickHouse version or account.'),
            queryTree: queryTree ? { available: true } : unavailable('EXPLAIN QUERY TREE is unavailable on this ClickHouse version or account.'),
            explainPipeline: explainPipeline ? { available: true } : unavailable('EXPLAIN PIPELINE is unavailable on this ClickHouse version or account.'),
            pipeline: explainPipeline ? { available: true } : unavailable('ClickHouse did not accept the EXPLAIN PIPELINE capability probe.'),
            explainAnalyze: explainAnalyze ? { available: true } : unavailable('EXPLAIN ANALYZE is unavailable on this ClickHouse version or account.'),
            traceLog: traceLogSource ? { available: true } : unavailable('This user cannot read symbolized ClickHouse trace samples.'),
            ...(traceLogSource ? { traceLogSource } : {}),
            documentation: documentation ? { available: true } : unavailable('system.documentation is unavailable to this ClickHouse user.'),
            parameters: parameters ? { available: true } : unavailable('ClickHouse query parameters are unavailable on this connection.'),
        };
    } finally {
        await client.close();
    }
}

async function readSchema(credentials: CloudCredentials, url: string, offsets: { databases: number; tables: number; columns: number } = { databases: 0, tables: 0, columns: 0 }): Promise<Schema> {
    const client = makeClient(credentials, url);
    try {
        const pageParams = {
            database: credentials.database,
            databaseOffset: String(offsets.databases),
            tableOffset: String(offsets.tables),
            columnOffset: String(offsets.columns),
        };
        const [databaseRows, tableRows, columnRows] = await Promise.all([
            queryRows<Record<string, unknown>>(client,
                `SELECT name FROM system.databases WHERE lower(name) NOT IN ('system', 'information_schema') ORDER BY (name = {database:String}) DESC, name LIMIT ${CLOUD_SCHEMA_DATABASE_PAGE_ROWS} OFFSET {databaseOffset:UInt64}`, pageParams).catch(() => []),
            queryRows<Record<string, unknown>>(client,
                `SELECT database, name, engine, sorting_key, primary_key, partition_key, sampling_key, total_rows, total_bytes FROM system.tables WHERE lower(database) NOT IN ('system', 'information_schema') AND is_temporary = 0 ORDER BY (database = {database:String}) DESC, database, name LIMIT ${CLOUD_SCHEMA_TABLE_PAGE_ROWS} OFFSET {tableOffset:UInt64}`, pageParams),
            queryRows<Record<string, unknown>>(client,
                `SELECT database, table, name, type, default_kind, comment FROM system.columns WHERE lower(database) NOT IN ('system', 'information_schema') ORDER BY (database = {database:String}) DESC, database, table, position LIMIT ${CLOUD_SCHEMA_COLUMN_PAGE_ROWS} OFFSET {columnOffset:UInt64}`, pageParams),
        ]);
        const tables: SchemaTable[] = tableRows.map(row => ({
            database: asString(row.database),
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
        const pagination = {
            ...(databaseRows.length === CLOUD_SCHEMA_DATABASE_PAGE_ROWS ? { databases: offsets.databases + databaseRows.length } : {}),
            ...(tableRows.length === CLOUD_SCHEMA_TABLE_PAGE_ROWS ? { tables: offsets.tables + tableRows.length } : {}),
            ...(columnRows.length === CLOUD_SCHEMA_COLUMN_PAGE_ROWS ? { columns: offsets.columns + columnRows.length } : {}),
        };
        return {
            connectionId: CLICKHOUSE_CLOUD_CONNECTION_ID,
            fetchedAt: new Date().toISOString(),
            databases: [...new Set([credentials.database, ...databaseRows.map(row => asString(row.name)), ...tables.map(table => table.database)])].filter(name => name && !isSystemDatabaseName(name)),
            tables,
            columns,
            warnings: [],
            pagination,
            truncated: Object.keys(pagination).length > 0,
        };
    } finally {
        await client.close();
    }
}

async function createCloudTable(credentials: CloudCredentials, url: string, body: Record<string, unknown>) {
    if (!isValidTableDatabase(body.database) || isSystemDatabaseName(body.database)) throw new AppError(400, 'TABLE_DATABASE', 'Choose a valid non-system database.');
    if (!isImportIdentifier(body.name)) throw new AppError(400, 'TABLE_NAME', 'Use a valid table name.');
    if (!Array.isArray(body.columns) || body.columns.length > 50) throw new AppError(400, 'TABLE_COLUMNS', 'A table needs 1–50 columns.');
    const columns: CreateTableColumn[] = body.columns.map(value => {
        if (!isRecord(value) || !isImportIdentifier(value.name) || typeof value.type !== 'string' ||
            !(CREATE_TABLE_COLUMN_TYPES as readonly string[]).includes(value.type))
            throw new AppError(400, 'TABLE_COLUMNS', 'Check the table column names and types.');
        if (value.generatedId !== undefined && typeof value.generatedId !== 'boolean')
            throw new AppError(400, 'TABLE_COLUMNS', 'Check the generated ID option.');
        return { name: value.name, type: value.type as CreateTableColumnType, ...(value.generatedId === true ? { generatedId: true } : {}) };
    });
    const orderBy = typeof body.orderBy === 'string' ? body.orderBy : '';
    const table = `${body.database}.${body.name}`;
    const query = createTableSql(table, columns, orderBy);
    const queryId = `clickstudio-create-table-${randomUUID()}`;
    const client = makeClient(credentials, url);
    try {
        await client.command({ query, query_id: queryId, abort_signal: AbortSignal.timeout(CLOUD_QUERY_TIMEOUT_MS), clickhouse_settings: clickhouseSettings });
    } finally {
        await client.close();
    }
    return { database: body.database, table: body.name, columns, orderBy, queryId };
}

async function dropCloudTable(credentials: CloudCredentials, url: string, body: Record<string, unknown>) {
    const database = typeof body.database === 'string' ? body.database : '';
    const table = typeof body.table === 'string' ? body.table : '';
    if (!canDropTableTarget(database, table)) throw new AppError(400, 'TABLE_DROP_TARGET', 'Choose a regular table outside a system database.');
    if (body.confirmation !== tableDeletionConfirmation(database, table)) throw new AppError(400, 'TABLE_DROP_CONFIRMATION', 'Type the exact table name to confirm deletion.');
    const queryId = `clickstudio-drop-table-${randomUUID()}`;
    const client = makeClient(credentials, url);
    try {
        const target = (await queryRows<{ engine: string }>(client,
            'SELECT engine FROM system.tables WHERE database = {database:String} AND name = {table:String} LIMIT 1', { database, table }))[0];
        if (target) {
            if (isViewEngine(target.engine)) throw new AppError(400, 'TABLE_DROP_KIND', 'Select a table, not a view.');
            await client.command({ query: dropTableSql(database, table), query_id: queryId, abort_signal: AbortSignal.timeout(CLOUD_QUERY_TIMEOUT_MS), clickhouse_settings: clickhouseSettings });
        }
        return { database, table, queryId };
    } finally {
        await client.close();
    }
}

function isReadQuery(sql: string) {
    const first = lexSql(sql).find(token => token.kind === 'word')?.text.toUpperCase();
    return ['SELECT', 'WITH', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN'].includes(first ?? '');
}

function isExplainableReadQuery(sql: string) {
    return isReadQuery(sql) && lexSql(sql).find(token => token.kind === 'word')?.text.toUpperCase() !== 'EXPLAIN';
}

function safeRowCount(value: unknown): number | undefined {
    if (typeof value !== 'string' || !/^\d+$/.test(value)) return undefined;
    const count = Number(value);
    return Number.isSafeInteger(count) ? count : undefined;
}

function validRunQueryId(value: unknown): value is string {
    return typeof value === 'string' && /^clickstudio-(?:run-)?[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
}

function queryParameters(value: unknown): Record<string, string> {
    if (value === undefined) return {};
    if (!isRecord(value) || Object.keys(value).length > 50) throw new AppError(400, 'QUERY_PARAMETERS', 'Use up to 50 named query parameters.');
    const entries = Object.entries(value);
    if (entries.some(([name, item]) => !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name) || typeof item !== 'string' || item.length > 8_000))
        throw new AppError(400, 'QUERY_PARAMETERS', 'Each query parameter needs a valid name and a text value under 8 KB.');
    return Object.fromEntries(entries) as Record<string, string>;
}

async function runSql(credentials: CloudCredentials, url: string, sql: string, sessionId?: string, requestedQueryId?: string, parameters: Record<string, string> = {}) {
    const statement = sql.trim();
    if (!statement || statement.length > MAX_SQL_CHARS)
        throw new Error(`Enter one SQL statement under ${MAX_SQL_CHARS.toLocaleString()} characters.`);
    const statements = splitSql(statement);
    if (statements.length !== 1)
        throw new Error('Run one SQL statement at a time on ClickHouse Cloud.');
    if (isReadQuery(statement) && hasTopLevelOutputFormat(statement))
        throw new AppError(403, 'READ_ONLY_SQL', EXPLORATION_FORMAT_ERROR);

    const client = makeClient(credentials, url, sessionId);
    const queryId = requestedQueryId ?? `clickstudio-run-${randomUUID()}`;
    const startedAt = performance.now();
    try {
        if (!isReadQuery(statement)) {
            const result = await client.command({
                query: statement,
                query_id: queryId,
                query_params: parameters,
                abort_signal: AbortSignal.timeout(CLOUD_QUERY_TIMEOUT_MS),
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

        const result = await client.exec({
            query: cloudResultStreamQuery(statements[0]!),
            query_id: queryId,
            query_params: parameters,
            abort_signal: AbortSignal.timeout(CLOUD_QUERY_TIMEOUT_MS),
            clickhouse_settings: clickhouseRunSettings,
        });
        const bounded = await collectCompactStream(result.stream, { rows: CLOUD_QUERY_LIMITS.rows, bytes: CLOUD_QUERY_LIMITS.bytes });
        if (bounded.truncated)
            void cancelCloudQuery(credentials, url, queryId).catch(() => undefined);
        const serverBytes = Number(result.summary?.read_bytes);
        return {
            queryId: result.query_id || queryId,
            columns: bounded.columns,
            rows: bounded.rows,
            elapsedMs: performance.now() - startedAt,
            bytes: Number.isFinite(serverBytes) ? serverBytes : bounded.bytes,
            truncated: bounded.truncated,
        };
    } finally {
        await client.close();
    }
}

async function readCloudProgress(credentials: CloudCredentials, url: string, queryId: string) {
    const client = makeClient(credentials, url);
    try {
        const row = (await queryRows<Record<string, unknown>>(client,
            'SELECT toString(read_rows) AS readRows, toString(read_bytes) AS readBytes, elapsed, toString(memory_usage) AS memory FROM system.processes WHERE query_id = {queryId:String} AND user = {user:String} LIMIT 1',
            { queryId, user: credentials.username }, 8_000, 6))[0];
        if (!row) return undefined;
        const elapsed = Number(row.elapsed);
        return {
            readRows: asString(row.readRows || '0'), readBytes: asString(row.readBytes || '0'),
            elapsedMs: Number.isFinite(elapsed) ? elapsed * 1000 : 0,
            memory: asString(row.memory || '0'),
        };
    } finally { await client.close(); }
}

async function cancelCloudQuery(credentials: CloudCredentials, url: string, queryId: string) {
    const client = makeClient(credentials, url);
    try {
        const rows = await queryRows<Record<string, unknown>>(client,
            'KILL QUERY WHERE query_id = {queryId:String} AND user = {user:String} SYNC',
            { queryId, user: credentials.username }, 8_000, 8);
        return { cancelled: rows.some(row => Number(row.kill_status) === 1), queryId };
    } finally { await client.close(); }
}

async function cloudQueryTree(credentials: CloudCredentials, url: string, sql: string, parameters: Record<string, string>) {
    const client = makeClient(credentials, url);
    try {
        const rows = await queryRows<Record<string, unknown>>(client, `EXPLAIN QUERY TREE\n${sql}`, parameters);
        return rows.map(row => String(Object.values(row)[0] ?? '')).filter(Boolean);
    } finally { await client.close(); }
}

async function cloudQueryLogEvidence(credentials: CloudCredentials, url: string, queryId: string, source: QueryLogSource) {
    const client = makeClient(credentials, url);
    try {
        return await queryRows<Record<string, unknown>>(client,
            `SELECT query_id, type, toString(query_duration_ms) AS query_duration_ms, toString(read_rows) AS read_rows, toString(read_bytes) AS read_bytes, toString(result_rows) AS result_rows, toString(result_bytes) AS result_bytes, toString(memory_usage) AS memory_usage, toString(exception_code) AS exception_code FROM system.${source} WHERE query_id = {queryId:String} AND user = {user:String} AND type IN ('QueryFinish', 'ExceptionWhileProcessing', 'ExceptionBeforeStart') ORDER BY event_time DESC LIMIT 10`,
            { queryId, user: credentials.username }, 10_000, 8);
    } finally { await client.close(); }
}

async function cloudPipelineEvidence(credentials: CloudCredentials, url: string, sql: string, parameters: Record<string, string>) {
    const client = makeClient(credentials, url);
    try {
        const rows = await queryRows<Record<string, unknown>>(client, `EXPLAIN PIPELINE graph = 1, compact = 0\n${sql}`, parameters);
        return rows.map(row => String(Object.values(row)[0] ?? '')).filter(Boolean);
    } finally { await client.close(); }
}

async function cloudFlamegraph(credentials: CloudCredentials, url: string, queryId: string, startDate: string, endDate: string, source: FlamegraphSource) {
    const client = makeClient(credentials, url);
    try {
        const rows = await queryRows<Record<string, unknown>>(client, flamegraphQuery(source), { queryId, startDate, endDate }, 15_000, 12);
        return parseFlamegraphRows(queryId, rows);
    } finally { await client.close(); }
}

async function cloudReferenceSearch(credentials: CloudCredentials, url: string, query: string, category: string): Promise<ClickHouseDocumentationSummary[]> {
    if (!isReferenceCategory(category)) throw new AppError(400, 'DOCUMENTATION_CATEGORY', 'Choose a valid ClickHouse reference category.');
    const client = makeClient(credentials, url);
    try {
        const built = buildReferenceSearchQuery(query, category, true);
        let rows: Omit<ClickHouseDocumentationSummary, 'origin'>[];
        try { rows = await queryRows(client, built.sql, built.parameters, 12_000, 10, MAX_CLOUD_REFERENCE_RESULT_ROWS); }
        catch (error) {
            if (!isMissingDocumentationSourceColumn(error)) throw error;
            const fallback = buildReferenceSearchQuery(query, category, false);
            rows = await queryRows(client, fallback.sql, fallback.parameters, 12_000, 10, MAX_CLOUD_REFERENCE_RESULT_ROWS);
        }
        return rows.map(row => ({ ...row, origin: 'native' }));
    } finally { await client.close(); }
}

async function cloudReferenceEntry(credentials: CloudCredentials, url: string, name: string, type: string, serverVersion: string): Promise<ClickHouseDocumentationEntry | undefined> {
    const client = makeClient(credentials, url), parameters = { name, type };
    try {
        let rows: Omit<ClickHouseDocumentationEntry, 'origin'>[];
        try { rows = await queryRows(client, buildReferenceEntryQuery(true), parameters, 12_000, 10); }
        catch (error) {
            if (!isMissingDocumentationSourceColumn(error)) throw error;
            rows = await queryRows(client, buildReferenceEntryQuery(false), parameters, 12_000, 10);
        }
        const row = rows[0];
        return row ? { ...row, serverVersion, origin: 'native' } : undefined;
    } finally { await client.close(); }
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
        return parseWorkloadSnapshot(CLICKHOUSE_CLOUD_CONNECTION_ID, minutes, source, families, points);
    } finally {
        await client.close();
    }
}

async function readNativeExplorer(credentials: CloudCredentials, url: string, request: NativeExplorerRequest): Promise<NativeExplorerSnapshot> {
    const client = makeClient(credentials, url);
    try {
        return await loadNativeExplorer(request, (query, queryParams) => queryRows<Record<string, unknown>>(client, query, queryParams, 10_000, 8));
    } finally {
        await client.close();
    }
}

async function readTableParts(credentials: CloudCredentials, url: string, database: string, table: string): Promise<MergeTreePartsSnapshot> {
    const client = makeClient(credentials, url), parameters = { database, table };
    try {
        const target = (await queryRows<{ engine: string }>(client,
            'SELECT engine FROM system.tables WHERE database = {database:String} AND name = {table:String} LIMIT 1', parameters, 10_000, 8))[0];
        if (!target) throw new AppError(404, 'TABLE_NOT_FOUND', 'The selected table is not available on this connection.');
        if (!target.engine.endsWith('MergeTree')) throw new AppError(409, 'PARTS_UNAVAILABLE', 'Storage visualization is available for MergeTree tables.');
        const rows = await queryRows<Record<string, unknown>>(client, mergeTreePartsQuery(), parameters, 10_000, 8);
        return parseMergeTreeParts(database, table, rows);
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
        return parseReplicationSnapshot(CLICKHOUSE_CLOUD_CONNECTION_ID, { replicas: replicas.available, queue: queue.available }, replicas.rows, queue.rows);
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

function isImportFormat(value: unknown): value is ImportFormat {
    return IMPORT_FORMATS.some(format => format === value);
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

function parseImportTarget(value: unknown): { database: string; table: string } | undefined {
    if (typeof value !== 'string' || value.length > 641 || Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return undefined;
    const separator = value.indexOf('.');
    if (separator < 0) return undefined;
    const database = value.slice(0, separator), table = value.slice(separator + 1);
    if (!isValidTableDatabase(database) || !isImportTableName(table) || isSystemDatabaseName(database)) return undefined;
    return { database, table };
}

async function inspectCloudImport(credentials: CloudCredentials, url: string, queryId: string, table: string, rows: number, deduplicationToken?: string): Promise<CloudImportJob> {
    const job: CloudImportJob = { id: queryId.slice('clickstudio-import-'.length), connectionId: CLICKHOUSE_CLOUD_CONNECTION_ID, table, queryId, ...(deduplicationToken ? { deduplicationToken } : {}), rows, createdAt: new Date().toISOString(), status: 'unknown', error: 'ClickHouse could not confirm the insert. The rows may already be there.' };
    const client = makeClient(credentials, url);
    const createQueryId = `clickstudio-create-${job.id}`;
    const target = parseImportTarget(table);
    try {
        let tableCreated = false;
        try {
            const running = await queryRows<{ query_id: string }>(client,
                'SELECT query_id FROM system.processes WHERE query_id IN ({queryId:String}, {createQueryId:String}) LIMIT 2', { queryId, createQueryId }, 8_000, 6);
            if (running.length) return { ...job, status: 'running', reconciliationRequired: true, error: 'ClickHouse still reports an import step as active.' };
        } catch { }
        const insertEntries: { query_id: string; type: string; event_time: string }[] = [];
        const createEntries: { query_id: string; type: string; event_time: string }[] = [];
        for (const source of QUERY_LOG_SOURCES) {
            try {
                const entries = await queryRows<{ query_id: string; type: string; event_time: string }>(client,
                    `SELECT query_id, type, event_time FROM system.${source} WHERE query_id IN ({queryId:String}, {createQueryId:String}) ORDER BY event_time DESC LIMIT 20`, { queryId, createQueryId }, 8_000, 6);
                insertEntries.push(...entries.filter(entry => entry.query_id === queryId));
                createEntries.push(...entries.filter(entry => entry.query_id === createQueryId));
            } catch { }
        }
        tableCreated = createEntries.some(entry => entry.type === 'QueryFinish');
        const targetExists = Boolean(target && await tableExists(client, target.database, target.table));
        const outcome = cloudImportQueryLogOutcome(insertEntries);
        if (outcome === 'finished') return { ...job, status: 'succeeded', tableCreated, tableExists: targetExists, error: undefined };
        if (outcome === 'exception') return { ...job, tableCreated, tableExists: targetExists, error: targetExists
            ? `The destination table ${table} exists, but ClickHouse did not confirm its rows. Inspect the table before deciding what to do.`
            : 'ClickHouse recorded an import error. Check the destination before retrying.' };
        if (outcome === 'started') return { ...job, tableCreated, tableExists: targetExists, error: 'The insert has no completion record. Check the destination before retrying.' };
        return { ...job, tableCreated, tableExists: targetExists, ...(targetExists ? { error: `The destination table ${table} exists, but ClickHouse has no success record for the imported rows. Inspect it before trying again.` } : {}) };
    } finally {
        await client.close();
    }
}

async function tableExists(client: ReturnType<typeof makeClient>, database: string, table: string) {
    try {
        return (await queryRows<{ name: string }>(client, 'SELECT name FROM system.tables WHERE database = {database:String} AND name = {table:String} LIMIT 1', { database, table }, 8_000, 6)).length > 0;
    } catch { return false; }
}

async function commitCloudImport(form: FormData, credentials: CloudCredentials, url: string): Promise<CloudImportJob> {
    const file = form.get('file');
    if (!(file instanceof File)) throw new AppError(400, 'IMPORT_FILE', 'Choose a file to import.');
    if (file.size > MAX_IMPORT_FILE_BYTES) throw new AppError(413, 'IMPORT_BYTE_LIMIT', `Imports are limited to ${IMPORT_FILE_SIZE_LABEL}.`);
    const format = form.get('format');
    if (!isImportFormat(format)) throw new AppError(400, 'IMPORT_FORMAT', 'Use a CSV, JSON, or NDJSON file.');
    const queryIdValue = form.get('queryId');
    if (!validImportQueryId(queryIdValue)) throw new AppError(400, 'IMPORT_QUERY_ID', 'The import request id is invalid.');
    const queryId = queryIdValue;
    const deduplicationTokenValue = form.get('deduplicationToken');
    if (deduplicationTokenValue !== null && !validImportDeduplicationToken(deduplicationTokenValue)) throw new AppError(400, 'IMPORT_DEDUPLICATION_TOKEN', 'The import retry token is invalid.');
    const deduplicationToken = deduplicationTokenValue === null ? undefined : deduplicationTokenValue;
    const target = form.get('target');
    const fields = parseFormJson<Record<string, unknown>>(form, 'fields');
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw new AppError(400, 'IMPORT_MAPPING', 'Choose at least one destination column.');
    const source = await file.text();
    const parsed = parseInput(source, format);
    if (!parsed.rows.length) throw new AppError(400, 'IMPORT_EMPTY', 'The input contains no data rows.');
    const createTable = parseFormJson<{ database?: unknown; name?: unknown; columns?: unknown; generateId?: unknown }>(form, 'createTable');
    const creating = createTable !== undefined;
    let tableName: string;
    let tableDatabase = credentials.database;
    let destinationColumns: SchemaColumn[];
    let createColumns: { source: string; name: string; type: CreateTableColumnType }[] = [];
    let expectedColumns: { name: string; type: string; defaultKind: string }[] | undefined;

    if (creating) {
        if (!createTable || (createTable.database !== undefined && (!isValidTableDatabase(createTable.database) || isSystemDatabaseName(createTable.database))) || !isImportIdentifier(createTable.name) || !Array.isArray(createTable.columns) || createTable.columns.length === 0 || createTable.columns.length > MAX_IMPORT_COLUMNS ||
            (createTable.generateId !== undefined && typeof createTable.generateId !== 'boolean'))
            throw new AppError(400, 'IMPORT_CREATE_TABLE', 'Enter a table name and at least one column.');
        tableDatabase = typeof createTable.database === 'string' ? createTable.database : credentials.database;
        tableName = createTable.name;
        createColumns = createTable.columns.map(value => {
            if (!isRecord(value) || typeof value.source !== 'string' || !parsed.columns.includes(value.source) || !isImportIdentifier(value.name) ||
                typeof value.type !== 'string' || !(CREATE_TABLE_COLUMN_TYPES as readonly string[]).includes(value.type))
                throw new AppError(400, 'IMPORT_CREATE_TABLE', 'Check the new table column names and types.');
            return { source: value.source, name: value.name, type: value.type as CreateTableColumnType };
        });
        if (new Set(createColumns.map(column => column.source)).size !== createColumns.length || new Set(createColumns.map(column => column.name)).size !== createColumns.length)
            throw new AppError(400, 'IMPORT_CREATE_TABLE', 'New table column names must be unique.');
        if (createTable.generateId === true && createColumns.some(column => column.name.toLowerCase() === 'id'))
            throw new AppError(400, 'IMPORT_CREATE_TABLE', 'The file already has an id column. Map that column or rename it before adding a generated id.');
        const client = makeClient(credentials, url);
        try {
            const [database, existing] = await Promise.all([
                queryRows<{ name: string }>(client, 'SELECT name FROM system.databases WHERE name = {database:String} LIMIT 1', { database: tableDatabase }),
                queryRows<{ name: string }>(client, 'SELECT name FROM system.tables WHERE database = {database:String} AND name = {table:String} LIMIT 1', { database: tableDatabase, table: tableName }),
            ]);
            if (!database.length) throw new AppError(403, 'IMPORT_DATABASE', 'The selected database is not visible to this Cloud user.');
            if (existing.length) throw new AppError(409, 'TABLE_EXISTS', 'A table with this name already exists. Choose an existing table or a different name.');
        } finally { await client.close(); }
        destinationColumns = createColumns.map(column => ({ database: tableDatabase, table: tableName, name: column.name, type: `Nullable(${column.type})`, defaultKind: '', comment: '' }));
    } else {
        const selectedTarget = parseImportTarget(target);
        if (!selectedTarget) throw new AppError(400, 'IMPORT_TABLE', 'Choose a valid table in an accessible database.');
        tableDatabase = selectedTarget.database;
        tableName = selectedTarget.table;
        const schema = await readSchema(credentials, url);
        const selectedTable = schema.tables.find(table => table.database === tableDatabase && table.name === tableName);
        if (!selectedTable || ['View', 'MaterializedView', 'LiveView', 'WindowView'].includes(selectedTable.engine))
            throw new AppError(404, 'IMPORT_TABLE', 'The selected table is not available for inserts.');
        const allColumns = schema.columns.filter(column => column.database === tableDatabase && column.table === tableName);
        if (!allColumns.length) throw new AppError(404, 'IMPORT_TABLE', 'The selected table has no visible columns.');
        expectedColumns = parseFormJson<{ name: string; type: string; defaultKind: string }[]>(form, 'expectedColumns');
        if (!Array.isArray(expectedColumns) || JSON.stringify(expectedColumns) !== JSON.stringify(allColumns.map(({ name, type, defaultKind }) => ({ name, type, defaultKind }))))
            throw new AppError(409, 'SCHEMA_CHANGED', 'The destination schema changed. Review the updated mapping before importing.');
        destinationColumns = allColumns;
    }

    const entries = Object.entries(fields);
    const destinations = entries.map(([, destination]) => destination);
    if (!entries.length || entries.length > MAX_IMPORT_COLUMNS || destinations.some(destination => typeof destination !== 'string') || new Set(destinations).size !== destinations.length)
        throw new AppError(400, 'IMPORT_MAPPING', 'Map each destination column once.');
    for (const [sourceName, destination] of entries) {
        if (!parsed.columns.includes(sourceName) || typeof destination !== 'string' || !destinationColumns.some(column => column.name === destination && !['MATERIALIZED', 'ALIAS'].includes(column.defaultKind)))
            throw new AppError(400, 'IMPORT_MAPPING', 'Mapping references an unknown source or a non-writable destination column.');
    }

    let mappedRows: Record<string, Json>[];
    try {
        mappedRows = mapImportRows(parsed.rows, parsed.columns, fields as Record<string, string>, destinationColumns).rows;
    } catch (error) {
        if (error instanceof ImportMappingError) throw new AppError(400, error.code, error.message);
        throw error;
    }

    const client = makeClient(credentials, url);
    try {
        if (creating) {
            const definitions = [
                ...createColumns.map(column => `${quoteIdentifier(column.name)} Nullable(${column.type})`),
                ...(createTable?.generateId === true ? [`\`id\` UInt64 DEFAULT generateSerialID(${quoteStringLiteral(`${tableDatabase}.${tableName}`)})`] : []),
            ].join(', ');
            await client.command({
                query: `CREATE TABLE ${quoteIdentifier(tableDatabase)}.${quoteIdentifier(tableName)} (${definitions}) ENGINE = MergeTree ORDER BY tuple()`,
                query_id: `clickstudio-create-${queryId.slice('clickstudio-import-'.length)}`,
                abort_signal: AbortSignal.timeout(CLOUD_QUERY_TIMEOUT_MS),
                clickhouse_settings: clickhouseSettings,
            });
        }
        await client.insert({
            table: `${quoteIdentifier(tableDatabase)}.${quoteIdentifier(tableName)}`,
            values: mappedRows,
            format: 'JSONEachRow',
            query_id: queryId,
            abort_signal: AbortSignal.timeout(CLOUD_QUERY_TIMEOUT_MS),
            clickhouse_settings: { ...clickhouseSettings, input_format_defaults_for_omitted_fields: 1, input_format_null_as_default: 0, ...(deduplicationToken ? { insert_deduplication_token: deduplicationToken } : {}) },
        });
    } finally {
        await client.close();
    }
    return { id: queryId.slice('clickstudio-import-'.length), connectionId: CLICKHOUSE_CLOUD_CONNECTION_ID, table: `${tableDatabase}.${tableName}`, queryId, ...(deduplicationToken ? { deduplicationToken } : {}), rows: parsed.rows.length, createdAt: new Date().toISOString(), status: 'succeeded', tableExists: true, ...(creating ? { tableCreated: true } : {}) };
}

async function postCloudImport(request: Request): Promise<Response> {
    if (!isSameOrigin(request)) return fail('ORIGIN', 'This endpoint accepts requests from the ClickStudio site only.', 403);
    const length = Number(request.headers.get('content-length'));
    if (Number.isFinite(length) && length > MAX_CLOUD_IMPORT_REQUEST_BYTES) return fail('REQUEST_SIZE', 'The Cloud import request is too large.', 413);
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
    if (form.get('action') !== CLOUD_ACTIONS.importCommit) return fail('CLOUD_ACTION', 'Choose the Cloud import action.');
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
        if (body.action === CLOUD_ACTIONS.test)
            return json(await testConnection(credentials, url));
        if (body.action === CLOUD_ACTIONS.schema) {
            const offset = (key: 'databaseOffset' | 'tableOffset' | 'columnOffset') => {
                const value = body[key] === undefined ? 0 : Number(body[key]);
                if (!Number.isSafeInteger(value) || value < 0 || value > 100_000_000) throw new AppError(400, 'SCHEMA_OFFSET', 'The schema page is invalid.');
                return value;
            };
            return json(await readSchema(credentials, url, { databases: offset('databaseOffset'), tables: offset('tableOffset'), columns: offset('columnOffset') }));
        }
        if (body.action === CLOUD_ACTIONS.queryTree) {
            if (typeof body.sql !== 'string' || !body.sql.trim() || body.sql.length > MAX_SQL_CHARS || splitSql(body.sql).length !== 1)
                return fail('QUERY_TREE_SQL', 'Enter one SQL statement to inspect.');
            if (!isExplainableReadQuery(body.sql.trim()))
                return fail('QUERY_TREE_SQL', 'Query-tree inspection accepts one read query, such as SELECT or WITH.');
            return json(await cloudQueryTree(credentials, url, body.sql.trim(), queryParameters(body.parameters)));
        }
        if (body.action === CLOUD_ACTIONS.progress) {
            if (!validRunQueryId(body.queryId)) return fail('RUN_QUERY_ID', 'The running query id is invalid.');
            return json({ progress: await readCloudProgress(credentials, url, body.queryId) });
        }
        if (body.action === CLOUD_ACTIONS.cancel) {
            if (!validRunQueryId(body.queryId)) return fail('RUN_QUERY_ID', 'The running query id is invalid.');
            return json(await cancelCloudQuery(credentials, url, body.queryId));
        }
        if (body.action === CLOUD_ACTIONS.profile) {
            if (!validRunQueryId(body.queryId)) return fail('RUN_QUERY_ID', 'The query id is invalid.');
            if (!isQueryLogSource(body.source)) return fail('QUERY_LOG_UNAVAILABLE', 'Test the connection to check query-log access.', 409);
            return json(await cloudQueryLogEvidence(credentials, url, body.queryId, body.source));
        }
        if (body.action === CLOUD_ACTIONS.pipeline) {
            if (typeof body.sql !== 'string' || !body.sql.trim() || body.sql.length > MAX_SQL_CHARS || splitSql(body.sql).length !== 1)
                return fail('PIPELINE_SQL', 'Enter one SQL statement to inspect.');
            if (!isExplainableReadQuery(body.sql.trim()))
                return fail('PIPELINE_SQL', 'Pipeline inspection accepts one read query, such as SELECT or WITH.');
            return json(await cloudPipelineEvidence(credentials, url, body.sql.trim(), queryParameters(body.parameters)));
        }
        if (body.action === CLOUD_ACTIONS.flamegraph) {
            if (!validRunQueryId(body.queryId)) return fail('RUN_QUERY_ID', 'The query id is invalid.');
            if (!isFlamegraphSource(body.source)) return fail('TRACE_UNAVAILABLE', 'Test the connection to check trace-log access.', 409);
            const date = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? value : undefined;
            const startDate = date(body.startDate), endDate = date(body.endDate);
            if (!startDate || !endDate) return fail('TRACE_DATE', 'The query time range is invalid.');
            return json(await cloudFlamegraph(credentials, url, body.queryId, startDate, endDate, body.source));
        }
        if (body.action === CLOUD_ACTIONS.documentationSearch) {
            const query = typeof body.query === 'string' ? body.query.slice(0, 128) : '';
            const category = typeof body.category === 'string' ? body.category : 'all';
            return json(await cloudReferenceSearch(credentials, url, query, category));
        }
        if (body.action === CLOUD_ACTIONS.documentationEntry) {
            if (typeof body.name !== 'string' || body.name.length > 128 || typeof body.type !== 'string' || body.type.length > 80)
                return fail('DOCUMENTATION_ENTRY', 'Choose a valid ClickHouse reference entry.');
            const version = typeof body.serverVersion === 'string' ? body.serverVersion.slice(0, 80) : 'unknown';
            return json(await cloudReferenceEntry(credentials, url, body.name, body.type, version));
        }
        if (body.action === CLOUD_ACTIONS.nativeExplorer) {
            if (typeof body.database !== 'string' || !body.database.trim() || body.database.length > 128 || isSystemDatabaseName(body.database))
                return fail('NATIVE_EXPLORER_DATABASE', 'Choose a valid non-system database to inspect.');
            if (!isNativeExplorerKind(body.kind))
                return fail('NATIVE_EXPLORER_KIND', 'Choose a supported metadata view.');
            let request: NativeExplorerRequest;
            if (body.kind === 'lineage') request = { kind: 'lineage', database: body.database };
            else {
                if (typeof body.table !== 'string' || !body.table.trim() || body.table.length > 128)
                    return fail('NATIVE_EXPLORER_TABLE', 'Choose a valid table to inspect.');
                request = { kind: body.kind, database: body.database, table: body.table };
            }
            return json(await readNativeExplorer(credentials, url, request));
        }
        if (body.action === CLOUD_ACTIONS.tableParts) {
            if (typeof body.database !== 'string' || !body.database.trim() || body.database.length > 128 || isSystemDatabaseName(body.database))
                return fail('TABLE_PARTS_DATABASE', 'Choose a valid non-system database to inspect.');
            if (typeof body.table !== 'string' || !body.table.trim() || body.table.length > 128)
                return fail('TABLE_PARTS_TABLE', 'Choose a valid table to inspect.');
            return json(await readTableParts(credentials, url, body.database, body.table));
        }
        if (body.action === CLOUD_ACTIONS.run) {
            if (typeof body.sql !== 'string') return fail('SQL_REQUIRED', 'Enter SQL to run.');
            const sessionId = body.sessionId;
            if (sessionId !== undefined && (typeof sessionId !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(sessionId)))
                return fail('SESSION_ID', 'The SQL session id is invalid.');
            if (body.queryId !== undefined && !validRunQueryId(body.queryId)) return fail('RUN_QUERY_ID', 'The query id is invalid.');
            return json(await runSql(credentials, url, body.sql, sessionId, body.queryId as string | undefined, queryParameters(body.parameters)));
        }
        if (body.action === CLOUD_ACTIONS.workload) {
            if (!isWorkloadWindow(body.minutes)) return fail('WORKLOAD_WINDOW', 'Choose a supported workload time window.');
            const source = isQueryLogSource(body.source) ? body.source : undefined;
            if (!source) return fail('QUERY_LOG_UNAVAILABLE', 'Test the connection to check query-log access.', 409);
            return json(await readWorkload(credentials, url, body.minutes, source));
        }
        if (body.action === CLOUD_ACTIONS.replication)
            return json(await readReplication(credentials, url));
        if (body.action === CLOUD_ACTIONS.createTable)
            return json(await createCloudTable(credentials, url, body));
        if (body.action === CLOUD_ACTIONS.dropTable)
            return json(await dropCloudTable(credentials, url, body));
        if (body.action === CLOUD_ACTIONS.importStatus) {
            const targetTable = typeof body.table === 'string' ? body.table : '';
            if (!validImportQueryId(body.queryId) || !parseImportTarget(targetTable) ||
                typeof body.rows !== 'number' || !Number.isSafeInteger(body.rows) || body.rows < 1 || body.rows > MAX_IMPORT_ROWS ||
                (body.deduplicationToken !== undefined && !validImportDeduplicationToken(body.deduplicationToken)))
                return fail('IMPORT_STATUS', 'The saved import details are invalid.');
            return json(await inspectCloudImport(credentials, url, body.queryId, targetTable, body.rows, body.deduplicationToken as string | undefined));
        }
        return fail('CLOUD_ACTION', 'Choose a supported ClickHouse Cloud workspace action.');
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
