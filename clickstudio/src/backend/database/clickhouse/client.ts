import type { ImportJobStatus } from '../../../shared/database/imports/status.js';
import {
    loadNativeExplorer,
    type NativeExplorerRequest,
} from '../../../shared/database/explorer/explorers.js';
import { createClient, type ClickHouseClient } from '@clickhouse/client';
import { randomUUID } from 'node:crypto';
import type {
    ClickHouseDocumentationEntry,
    ClickHouseDocumentationSummary,
} from '../../../shared/database/reference/types.js';
import type { Connection, Manifest } from '../../../shared/database/connections/types.js';
import type { Json } from '../../../shared/common/values.js';
import type { Principal } from '../../../shared/common/identity.js';
import type { Progress, Run } from '../../../shared/queries/execution/types.js';
import type { ReferenceCategory } from '../../../shared/database/reference/reference.js';
import type { Schema } from '../../../shared/database/schema/types.js';
import {
    mergeTreePartsQuery,
    parseMergeTreeParts,
    type MergeTreePartsSnapshot,
} from '../../../shared/database/explorer/storage/parts.js';
import {
    flamegraphQuery,
    parseFlamegraphRows,
    type FlamegraphSource,
} from '../../../shared/queries/inspection/flamegraph.js';
import {
    parseReplicationSnapshot,
    replicationQueueQuery,
    replicationReplicasQuery,
    type ReplicationCapabilities,
} from '../../../shared/database/explorer/activity/replication.js';
import {
    isQueryLogSource,
    parseWorkloadSnapshot,
    workloadFamiliesQuery,
    workloadPointsQuery,
    type QueryLogSource,
    type WorkloadWindow,
} from '../../../shared/database/explorer/activity/workload.js';
import {
    collectSchemaMetadataWarnings,
    enrichSchemaTables,
    type OptionalSchemaMetadataWarning,
    type SchemaTableMetadata,
    type SchemaTableSkipIndex,
} from '../../../shared/database/schema/schema.js';
import {
    buildReferenceEntryQuery,
    buildReferenceSearchQuery,
    isMissingDocumentationSourceColumn,
} from '../../../shared/database/reference/reference.js';
import { AppError, requireThat } from '../../system/requests/errors.js';
import { collectCompactStream } from './result-stream.js';
import type { QueryDriver } from '../../queries/execution/runs.js';
import type { ImportDriver } from '../imports/imports.js';
import {
    createTableSql,
    type CreateTableColumn,
    type CreateTableDriver,
} from '../tables/create-table.js';
import {
    canDropTableTarget,
    dropTableSql,
    isSystemDatabaseName,
    isViewEngine,
} from '../../../shared/database/tables/delete-table.js';
import { splitSql } from '../../../shared/sql/sql.js';
import {
    explainPrefixLength,
    sqlForRunKind,
} from '../../../shared/queries/inspection/explain-plan.js';
import { sourcePositionFromUtf8ByteOffset } from '../../../shared/sql/parser.js';
import { quotedTable } from '../imports/imports.js';
import {
    publicProfile,
    redactor,
    type Config,
    type Profile,
} from '../../system/settings/config.js';
/** All database addresses and credentials are operator-owned; the API accepts only profile IDs. */
export class ClickHouseDriver implements QueryDriver, ImportDriver, CreateTableDriver {
    private readers = new Map<string, ClickHouseClient>();
    private writers = new Map<string, ClickHouseClient>();
    private manifests = new Map<string, Manifest>();
    private replicationCapabilities = new Map<string, ReplicationCapabilities>();
    private flamegraphSources = new Map<string, FlamegraphSource>();
    private readonly redact: (s: string) => string;
    constructor(private readonly config: Config) {
        this.redact = redactor(config);
    }
    private profile(id: string): Profile {
        const p = this.config.profiles.find(p => p.id === id);
        requireThat(p, 404, 'CONNECTION_NOT_FOUND', 'Connection not found');
        return p;
    }
    connection(_p: Principal, id: string): Connection {
        const manifest = this.manifests.get(id);
        return { ...publicProfile(this.profile(id)), ...(manifest ? { manifest } : {}) };
    }
    connections(p: Principal) {
        return this.config.profiles.map(c => this.connection(p, c.id));
    }
    private client(id: string, write = false): ClickHouseClient {
        const pool = write ? this.writers : this.readers;
        let client = pool.get(id);
        if (client) return client;
        const p = this.profile(id);
        const identity = write ? (p.writer ?? p) : p;
        client = createClient({
            url: p.url,
            database: p.database,
            username: identity.username,
            password: identity.password,
            request_timeout: 135000,
            max_open_connections: 6,
            application: 'clickstudio',
        });
        pool.set(id, client);
        return client;
    }
    private safeError(error: unknown): AppError {
        const message = this.redact(
            error instanceof Error ? error.message : 'ClickHouse request failed',
        );
        const position = /at position (\d+)/i.exec(message)?.[1];
        const denied = /not enough privileges|access denied|authentication failed/i.test(message);
        const cap = /TOO_MANY_ROWS_OR_BYTES|LIMIT_EXCEEDED|MEMORY_LIMIT_EXCEEDED/i.test(message);
        const getErrorStatus = () => {
            if (denied) {
                return 403;
            }

            if (cap) {
                return 413;
            }

            return 502;
        };
        const getErrorCode = () => {
            if (denied) {
                return 'CLICKHOUSE_PERMISSION';
            }

            if (cap) {
                return 'SERVER_RESOURCE_LIMIT';
            }

            return 'CLICKHOUSE_ERROR';
        };
        return new AppError(
            getErrorStatus(),
            getErrorCode(),
            message,
            undefined,
            position ? Math.max(0, Number(position) - 1) : undefined,
        );
    }
    private async rows<T>(
        id: string,
        sql: string,
        parameters: Record<string, string> = {},
        signal?: AbortSignal,
    ): Promise<T[]> {
        try {
            const set = await this.client(id).query({
                query: sql,
                format: 'JSONEachRow',
                query_params: parameters,
                query_id: `clickstudio-inspect-${randomUUID()}`,
                abort_signal: signal
                    ? AbortSignal.any([signal, AbortSignal.timeout(10000)])
                    : AbortSignal.timeout(10000),
                clickhouse_settings: {
                    readonly: '1',
                    max_execution_time: 8,
                    max_result_rows: '6000',
                    max_result_bytes: '3000000',
                    result_overflow_mode: 'throw',
                    max_threads: 2,
                },
            });
            return await set.json<T>();
        } catch (error) {
            throw this.safeError(error);
        }
    }
    async test(id: string): Promise<Connection> {
        const profile = this.profile(id),
            isPublicPlayground = profile.publicPlayground === true;
        const version =
            (
                await this.rows<{
                    version: string;
                }>(id, 'SELECT version() AS version')
            )[0]?.version ?? 'unknown';
        const probe = async (sql: string) => {
            try {
                await this.rows(id, sql);
                return { available: true };
            } catch (error) {
                return {
                    available: false,
                    reason: error instanceof Error ? error.message : 'Not permitted',
                };
            }
        };
        const [
            schema,
            progress,
            userQueryLog,
            queryLogFallback,
            documentation,
            explain,
            explainPlan,
            queryTree,
            pipeline,
            explainAnalyze,
            traceLogSymbolized,
            traceLogAddresses,
            replicas,
            replicationQueue,
        ] = await Promise.all([
            probe('SELECT name FROM system.columns LIMIT 1'),
            probe('SELECT query_id FROM system.processes LIMIT 0'),
            probe(
                "SELECT query_id, type, query_duration_ms, read_rows, read_bytes, result_rows, result_bytes, memory_usage, exception_code, normalized_query_hash, query, user, is_initial_query, normalizeQuery('SELECT 1') FROM system.user_query_log LIMIT 0",
            ),
            probe(
                "SELECT query_id, type, query_duration_ms, read_rows, read_bytes, result_rows, result_bytes, memory_usage, exception_code, normalized_query_hash, query, user, is_initial_query, normalizeQuery('SELECT 1') FROM system.query_log LIMIT 0",
            ),
            probe('SELECT name, type, description FROM system.documentation LIMIT 0'),
            probe('EXPLAIN indexes = 1 SELECT 1'),
            probe('EXPLAIN PLAN json = 1, indexes = 1, description = 1 SELECT 1'),
            probe('EXPLAIN QUERY TREE SELECT 1'),
            probe('EXPLAIN PIPELINE graph = 1, compact = 0 SELECT 1'),
            probe('EXPLAIN ANALYZE SELECT 1'),
            probe('SELECT query_id, trace_type, symbols, lines FROM system.trace_log LIMIT 0'),
            probe(
                'SELECT query_id, trace_type, trace, demangle(addressToSymbol(trace[1])), addressToLine(trace[1]) FROM system.trace_log LIMIT 0',
            ),
            probe(
                'SELECT database, table, replica_name, is_leader, is_readonly, is_session_expired, absolute_delay, queue_size, inserts_in_queue, merges_in_queue, future_parts, total_replicas, active_replicas FROM system.replicas LIMIT 0',
            ),
            probe(
                'SELECT database, table, type, create_time, num_tries, last_exception, postpone_reason, is_currently_executing FROM system.replication_queue LIMIT 0',
            ),
        ]);
        let queryLogSource: QueryLogSource | undefined;

        if (userQueryLog.available) {
            queryLogSource = 'user_query_log';
        } else if (queryLogFallback.available) {
            queryLogSource = 'query_log';
        } else {
            queryLogSource = undefined;
        }
        const queryLog = queryLogSource ? { available: true } : queryLogFallback;
        let flamegraphSource: FlamegraphSource | undefined;

        if (traceLogSymbolized.available) {
            flamegraphSource = 'symbolized';
        } else if (traceLogAddresses.available) {
            flamegraphSource = 'addresses';
        } else {
            flamegraphSource = undefined;
        }
        if (flamegraphSource) this.flamegraphSources.set(id, flamegraphSource);
        else this.flamegraphSources.delete(id);
        const replication: ReplicationCapabilities = {
            replicas: replicas.available,
            queue: replicationQueue.available,
        };
        this.replicationCapabilities.set(id, replication);
        // KILL of a random, nonexistent own query checks cancellation permission without touching a
        // real query.
        let cancellation: Manifest['cancellation'];
        try {
            await this.client(id).command({
                query: 'KILL QUERY WHERE query_id = {queryId:String} AND user = {user:String} SYNC',
                query_params: {
                    queryId: `clickstudio-probe-${randomUUID()}`,
                    user: this.profile(id).username,
                },
                abort_signal: AbortSignal.timeout(5000),
            });
            cancellation = { available: true };
        } catch {
            cancellation = {
                available: false,
                reason: 'Own-query cancellation is not permitted; transport abort and server deadline still apply.',
            };
        }
        const manifest: Manifest = {
            version: 1,
            serverVersion: version,
            testedAt: new Date().toISOString(),
            schema,
            progress,
            queryLog,
            ...(queryLogSource ? { queryLogSource } : {}),
            traceLog: flamegraphSource
                ? { available: true }
                : {
                      available: false,
                      reason:
                          traceLogSymbolized.reason ??
                          traceLogAddresses.reason ??
                          'ClickHouse trace-log symbols are unavailable to this reader.',
                  },
            replication:
                replication.replicas || replication.queue
                    ? { available: true }
                    : {
                          available: false,
                          reason:
                              replicas.reason ??
                              replicationQueue.reason ??
                              'Replication system tables are unavailable to this reader.',
                      },
            documentation,
            explain,
            explainPlan,
            queryTree,
            pipeline,
            explainAnalyze,
            cancellation,
            import: isPublicPlayground
                ? { available: false, reason: 'The public ClickHouse Playground is read only.' }
                : {
                      available: true,
                      reason: 'Writes use the connection identity or optional writer credentials; ClickHouse permissions apply',
                  },
            scripts: isPublicPlayground
                ? {
                      available: false,
                      reason: 'Run one statement at a time on the public ClickHouse Playground.',
                  }
                : { available: true },
            parameters: isPublicPlayground
                ? {
                      available: false,
                      reason: 'Query parameters are unavailable on the public ClickHouse Playground connection.',
                  }
                : { available: true },
        };
        this.manifests.set(id, manifest);
        return this.connection({ id: 'local-owner', role: 'owner' }, id);
    }
    async schema(id: string): Promise<Schema> {
        const profile = this.profile(id),
            database = profile.database,
            isPublicPlayground = profile.publicPlayground === true;
        const optionalRows = async <T>(
            label: string,
            sql: string,
            parameters: Record<string, string> = { database },
        ): Promise<{ rows?: T[]; warning?: string; permissionDenied?: boolean }> => {
            try {
                return { rows: await this.rows<T>(id, sql, parameters) };
            } catch (error) {
                return {
                    warning: `${label} metadata is unavailable to this reader or ClickHouse version.`,
                    permissionDenied:
                        error instanceof AppError && error.code === 'CLICKHOUSE_PERMISSION',
                };
            }
        };
        const [
            databases,
            columns,
            tables,
            systemColumns,
            systemTables,
            tableDetails,
            projections,
            skipIndexes,
            dictionaries,
        ] = await Promise.all([
            optionalRows<{ name: string }>(
                'Database',
                "SELECT name FROM system.databases WHERE lower(name) NOT IN ('system', 'information_schema') ORDER BY (name = {database:String}) DESC, name LIMIT 1001",
                { database },
            ),
            this.rows<{
                database: string;
                table: string;
                name: string;
                type: string;
                default_kind: string;
                comment: string;
            }>(
                id,
                "SELECT database, table, name, type, default_kind, comment FROM system.columns WHERE lower(database) NOT IN ('system', 'information_schema') ORDER BY (database = {database:String}) DESC, database, table, position LIMIT 5001",
                { database },
            ),
            this.rows<{
                database: string;
                name: string;
                engine: string;
            }>(
                id,
                "SELECT database, name, engine FROM system.tables WHERE lower(database) NOT IN ('system', 'information_schema') ORDER BY (database = {database:String}) DESC, database, name LIMIT 1001",
                { database },
            ),
            optionalRows<{
                database: string;
                table: string;
                name: string;
                type: string;
                default_kind: string;
                comment: string;
            }>(
                'System table columns',
                'SELECT database, table, name, type, default_kind, comment FROM system.columns WHERE database = {database:String} ORDER BY table, position LIMIT 5001',
                { database: 'system' },
            ),
            optionalRows<{
                database: string;
                name: string;
                engine: string;
            }>(
                'System tables',
                'SELECT database, name, engine FROM system.tables WHERE database = {database:String} ORDER BY name LIMIT 1001',
                { database: 'system' },
            ),
            optionalRows<{
                database: string;
                name: string;
                order_by: string;
                primary_key: string;
                partition_key: string;
                sampling_key: string;
                row_estimate: string;
                size_bytes: string;
                uncompressed_bytes: string;
                parts: string;
                active_parts: string;
                ttl_configured: number;
                materialized_view_target: string;
                skip_index_types: string[];
            }>(
                'Table keys, storage, and view',
                `SELECT database, name, sorting_key AS order_by, primary_key, partition_key, sampling_key,
                ifNull(toString(total_rows), '') AS row_estimate, ifNull(toString(total_bytes), '') AS size_bytes,
                ifNull(toString(total_bytes_uncompressed), '') AS uncompressed_bytes, ifNull(toString(parts), '') AS parts, ifNull(toString(active_parts), '') AS active_parts,
                match(create_table_query, '(?i)(^|[^A-Za-z0-9_])TTL([^A-Za-z0-9_]|$)') > 0 AS ttl_configured,
                if(target_database = '', '', concat(target_database, '.', target_table)) AS materialized_view_target,
                skipping_indices_types AS skip_index_types
                FROM system.tables WHERE lower(database) NOT IN ('system', 'information_schema') ORDER BY (database = {database:String}) DESC, database, name LIMIT 1001`,
                { database },
            ),
            optionalRows<{
                database: string;
                table: string;
                name: string;
                type: string;
                sortingKey: string;
            }>(
                'Projection',
                `SELECT database, table, name, type, arrayStringConcat(sorting_key, ', ') AS sortingKey
                FROM system.projections WHERE lower(database) NOT IN ('system', 'information_schema') ORDER BY (database = {database:String}) DESC, database, table, name LIMIT 5001`,
                { database },
            ),
            optionalRows<SchemaTableSkipIndex>(
                'Skip-index',
                `SELECT database, table, name, type, expr AS expression, toString(granularity) AS granularity
                FROM system.data_skipping_indices WHERE lower(database) NOT IN ('system', 'information_schema') ORDER BY (database = {database:String}) DESC, database, table, name LIMIT 5001`,
                { database },
            ),
            optionalRows<{
                database: string;
                name: string;
                status: string;
                type: string;
                key_columns: string;
                attribute_columns: string;
                element_count: string;
                memory_bytes: string;
                last_successful_update: string;
            }>(
                'Dictionary',
                `SELECT database, name, status, type, arrayStringConcat(key.names, ', ') AS key_columns,
                arrayStringConcat(attribute.names, ', ') AS attribute_columns, toString(element_count) AS element_count,
                toString(bytes_allocated) AS memory_bytes, toString(last_successful_update_time) AS last_successful_update
                FROM system.dictionaries WHERE (lower(database) NOT IN ('system', 'information_schema') OR database = '') ORDER BY database, name LIMIT 1001`,
                {},
            ),
        ]);
        const allColumns = [...columns, ...(systemColumns.rows ?? [])],
            allTables = [...tables, ...(systemTables.rows ?? [])];
        const tableTruncated =
            allColumns.length > 10000 ||
            allTables.length > 2000 ||
            columns.length > 5000 ||
            tables.length > 1000 ||
            (systemColumns.rows?.length ?? 0) > 5000 ||
            (systemTables.rows?.length ?? 0) > 1000;
        const optionalObjectMetadata: OptionalSchemaMetadataWarning[] = [
            {
                kind: 'projection',
                warning: projections.warning,
                permissionDenied: projections.permissionDenied,
            },
            {
                kind: 'skip index',
                warning: skipIndexes.warning,
                permissionDenied: skipIndexes.permissionDenied,
            },
            {
                kind: 'dictionary',
                warning: dictionaries.warning,
                permissionDenied: dictionaries.permissionDenied,
            },
        ];
        const metadataWarnings = collectSchemaMetadataWarnings(
            [databases.warning, systemColumns.warning, systemTables.warning, tableDetails.warning],
            optionalObjectMetadata,
            isPublicPlayground,
        );
        if ((tableDetails.rows?.length ?? 0) > 1000)
            metadataWarnings.push('Table metadata preview truncated.');
        if ((projections.rows?.length ?? 0) > 5000)
            metadataWarnings.push('Projection metadata preview truncated.');
        if ((skipIndexes.rows?.length ?? 0) > 5000)
            metadataWarnings.push('Skip-index metadata preview truncated.');
        if ((dictionaries.rows?.length ?? 0) > 1000)
            metadataWarnings.push('Dictionary metadata preview truncated.');
        const tableMetadata: SchemaTableMetadata[] | undefined = tableDetails.rows
            ?.slice(0, 1000)
            .map(row => ({
                database: row.database,
                name: row.name,
                orderBy: row.order_by,
                primaryKey: row.primary_key,
                partitionKey: row.partition_key,
                samplingKey: row.sampling_key,
                rowEstimate: row.row_estimate || null,
                sizeBytes: row.size_bytes || null,
                uncompressedBytes: row.uncompressed_bytes || null,
                parts: row.parts || null,
                activeParts: row.active_parts || null,
                ttlConfigured: row.ttl_configured > 0,
                materializedViewTarget: row.materialized_view_target || undefined,
                skipIndexTypes: row.skip_index_types,
            }));
        const projectionMetadata = projections.rows?.slice(0, 5000).map(row => ({
            database: row.database,
            table: row.table,
            name: row.name,
            type: row.type,
            sortingKey: row.sortingKey,
        }));
        const indexMetadata = skipIndexes.rows?.slice(0, 5000);
        const tableRows = allTables.slice(0, 2000);
        const enrichedTables = enrichSchemaTables(tableRows, {
            tables: tableMetadata,
            projections: projectionMetadata,
            skipIndexes: indexMetadata,
        });
        const dictionaryRows = dictionaries.rows?.slice(0, 1000).map(row => ({
            database: row.database,
            name: row.name,
            status: row.status,
            type: row.type,
            keyColumns: row.key_columns,
            attributeColumns: row.attribute_columns,
            elementCount: row.element_count,
            memoryBytes: row.memory_bytes,
            lastSuccessfulUpdate: row.last_successful_update,
        }));
        const truncated = tableTruncated;
        const visibleDatabases = [
            ...new Set([
                database,
                ...(databases.rows ?? []).map(row => row.name),
                ...allTables.map(table => table.database),
            ]),
        ].filter(name => name && !isSystemDatabaseName(name));
        return {
            connectionId: id,
            fetchedAt: new Date().toISOString(),
            databases: visibleDatabases,
            tables: enrichedTables,
            columns: allColumns.slice(0, 10000).map(c => ({
                database: c.database,
                table: c.table,
                name: c.name,
                type: c.type,
                defaultKind: c.default_kind,
                comment: c.comment,
            })),
            dictionaries: dictionaryRows,
            metadataWarnings: metadataWarnings.length ? metadataWarnings : undefined,
            truncated,
            warnings: [
                `Schema lists databases and tables visible to this ClickHouse user. ClickHouse permissions apply to writes.`,
                ...(truncated ? ['Schema preview truncated.'] : []),
            ],
        };
    }
    async searchDocumentation(
        id: string,
        query: string,
        category: ReferenceCategory,
    ): Promise<ClickHouseDocumentationSummary[]> {
        const withSource = buildReferenceSearchQuery(query, category, true);
        try {
            return await this.rows<ClickHouseDocumentationSummary>(
                id,
                withSource.sql,
                withSource.parameters,
            );
        } catch (error) {
            if (!isMissingDocumentationSourceColumn(error)) throw error;
            const withoutSource = buildReferenceSearchQuery(query, category, false);
            return this.rows<ClickHouseDocumentationSummary>(
                id,
                withoutSource.sql,
                withoutSource.parameters,
            );
        }
    }
    async documentationEntry(
        id: string,
        name: string,
        type: string,
    ): Promise<ClickHouseDocumentationEntry | undefined> {
        const parameters = { name, type };
        let rows: Array<Omit<ClickHouseDocumentationEntry, 'origin'>>;
        try {
            rows = await this.rows<Omit<ClickHouseDocumentationEntry, 'origin'>>(
                id,
                buildReferenceEntryQuery(true),
                parameters,
            );
        } catch (error) {
            if (!isMissingDocumentationSourceColumn(error)) throw error;
            rows = await this.rows<Omit<ClickHouseDocumentationEntry, 'origin'>>(
                id,
                buildReferenceEntryQuery(false),
                parameters,
            );
        }
        const row = rows[0];
        return row
            ? {
                  ...row,
                  serverVersion:
                      this.manifests.get(id)?.serverVersion ?? row.serverVersion ?? 'unknown',
                  origin: 'native',
              }
            : undefined;
    }
    async execute(run: Run, signal: AbortSignal, progress: (p: Progress) => void) {
        let timer: ReturnType<typeof setInterval> | undefined,
            polling = false;
        const statement = splitSql(run.sql)[0]!.sql;
        const sql = sqlForRunKind(statement, run.kind);
        if (this.manifests.get(run.connectionId)?.progress.available)
            timer = setInterval(() => {
                if (polling || signal.aborted) return;
                polling = true;
                void this.rows<{
                    read_rows: string;
                    read_bytes: string;
                    elapsed: number;
                    memory_usage: string;
                }>(
                    run.connectionId,
                    'SELECT toString(read_rows) AS read_rows, toString(read_bytes) AS read_bytes, elapsed, toString(memory_usage) AS memory_usage FROM system.processes WHERE query_id = {id:String}',
                    { id: run.queryId },
                )
                    .then(r => {
                        const p = r[0];
                        if (p && !signal.aborted)
                            progress({
                                readRows: p.read_rows,
                                readBytes: p.read_bytes,
                                elapsedMs: p.elapsed * 1000,
                                memory: p.memory_usage,
                            });
                    })
                    .catch(() => undefined)
                    .finally(() => {
                        polling = false;
                    });
            }, 750);
        try {
            const maxResultRows = this.profile(run.connectionId).publicPlayground
                ? '10000'
                : '100000';
            const response = await this.client(run.connectionId).exec({
                query: `${sql}\nFORMAT JSONCompactEachRowWithNamesAndTypes`,
                query_id: run.queryId,
                query_params: run.parameters,
                abort_signal: signal,
                clickhouse_settings: {
                    readonly: '1',
                    max_execution_time: run.limits.seconds,
                    max_memory_usage: String(run.limits.memory),
                    max_threads: run.limits.threads,
                    max_result_rows: maxResultRows,
                    max_result_bytes: '50000000',
                    result_overflow_mode: 'throw',
                    max_rows_to_read: '100000000',
                    max_bytes_to_read: '5000000000',
                    output_format_json_quote_64bit_integers: 1,
                    output_format_json_quote_decimals: 1,
                    log_comment: JSON.stringify(run.tags),
                },
            });
            const result = await collectCompactStream(response.stream, run.limits);
            if (result.truncated) void this.cancel(run).catch(() => undefined);
            return {
                ...result,
                serverVersion: this.manifests.get(run.connectionId)?.serverVersion,
                warnings: result.truncated
                    ? [
                          'Output stopped at the application row/byte cap. This is a retained prefix, not the full answer.',
                      ]
                    : [],
            };
        } catch (error) {
            if (signal.aborted) throw signal.reason;
            const failure = this.safeError(error);
            if (
                failure.position !== undefined &&
                run.sourceFrom !== undefined &&
                run.sourceTo !== undefined
            ) {
                const prefix = explainPrefixLength(run.kind);
                const position = sourcePositionFromUtf8ByteOffset(
                    statement,
                    failure.position,
                    run.sourceFrom,
                    run.sourceTo,
                    prefix,
                );
                throw new AppError(
                    failure.status,
                    failure.code,
                    failure.message,
                    failure.remediation,
                    position,
                );
            }
            throw failure;
        } finally {
            if (timer) clearInterval(timer);
        }
    }
    async cancel(run: Run) {
        try {
            await this.client(run.connectionId).command({
                query: 'KILL QUERY WHERE query_id = {id:String} AND user = {user:String} SYNC',
                query_params: { id: run.queryId, user: this.profile(run.connectionId).username },
                abort_signal: AbortSignal.timeout(5000),
            });
        } catch (error) {
            throw this.safeError(error);
        }
    }
    async profileEvidence(run: Run) {
        requireThat(
            this.manifests.get(run.connectionId)?.queryLog.available,
            409,
            'CAPABILITY_UNAVAILABLE',
            'Test the connection; query-log visibility is required',
        );
        return this.rows(
            run.connectionId,
            `SELECT query_id, type, query_duration_ms, read_rows, read_bytes, result_rows, result_bytes, memory_usage, exception_code FROM ${this.queryLogTable(run.connectionId)} WHERE query_id = {id:String} AND type IN ('QueryFinish', 'ExceptionWhileProcessing', 'ExceptionBeforeStart') ORDER BY event_time DESC LIMIT 10`,
            { id: run.queryId },
        );
    }
    private queryLogTable(id: string) {
        const source = this.manifests.get(id)?.queryLogSource;
        requireThat(
            isQueryLogSource(source),
            409,
            'CAPABILITY_UNAVAILABLE',
            'Test the connection; query-log visibility is required',
        );
        return `system.${source}`;
    }
    async workload(id: string, minutes: WorkloadWindow) {
        const manifest = this.manifests.get(id);
        requireThat(
            manifest?.queryLog.available,
            409,
            'CAPABILITY_UNAVAILABLE',
            manifest?.queryLog.reason ?? 'Query-log visibility is required for workload analysis',
        );
        const source = manifest.queryLogSource;
        requireThat(
            isQueryLogSource(source),
            409,
            'CAPABILITY_UNAVAILABLE',
            'Test the connection; query-log visibility is required',
        );
        const parameters = { minutes: String(minutes), username: this.profile(id).username };
        const [families, points] = await Promise.all([
            this.rows<Record<string, unknown>>(id, workloadFamiliesQuery(source), parameters),
            this.rows<Record<string, unknown>>(id, workloadPointsQuery(source), parameters),
        ]);
        return parseWorkloadSnapshot(id, minutes, source, families, points);
    }
    async replication(id: string) {
        const manifest = this.manifests.get(id);
        requireThat(
            manifest?.replication?.available,
            409,
            'CAPABILITY_UNAVAILABLE',
            manifest?.replication?.reason ??
                'Replication system tables are unavailable on this connection',
        );
        const capabilities = this.replicationCapabilities.get(id) ?? {
            replicas: false,
            queue: false,
        };
        const [replicaRows, queueRows] = await Promise.all([
            capabilities.replicas
                ? this.rows<Record<string, unknown>>(id, replicationReplicasQuery())
                : Promise.resolve([]),
            capabilities.queue
                ? this.rows<Record<string, unknown>>(id, replicationQueueQuery())
                : Promise.resolve([]),
        ]);
        return parseReplicationSnapshot(id, capabilities, replicaRows, queueRows);
    }
    async profileFlamegraph(run: Run) {
        requireThat(
            this.manifests.get(run.connectionId)?.traceLog?.available,
            409,
            'CAPABILITY_UNAVAILABLE',
            this.manifests.get(run.connectionId)?.traceLog?.reason ??
                'ClickHouse trace-log symbols are unavailable',
        );
        const source = this.flamegraphSources.get(run.connectionId);
        requireThat(
            source,
            409,
            'CAPABILITY_UNAVAILABLE',
            'Test the connection; ClickHouse trace-log symbolization is unavailable',
        );
        const asDate = (value: string | undefined) => {
            const parsed = value ? new Date(value) : new Date();
            return Number.isFinite(parsed.getTime())
                ? parsed.toISOString().slice(0, 10)
                : new Date().toISOString().slice(0, 10);
        };
        const rows = await this.rows<Record<string, unknown>>(
            run.connectionId,
            flamegraphQuery(source),
            {
                queryId: run.queryId,
                startDate: asDate(run.createdAt),
                endDate: asDate(run.finishedAt ?? run.createdAt),
            },
        );
        return parseFlamegraphRows(run.queryId, rows);
    }
    async queryTree(
        id: string,
        sql: string,
        parameters: Record<string, string> = {},
    ): Promise<string[]> {
        const rows = await this.rows<Record<string, unknown>>(
            id,
            `EXPLAIN QUERY TREE\n${sql}`,
            parameters,
        );
        return rows.map(row => String(Object.values(row)[0] ?? '')).filter(Boolean);
    }
    async nativeExplorer(id: string, request: NativeExplorerRequest, signal?: AbortSignal) {
        return loadNativeExplorer(
            request,
            (sql, parameters) => this.rows(id, sql, parameters, signal),
            signal,
        );
    }
    async tableParts(id: string, database: string, table: string): Promise<MergeTreePartsSnapshot> {
        const parameters = { database, table };
        const target = (
            await this.rows<{ engine: string }>(
                id,
                'SELECT engine FROM system.tables WHERE database = {database:String} AND name = {table:String} LIMIT 1',
                parameters,
            )
        )[0];
        requireThat(
            target,
            404,
            'TABLE_NOT_FOUND',
            'The selected table is not available on this connection',
        );
        requireThat(
            target.engine.endsWith('MergeTree'),
            409,
            'PARTS_UNAVAILABLE',
            'Storage visualization is available for MergeTree tables',
        );
        const rows = await this.rows<Record<string, unknown>>(
            id,
            mergeTreePartsQuery(),
            parameters,
        );
        return parseMergeTreeParts(database, table, rows);
    }
    async profilePipeline(run: Run): Promise<string[]> {
        requireThat(
            this.manifests.get(run.connectionId)?.pipeline.available,
            409,
            'CAPABILITY_UNAVAILABLE',
            'Test the connection; pipeline inspection is required',
        );
        const statement = splitSql(run.sql)[0]?.sql;
        requireThat(statement, 400, 'EMPTY_SQL', 'The run has no SQL statement to inspect');
        const rows = await this.rows<Record<string, unknown>>(
            run.connectionId,
            `EXPLAIN PIPELINE graph = 1, compact = 0\n${statement}`,
            run.parameters,
        );
        return rows.map(row => String(Object.values(row)[0] ?? '')).filter(Boolean);
    }
    async targets(id: string) {
        const rows = await this.rows<{ database: string; name: string }>(
            id,
            "SELECT database, name FROM system.tables WHERE lower(database) NOT IN ('system', 'information_schema') AND is_temporary = 0 AND engine NOT IN ('View', 'MaterializedView', 'LiveView', 'WindowView') ORDER BY (database = {database:String}) DESC, database, name LIMIT 5001",
            { database: this.profile(id).database },
        );
        return rows
            .filter(row => this.allowed(id, `${row.database}.${row.name}`))
            .map(row => `${row.database}.${row.name}`);
    }
    allowed(id: string, table: string) {
        const [database, name, ...extra] = table.split('.');
        return (
            extra.length === 0 &&
            /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(database ?? '') &&
            !isSystemDatabaseName(database ?? '') &&
            /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name ?? '')
        );
    }
    database(id: string) {
        return this.profile(id).database;
    }
    async createTable(
        id: string,
        table: string,
        columns: CreateTableColumn[],
        orderBy: string,
        queryId: string,
    ) {
        requireThat(
            this.allowed(id, table),
            403,
            'TABLE_CREATE_NOT_ALLOWED',
            'Choose a valid table in a non-system database',
        );
        try {
            await this.client(id, true).command({
                query: createTableSql(table, columns, orderBy),
                query_id: queryId,
                abort_signal: AbortSignal.timeout(60000),
                clickhouse_settings: { max_execution_time: 55, max_memory_usage: '536870912' },
            });
        } catch (error) {
            throw this.safeError(error);
        }
    }
    async dropTable(id: string, database: string, table: string, queryId: string) {
        requireThat(
            canDropTableTarget(database, table) && !isSystemDatabaseName(database),
            403,
            'TABLE_DROP_NOT_ALLOWED',
            'Choose a regular table outside a system database',
        );
        const target = (
            await this.rows<{ engine: string }>(
                id,
                'SELECT engine FROM system.tables WHERE database = {database:String} AND name = {table:String} LIMIT 1',
                { database, table },
            )
        )[0];
        if (!target) return;
        requireThat(
            !isViewEngine(target.engine),
            400,
            'TABLE_DROP_KIND',
            'Select a table, not a view',
        );
        try {
            await this.client(id, true).command({
                query: dropTableSql(database, table),
                query_id: queryId,
                abort_signal: AbortSignal.timeout(60000),
                clickhouse_settings: { max_execution_time: 55, max_memory_usage: '536870912' },
            });
        } catch (error) {
            throw this.safeError(error);
        }
    }
    async insert(
        id: string,
        table: string,
        rows: Record<string, Json>[],
        queryId: string,
        deduplicationToken?: string,
    ) {
        requireThat(
            this.allowed(id, table),
            403,
            'IMPORT_NOT_ALLOWED',
            'Choose a valid table in a non-system database',
        );
        try {
            await this.client(id, true).insert({
                table: quotedTable(table),
                values: rows,
                format: 'JSONEachRow',
                query_id: queryId,
                abort_signal: AbortSignal.timeout(60000),
                clickhouse_settings: {
                    max_execution_time: 55,
                    max_memory_usage: '536870912',
                    input_format_defaults_for_omitted_fields: 1,
                    input_format_null_as_default: 0,
                    ...(deduplicationToken
                        ? { insert_deduplication_token: deduplicationToken }
                        : {}),
                },
            });
        } catch (error) {
            throw this.safeError(error);
        }
    }
    async inspectInsert(id: string, queryId: string): Promise<ImportJobStatus> {
        const source = this.manifests.get(id)?.queryLogSource;
        const [active, events] = await Promise.all([
            this.rows<{ query_id: string }>(
                id,
                'SELECT query_id FROM system.processes WHERE query_id = {id:String} LIMIT 1',
                { id: queryId },
            ).catch(() => []),
            source
                ? this.rows<{ type: string; exception_code: string }>(
                      id,
                      `SELECT type, toString(exception_code) AS exception_code FROM system.${source} WHERE query_id = {id:String} AND type IN ('QueryFinish', 'ExceptionWhileProcessing', 'ExceptionBeforeStart') ORDER BY event_time DESC LIMIT 1`,
                      { id: queryId },
                  ).catch(() => [])
                : Promise.resolve([]),
        ]);
        if (active.length) return 'running';
        const latest = events[0];
        if (latest?.type === 'QueryFinish' && latest.exception_code === '0') return 'succeeded';
        return 'unknown';
    }
    async close() {
        await Promise.all([...this.readers.values(), ...this.writers.values()].map(c => c.close()));
    }
}
