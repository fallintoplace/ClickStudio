import { nativeExplorerFixture } from '../shared/native-explorer-fixtures.js';
import type { ApiError, QueryDocument, Result, ResultPage, Run, Schema, Script } from '../shared/types.js';
import { splitSql } from '../shared/sql.js';
import { sqlForRunKind } from '../shared/explain-plan.js';
import { isResult, isRun } from '../shared/run-wire.js';
import { loadPlaygroundSchema, PLAYGROUND_CONNECTION, PLAYGROUND_CONNECTION_ID, queryPlayground, queryPlaygroundQueryTree } from './playground.js';
import { CLICKHOUSE_CLOUD_CONNECTION_ID, getClickHouseCloudConnection, loadClickHouseCloudSchema, runClickHouseCloudSql, CloudRequestError } from './cloud-connection.js';
import { demoMergeTreePartRows } from '../shared/demo-fixtures.js';
import { parseMergeTreeParts } from '../shared/parts.js';
import {
    DEMO_IMPORT_TARGET,
    demoImportQuery,
    loadDemoImportRows,
    parseDemoImport,
    saveDemoImportRows,
    type DemoImportFormat,
    type DemoImportRow,
} from './demo-import-data.js';
import { demoFlamegraph, demoReplication, demoWorkload } from '../shared/observability-fixtures.js';
import { WORKLOAD_WINDOWS, type WorkloadWindow } from '../shared/workload.js';
import {
    DEMO_PREVIEW_RUN_ID,
    DEMO_PREVIEW_SQL,
    DEMO_PREVIEW_STARTER_DOCUMENT_ID,
    DEMO_PREVIEW_STARTERS,
    DEMO_PREVIEW_STARTER_VERSIONS,
    PLAYGROUND_PREVIEW_STARTER,
    demoPreviewStarterRunId,
} from './demo-preview-data.js';
import {
    chartConfig,
    connection,
    expiresAt,
    makeRun,
    metricContract,
    now,
    owner,
    previewStorageBudget,
    previewStorageKey,
    record,
    resultFor,
    schema,
} from './demo-preview-fixtures.js';

export {
    DEMO_PREVIEW_INITIAL_STARTERS,
    DEMO_PREVIEW_RUN_ID,
    DEMO_PREVIEW_SQL,
    DEMO_PREVIEW_STARTER_DOCUMENT_ID,
    DEMO_PREVIEW_STARTERS,
    PLAYGROUND_PREVIEW_STARTER,
    demoPreviewStarterRunId,
} from './demo-preview-data.js';
export type { DemoPreviewStarter } from './demo-preview-data.js';

type RequestOptions = { method?: string; body?: unknown; signal?: AbortSignal };
const MAX_SCRIPT_STATEMENTS = 50;
const MAX_SCRIPT_SQL_LENGTH = 200_000;
const demoQueryTree = [
    'QUERY id: 0',
    '  PROJECTION COLUMNS',
    '    event_type LowCardinality(String)',
    '    events UInt64',
    '  PROJECTION',
    '    LIST id: 1, nodes: 2',
    '      COLUMN id: 2, column_name: event_type, result_type: LowCardinality(String), source_id: 5',
    '      FUNCTION id: 3, function_name: count, function_type: aggregate, result_type: UInt64',
    '  JOIN TREE',
    '    TABLE id: 5, table_name: demo.events',
] as const;

export class DemoPreviewApi {
    private trusted = true;
    private runs = new Map<string, Run>();
    private results = new Map<string, Result>();
    private scripts = new Map<string, Script>();
    private documents = new Map<string, QueryDocument>();
    private revisions = new Map<string, QueryDocument[]>();
    private demoImportInputs = new Map<string, { id: string; name: string; format: DemoImportFormat; columns: string[]; rows: DemoImportRow[]; expiresAt: string }>();
    private demoImportMappings = new Map<string, { id: string; inputId: string; connectionId: string; table: string; fields: Record<string, string>; rows: DemoImportRow[] }>();
    private demoImportJobs = new Map<string, { id: string; connectionId: string; table: string; rows: number; createdAt: string; status: 'succeeded'; demoRows: DemoImportRow[]; demoPersisted: boolean }>();
    private demoImportRows: DemoImportRow[] = [];
    private demoImportRowsReady: Promise<void>;
    private sequence = 0;

    constructor() {
        this.restore();
        this.interruptRestoredCloudScripts();
        if (!this.runs.has(DEMO_PREVIEW_RUN_ID)) this.addRun(DEMO_PREVIEW_RUN_ID, DEMO_PREVIEW_SQL, 'query', {});
        for (const starter of DEMO_PREVIEW_STARTERS) {
            if (this.documents.has(starter.id)) continue;
            const runId = demoPreviewStarterRunId(starter.id);
            const run = this.runs.get(runId) ?? this.addRun(runId, starter.sql, 'query', {});
            const timestamp = now();
            const document: QueryDocument = {
                id: starter.id, owner, name: starter.name, connectionId: 'demo', sql: starter.sql,
                revision: starter.revision ?? 1, createdAt: timestamp, updatedAt: timestamp, parameters: {}, chart: starter.chart,
                runId: run.id, dependencies: [], kind: 'query',
            };
            const sqlVersions = starter.id === DEMO_PREVIEW_STARTER_DOCUMENT_ID ? DEMO_PREVIEW_STARTER_VERSIONS : [starter.sql];
            const nowMs = Date.now(), firstSavedAt = nowMs - (sqlVersions.length - 1) * 86_400_000;
            const versions = sqlVersions.map((sql, index): QueryDocument => ({
                ...document,
                sql,
                revision: index + 1,
                createdAt: new Date(firstSavedAt).toISOString(),
                updatedAt: new Date(firstSavedAt + index * 86_400_000).toISOString(),
                runId: index === sqlVersions.length - 1 ? run.id : undefined,
            }));
            this.documents.set(starter.id, versions[versions.length - 1]!);
            this.revisions.set(starter.id, versions);
        }
        if (!this.documents.has(PLAYGROUND_PREVIEW_STARTER.id)) {
            const timestamp = now();
            this.documents.set(PLAYGROUND_PREVIEW_STARTER.id, {
                id: PLAYGROUND_PREVIEW_STARTER.id, owner, name: PLAYGROUND_PREVIEW_STARTER.name,
                connectionId: PLAYGROUND_CONNECTION_ID, sql: PLAYGROUND_PREVIEW_STARTER.sql,
                revision: 1, createdAt: timestamp, updatedAt: timestamp, parameters: {},
                chart: PLAYGROUND_PREVIEW_STARTER.chart, dependencies: [], kind: 'query',
            });
        }
        for (const document of this.documents.values())
            if (!this.revisions.has(document.id)) this.revisions.set(document.id, [document]);
        this.persist();
        this.demoImportRowsReady = loadDemoImportRows().then(rows => { this.demoImportRows = rows; }).catch(() => undefined);
    }

    private restore() {
        try {
            const saved: unknown = JSON.parse(localStorage.getItem(previewStorageKey) ?? 'null');
            if (record(saved).version !== 1) return;
            const state = record(saved);
            if (typeof state.trusted === 'boolean') this.trusted = state.trusted;
            if (typeof state.sequence === 'number' && Number.isSafeInteger(state.sequence) && state.sequence >= 0) this.sequence = state.sequence;
            if (Array.isArray(state.runs)) for (const value of state.runs) {
                if (isRun(value))
                    this.runs.set(value.id, value);
            }
            if (Array.isArray(state.results)) for (const value of state.results) {
                if (!isResult(value)) continue;
                const run = this.runs.get(value.runId);
                const expiredPlaygroundResult = run?.connectionId === PLAYGROUND_CONNECTION_ID &&
                    Date.parse(value.expiresAt) <= Date.now();
                if (!expiredPlaygroundResult)
                    this.results.set(value.runId, value);
            }
            if (Array.isArray(state.scripts)) for (const value of state.scripts) {
                const script = record(value);
                if (typeof script.id === 'string' && typeof script.sql === 'string') this.scripts.set(script.id, value as Script);
            }
            if (Array.isArray(state.documents)) for (const value of state.documents) {
                const document = record(value);
                if (typeof document.id === 'string' && typeof document.sql === 'string' && typeof document.name === 'string')
                    this.documents.set(document.id, value as QueryDocument);
            }
            if (Array.isArray(state.revisions)) for (const entry of state.revisions) {
                if (!Array.isArray(entry) || typeof entry[0] !== 'string' || !Array.isArray(entry[1])) continue;
                const versions = entry[1].filter((value): value is QueryDocument => {
                    const revision = record(value);
                    return typeof revision.id === 'string' && typeof revision.name === 'string' && typeof revision.sql === 'string' &&
                        typeof revision.revision === 'number' && Number.isSafeInteger(revision.revision) && revision.revision > 0;
                });
                if (versions.length) this.revisions.set(entry[0], versions);
            }
            for (const run of this.runs.values()) {
                if (run.connectionId === PLAYGROUND_CONNECTION_ID && run.resultState === 'reopenable' && !this.results.has(run.id))
                    this.runs.set(run.id, { ...run, resultState: 'expired' });
            }
            for (const run of this.runs.values()) this.sequence = Math.max(this.sequence, run.sequence);
        } catch {
            this.runs.clear();
            this.results.clear();
            this.scripts.clear();
            this.documents.clear();
            this.revisions.clear();
            this.sequence = 0;
        }
    }

    private interruptRestoredCloudScripts() {
        for (const script of this.scripts.values()) {
            if (script.connectionId !== CLICKHOUSE_CLOUD_CONNECTION_ID || script.status !== 'running') continue;
            const statements = script.statements.map(statement => statement.status === 'running'
                ? {
                    ...statement,
                    status: 'interrupted' as const,
                    error: {
                        code: 'SCRIPT_INTERRUPTED',
                        message: 'The page closed before ClickHouse returned a result. This statement may have completed, so it was not retried.',
                    },
                }
                : statement.status === 'pending' ? { ...statement, status: 'skipped' as const } : statement);
            this.scripts.set(script.id, { ...script, status: 'interrupted', statements });
        }
    }

    private persist() {
        try {
            const results = [...this.results.values()].slice(-100);
            const scripts = [...this.scripts.values()].slice(-50);
            const serialize = () => JSON.stringify({
                version: 1, trusted: this.trusted, sequence: this.sequence,
                runs: [...this.runs.values()].slice(-100).map(run =>
                    run.resultState === 'reopenable' && !results.some(result => result.runId === run.id)
                        ? { ...run, resultState: 'expired' as const }
                        : run),
                results, scripts, documents: [...this.documents.values()].slice(-100),
                revisions: [...this.revisions.entries()].slice(-100),
            });
            let serialized = serialize();
            while (serialized.length > previewStorageBudget) {
                const playgroundResult = results.findIndex(result => this.runs.get(result.runId)?.connectionId === PLAYGROUND_CONNECTION_ID);
                const oldestCloudOrPlayground = results.findIndex(result => this.runs.get(result.runId)?.connectionId !== 'demo');
                const resultToExpire = playgroundResult >= 0 ? playgroundResult : oldestCloudOrPlayground >= 0 ? oldestCloudOrPlayground : results.length ? 0 : -1;
                if (resultToExpire >= 0) {
                    results.splice(resultToExpire, 1);
                } else {
                    const oldestCompletedScript = scripts.findIndex(script => script.status !== 'running');
                    if (oldestCompletedScript < 0) break;
                    scripts.splice(oldestCompletedScript, 1);
                }
                serialized = serialize();
            }
            localStorage.setItem(previewStorageKey, serialized);
        } catch {}
    }

    private addRun(id: string, sql: string, kind: Run['kind'], parameters: Record<string, string>) {
        const run = makeRun(id, sql, kind, ++this.sequence, parameters);
        this.runs.set(id, run);
        const imported = kind === 'query' ? demoImportQuery(sql, this.demoImportRows) : undefined;
        if (imported) {
            run.columns = imported.columns;
            run.rowCount = imported.rows.length;
            run.bytes = JSON.stringify(imported.rows).length;
            run.warnings = ['BROWSER DEMO: these imported rows are stored in this browser. SQL was not sent to ClickHouse.'];
        }
        this.results.set(id, imported ? {
            runId: id, queryId: run.queryId, columns: imported.columns, rows: imported.rows,
            completeness: 'complete', createdAt: now(), expiresAt: expiresAt(),
        } : resultFor(run));
        this.persist();
        return run;
    }

    private async executeCloudScript(scriptId: string) {
        let script = this.scripts.get(scriptId);
        const cloud = getClickHouseCloudConnection();
        if (!script) return;
        if (!cloud) {
            const firstPending = script.statements.findIndex(statement => statement.status === 'pending');
            const statements = script.statements.map((statement, index) => index === firstPending
                ? { ...statement, status: 'failed' as const, error: { code: 'CLOUD_DISCONNECTED', message: 'Reconnect to ClickHouse Cloud before running this script.' } }
                : statement.status === 'pending' ? { ...statement, status: 'skipped' as const } : statement);
            this.scripts.set(script.id, { ...script, status: 'failed', statements });
            this.persist();
            return;
        }

        for (let index = 0; index < script.statements.length; index++) {
            script = this.scripts.get(scriptId);
            if (!script) return;
            const statement = script.statements[index]!;
            if (statement.status !== 'pending') continue;
            if (script.cancelled) {
                this.scripts.set(script.id, {
                    ...script,
                    status: 'cancelled',
                    statements: script.statements.map(item => item.status === 'pending' ? { ...item, status: 'skipped' } : item),
                });
                this.persist();
                return;
            }

            const startedAt = now();
            const runningStatements = [...script.statements];
            runningStatements[index] = { ...statement, status: 'running', error: undefined };
            script = { ...script, statements: runningStatements };
            this.scripts.set(script.id, script);
            this.persist();

            try {
                const response = await runClickHouseCloudSql(statement.sql, script.id);
                const finishedAt = now();
                const runId = crypto.randomUUID();
                const resultExpiresAt = expiresAt();
                const status = response.truncated ? 'truncated' as const : 'succeeded' as const;
                const run: Run = {
                    dataSource: 'clickhouse', id: runId, queryId: response.queryId, owner,
                    connectionId: CLICKHOUSE_CLOUD_CONNECTION_ID, sql: statement.sql, sourceFrom: statement.from, sourceTo: statement.to,
                    kind: 'query', parameters: {}, limits: { ...cloud.limits },
                    tags: { workspace: 'clickstudio', source: 'ClickHouse Cloud', execution: 'Vercel function' },
                    status, createdAt: startedAt, startedAt, finishedAt, elapsedMs: response.elapsedMs,
                    rowCount: response.rows.length, bytes: response.bytes, columns: response.columns,
                    warnings: response.truncated ? ['The result reached the 1,000-row display limit and may be incomplete.'] : [],
                    sequence: ++this.sequence, resultExpiresAt, resultState: 'reopenable',
                    requestedBy: owner, executedAs: cloud.username,
                    permissionSnapshot: { readonly: cloud.readonly, role: 'ClickHouse Cloud user' },
                    retryPolicy: 'never', serverVersion: cloud.manifest?.serverVersion,
                };
                const result: Result = {
                    runId, queryId: response.queryId, columns: response.columns, rows: response.rows,
                    completeness: response.truncated ? 'truncated' : 'complete', createdAt: finishedAt, expiresAt: resultExpiresAt,
                };
                this.runs.set(run.id, run);
                this.results.set(run.id, result);

                const current = this.scripts.get(scriptId);
                if (!current) return;
                const statements = [...current.statements];
                statements[index] = { ...statements[index]!, runId: run.id, status, error: undefined };
                this.scripts.set(scriptId, { ...current, statements });
                this.persist();
            } catch (caught) {
                const current = this.scripts.get(scriptId);
                if (!current) return;
                const error: ApiError = caught instanceof CloudRequestError
                    ? { code: caught.code, message: caught.message }
                    : { code: 'CLOUD_SCRIPT_STATEMENT', message: caught instanceof Error ? caught.message : 'ClickHouse could not run this statement.' };
                const statements = [...current.statements];
                statements[index] = { ...statements[index]!, status: 'failed', error };
                if (current.stopOnError)
                    for (let later = index + 1; later < statements.length; later++)
                        if (statements[later]!.status === 'pending') statements[later] = { ...statements[later]!, status: 'skipped' };
                const successes = statements.filter(item => item.status === 'succeeded' || item.status === 'truncated').length;
                const hasPending = statements.some(item => item.status === 'pending');
                this.scripts.set(scriptId, {
                    ...current,
                    status: current.cancelled ? 'cancelled' : hasPending ? 'running' : successes ? 'partial' : 'failed',
                    statements,
                });
                this.persist();
                if (current.stopOnError) return;
            }
        }

        script = this.scripts.get(scriptId);
        if (!script) return;
        const successes = script.statements.filter(item => item.status === 'succeeded' || item.status === 'truncated').length;
        const failed = script.statements.some(item => item.status === 'failed' || item.status === 'timed_out' || item.status === 'interrupted');
        const status = script.cancelled ? 'cancelled' : failed ? (successes ? 'partial' : 'failed') : 'succeeded';
        const statements = script.cancelled
            ? script.statements.map(item => item.status === 'pending' ? { ...item, status: 'skipped' as const } : item)
            : script.statements;
        this.scripts.set(scriptId, { ...script, status, statements });
        this.persist();
    }

    private demoSchema(): Schema {
        const importedBytes = JSON.stringify(this.demoImportRows).length;
        return {
            ...schema,
            fetchedAt: now(),
            tables: schema.tables.map(table => table.name === 'interview_imports' ? {
                ...table, rowEstimate: String(this.demoImportRows.length), sizeBytes: String(importedBytes),
                uncompressedBytes: String(importedBytes), parts: this.demoImportRows.length ? '1' : '0',
                activeParts: this.demoImportRows.length ? '1' : '0',
            } : table),
        };
    }

    private async importRequest(parts: string[], method: string, body: Record<string, unknown>, url: URL): Promise<unknown> {
        if (parts.length === 1 && method === 'GET') return [];
        if (parts[1] === 'preview' && method === 'POST') {
            if (body.format !== 'csv' && body.format !== 'json' && body.format !== 'ndjson') throw new Error('Use CSV, JSON, or NDJSON');
            const format: DemoImportFormat = body.format;
            if (typeof body.source !== 'string' || typeof body.name !== 'string') throw new Error('Choose a file to preview');
            const parsed = parseDemoImport(body.source, format);
            if (!parsed.rows.length) throw new Error('The input contains no data rows');
            const id = crypto.randomUUID();
            const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
            const input = { id, name: body.name.slice(0, 128), format, ...parsed, expiresAt };
            this.demoImportInputs.set(id, input);
            return { ...input, rows: input.rows.slice(0, 20), rowCount: input.rows.length };
        }
        const id = parts[1];
        if (!id) throw new Error('Import request is incomplete');
        if (parts.length === 2 && method === 'DELETE') {
            this.demoImportInputs.delete(id);
            for (const [mappingId, mapping] of this.demoImportMappings)
                if (mapping.inputId === id) this.demoImportMappings.delete(mappingId);
            return { ok: true };
        }
        if (parts[2] === 'mapping' && method === 'POST') {
            const input = this.demoImportInputs.get(id);
            if (!input || Date.parse(input.expiresAt) <= Date.now()) throw new Error('This preview expired; upload the file again');
            if (body.connectionId !== 'demo' || body.table !== DEMO_IMPORT_TARGET) throw new Error('Choose the browser demo table as the destination');
            const fields = record(body.fields) as Record<string, unknown>;
            const destinations = Object.values(fields);
            const allowed = ['day', 'region', 'channel', 'events', 'revenue'];
            if (!destinations.length || destinations.some(value => typeof value !== 'string' || !allowed.includes(value)) || new Set(destinations).size !== destinations.length)
                throw new Error('Each destination column must be mapped once');
            const mappedRows = input.rows.map(row => {
                const mapped = Object.create(null) as DemoImportRow;
                for (const [source, destination] of Object.entries(fields)) {
                    if (!input.columns.includes(source) || typeof destination !== 'string' || !allowed.includes(destination) || !Object.hasOwn(row, source))
                        throw new Error('Mapping references an unknown source or destination column');
                    mapped[destination] = row[source]!;
                }
                return mapped;
            });
            const mapping = { id: crypto.randomUUID(), inputId: id, connectionId: 'demo', table: DEMO_IMPORT_TARGET, fields: fields as Record<string, string>, rows: mappedRows };
            this.demoImportMappings.set(mapping.id, mapping);
            return { ...mapping, rows: mappedRows.slice(0, 20), rowCount: mappedRows.length };
        }
        if (parts[2] === 'commit' && method === 'POST') {
            const mapping = this.demoImportMappings.get(id);
            if (!mapping) throw new Error('Mapping not found; review the columns again');
            if (this.demoImportJobs.has(id)) return this.demoImportJobs.get(id);
            const rows = [...this.demoImportRows, ...mapping.rows];
            let demoPersisted = true;
            try { await saveDemoImportRows(rows); }
            catch { demoPersisted = false; }
            this.demoImportRows = rows;
            const job = {
                id, connectionId: 'demo', table: mapping.table, rows: mapping.rows.length,
                createdAt: now(), status: 'succeeded' as const, demoRows: mapping.rows.slice(0, 8), demoPersisted,
            };
            this.demoImportJobs.set(id, job);
            return job;
        }
        if (parts.length === 2 && method === 'GET') {
            const job = this.demoImportJobs.get(id);
            if (!job) throw new Error('Import job not found');
            return job;
        }
        if ((parts[2] === 'reconcile' || parts[2] === 'review') && method === 'POST') {
            const job = this.demoImportJobs.get(id);
            if (!job) throw new Error('Import job not found');
            return job;
        }
        const connectionId = url.searchParams.get('connectionId');
        if (parts.length === 1 && method === 'GET' && connectionId === 'demo') return [];
        throw new Error('Unknown browser demo import action');
    }

    private getRun(id: string) {
        let run = this.runs.get(id);
        if (!run) throw new Error('This retained run is no longer available in this browser. Run the SQL again.');
        const expiresAtMs = run.resultExpiresAt ? Date.parse(run.resultExpiresAt) : Number.NaN;
        if (run.connectionId === PLAYGROUND_CONNECTION_ID && run.resultState === 'reopenable' &&
            (!this.results.has(run.id) || Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now())) {
            this.results.delete(run.id);
            run = { ...run, resultState: 'expired' };
            this.runs.set(run.id, run);
            this.persist();
        }
        return run;
    }

    private documentsFor(trash: boolean, connectionId?: string | null) {
        return [...this.documents.values()].filter(document =>
            (trash || !document.deletedAt) && (!connectionId || document.connectionId === connectionId));
    }

    private saveDocument(input: Record<string, unknown>, id?: string) {
        const previous = id ? this.documents.get(id) : undefined;
        const timestamp = now();
        const parameters = Object.fromEntries(Object.entries(record(input.parameters)).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
        const document: QueryDocument = {
            id: previous?.id ?? id ?? crypto.randomUUID(), owner, name: typeof input.name === 'string' ? input.name : 'Untitled.sql',
            connectionId: input.connectionId === PLAYGROUND_CONNECTION_ID || input.connectionId === CLICKHOUSE_CLOUD_CONNECTION_ID ? input.connectionId : 'demo',
            sql: typeof input.sql === 'string' ? input.sql : DEMO_PREVIEW_SQL,
            revision: (previous?.revision ?? 0) + 1, createdAt: previous?.createdAt ?? timestamp, updatedAt: timestamp,
            parameters,
            chart: chartConfig(input.chart),
            runId: typeof input.runId === 'string' ? input.runId : undefined,
            parentDocumentId: typeof input.parentDocumentId === 'string' ? input.parentDocumentId : undefined,
            dependencies: Array.isArray(input.dependencies) ? input.dependencies.filter((value): value is string => typeof value === 'string') : [],
            kind: input.kind === 'metric' || input.kind === 'snippet' ? input.kind : 'query',
            metric: metricContract(input.metric),
            ...(previous?.deletedAt ? { deletedAt: previous.deletedAt } : {}),
        };
        this.documents.set(document.id, document);
        const versions = this.revisions.get(document.id) ?? (previous ? [previous] : []);
        this.revisions.set(document.id, [...versions, document]);
        this.persist();
        return document;
    }

    async request(path: string, options: RequestOptions = {}): Promise<unknown> {
        await this.demoImportRowsReady;
        if (options.signal?.aborted) throw options.signal.reason ?? new Error('The request was cancelled.');
        const url = new URL(path, 'https://preview.invalid');
        const pathname = url.pathname.replace(/\/+$/, '') || '/';
        const method = options.method ?? 'GET';
        const parts = pathname.split('/').filter(Boolean).map(part => decodeURIComponent(part));
        const body = record(options.body);

        if (pathname === '/session') return { principal: { id: owner, role: 'owner' }, requiresLogin: false, demo: true };
        if (pathname === '/connections' && method === 'GET') {
            const cloud = getClickHouseCloudConnection();
            return [connection(this.trusted), PLAYGROUND_CONNECTION, ...(cloud ? [cloud] : [])];
        }
        if (parts[0] === 'connections' && parts[1] === CLICKHOUSE_CLOUD_CONNECTION_ID && parts[2] === 'schema' && method === 'GET')
            return await loadClickHouseCloudSchema();
        if (parts[0] === 'connections' && parts[1] === 'demo' && parts[2] === 'schema') return this.demoSchema();
        if (parts[0] === 'connections' && parts[1] === 'demo' && parts[2] === 'native-explorer' && method === 'POST') {
            if (!this.trusted) throw new Error('Trust this connection before inspecting native metadata.');
            if (typeof body.database !== 'string') throw new Error('A database is required.');
            if (body.kind === 'lineage') return nativeExplorerFixture({ kind: 'lineage', database: body.database });
            if ((body.kind === 'merges' || body.kind === 'mutations') && typeof body.table === 'string')
                return nativeExplorerFixture({ kind: body.kind, database: body.database, table: body.table });
            throw new Error('Unknown native explorer request.');
        }
        if (parts[0] === 'connections' && parts[1] === 'demo' && parts[2] === 'workload') {
            if (!this.trusted) throw new Error('Trust this connection before inspecting workload history.');
            const rawMinutes = url.searchParams.get('minutes') ?? '60';
            if (!WORKLOAD_WINDOWS.some(minutes => String(minutes) === rawMinutes)) throw new Error('minutes must be 15, 60, 360, or 1440.');
            return demoWorkload('demo', Number(rawMinutes) as WorkloadWindow);
        }
        if (parts[0] === 'connections' && parts[1] === 'demo' && parts[2] === 'replication') {
            if (!this.trusted) throw new Error('Trust this connection before inspecting replication health.');
            return demoReplication('demo');
        }
        if (parts[0] === 'connections' && parts[1] === PLAYGROUND_CONNECTION_ID && (parts[2] === 'workload' || parts[2] === 'replication'))
            throw new Error('Observability system-table access is unavailable in the public Playground browser preview.');
        if (parts[0] === 'connections' && parts[1] === 'demo' && parts[2] === 'table-parts' && method === 'POST') {
            if (body.database !== 'demo' || body.table !== 'events') throw new Error('The selected table is not available in this sample.');
            return parseMergeTreeParts('demo', 'events', demoMergeTreePartRows());
        }
        if (parts[0] === 'connections' && parts[1] === PLAYGROUND_CONNECTION_ID && parts[2] === 'schema')
            return loadPlaygroundSchema(options.signal, url.searchParams.get('refresh') === 'true');
        if (parts[0] === 'connections' && parts[1] === 'demo' && parts[2] === 'trust' && method === 'POST') {
            this.trusted = body.trusted === true;
            this.persist();
            return { trusted: this.trusted };
        }
        if (parts[0] === 'connections' && parts[1] === 'demo' && parts[2] === 'import-targets') return [DEMO_IMPORT_TARGET];
        if (parts[0] === 'connections' && parts[1] === PLAYGROUND_CONNECTION_ID && parts[2] === 'import-targets') return [];
        if (parts[0] === 'imports') return this.importRequest(parts, method, body, url);
        if (parts[0] === 'connections' && parts[2] === 'query-tree' && method === 'POST') {
            const sql = typeof body.sql === 'string' ? body.sql : '';
            const parameters = record(body.parameters) as Record<string, string>;
            if (parts[1] === PLAYGROUND_CONNECTION_ID) {
                if (Object.keys(parameters).length) throw new Error('Remove query parameters before inspecting SQL on ClickHouse Playground.');
                const response = await queryPlaygroundQueryTree(sql, options.signal);
                return response.rows.map(row => String(row[0] ?? '')).filter(Boolean);
            }
            if (parts[1] === 'demo') return [...demoQueryTree];
        }

        if (pathname === '/runs' && method === 'POST') {
            const requestedKind = body.kind === 'explain' || body.kind === 'plan' || body.kind === 'pipeline' || body.kind === 'analyze' ? body.kind : 'query';
            const parameters = record(body.parameters) as Record<string, string>;
            if (body.connectionId === PLAYGROUND_CONNECTION_ID) {
                if (Object.keys(parameters).length) throw new Error('Remove query parameters before running SQL on ClickHouse Playground.');
                const sql = typeof body.sql === 'string' ? body.sql : '';
                const executionSql = sqlForRunKind(sql, requestedKind);
                const response = await queryPlayground(executionSql, options.signal);
                const finishedAt = now();
                const startedAt = new Date(Date.now() - response.elapsedMs).toISOString();
                const runId = crypto.randomUUID();
                const status = response.truncated ? 'truncated' as const : 'succeeded' as const;
                const warnings = response.truncated
                    ? ['The result reached the 1,000-row display limit and may be incomplete.']
                    : [];
                const resultExpiresAt = expiresAt();
                const run: Run = {
                    dataSource: 'clickhouse', id: runId, queryId: response.queryId, owner,
                    connectionId: PLAYGROUND_CONNECTION_ID, sql, kind: requestedKind, parameters: {},
                    limits: { ...PLAYGROUND_CONNECTION.limits },
                    tags: { workspace: 'clickstudio', source: 'ClickHouse SQL Playground', execution: 'browser direct' },
                    status, createdAt: startedAt, startedAt, finishedAt, elapsedMs: response.elapsedMs,
                    rowCount: response.rows.length, bytes: response.bytes, columns: response.columns, warnings,
                    sequence: ++this.sequence, resultExpiresAt, resultState: 'reopenable',
                    requestedBy: owner, executedAs: PLAYGROUND_CONNECTION.username,
                    permissionSnapshot: { readonly: true, role: 'public demo' }, retryPolicy: 'never',
                };
                const result: Result = {
                    runId, queryId: response.queryId, columns: response.columns, rows: response.rows,
                    completeness: response.truncated ? 'truncated' : 'complete', createdAt: finishedAt, expiresAt: resultExpiresAt,
                };
                this.runs.set(run.id, run);
                this.results.set(run.id, result);
                this.persist();
                return run;
            }
            if (body.connectionId === CLICKHOUSE_CLOUD_CONNECTION_ID) {
                const cloud = getClickHouseCloudConnection();
                if (!cloud) throw new CloudRequestError('CLOUD_DISCONNECTED', 'Reconnect to ClickHouse Cloud before running SQL.', 401);
                const sql = typeof body.sql === 'string' ? body.sql : '';
                const executionSql = sqlForRunKind(sql, requestedKind);
                const startedAt = now();
                const runId = crypto.randomUUID();
                const resultExpiresAt = expiresAt();
                const response = await runClickHouseCloudSql(executionSql);
                const finishedAt = now();
                const status = response.truncated ? 'truncated' as const : 'succeeded' as const;
                const run: Run = {
                    dataSource: 'clickhouse', id: runId, queryId: response.queryId, owner,
                    connectionId: CLICKHOUSE_CLOUD_CONNECTION_ID, sql, kind: requestedKind, parameters: {},
                    limits: { ...cloud.limits },
                    tags: { workspace: 'clickstudio', source: 'ClickHouse Cloud', execution: 'Vercel function' },
                    status, createdAt: startedAt, startedAt, finishedAt, elapsedMs: response.elapsedMs,
                    rowCount: response.rows.length, bytes: response.bytes, columns: response.columns,
                    warnings: response.truncated ? ['The result reached the 1,000-row display limit and may be incomplete.'] : [],
                    sequence: ++this.sequence, resultExpiresAt, resultState: 'reopenable',
                    requestedBy: owner, executedAs: cloud.username,
                    permissionSnapshot: { readonly: cloud.readonly, role: 'ClickHouse Cloud user' },
                    retryPolicy: 'never', serverVersion: cloud.manifest?.serverVersion,
                };
                const result: Result = {
                    runId, queryId: response.queryId, columns: response.columns, rows: response.rows,
                    completeness: response.truncated ? 'truncated' : 'complete', createdAt: finishedAt, expiresAt: resultExpiresAt,
                };
                this.runs.set(run.id, run);
                this.results.set(run.id, result);
                this.persist();
                return run;
            }
            const run = this.addRun(crypto.randomUUID(), typeof body.sql === 'string' ? body.sql : DEMO_PREVIEW_SQL, requestedKind, parameters);
            return run;
        }
        if (pathname === '/runs' && method === 'GET') {
            const connectionId = url.searchParams.get('connectionId');
            return [...this.runs.values()].filter(run => !connectionId || run.connectionId === connectionId).sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.sequence - left.sequence);
        }
        if (parts[0] === 'runs' && parts[1]) {
            const run = this.getRun(parts[1]);
            if (parts[2] === 'result' || parts[2] === 'snapshot') {
                const result = this.results.get(run.id);
                if (!result && run.connectionId === PLAYGROUND_CONNECTION_ID)
                    throw new Error('This retained Playground result is no longer available in this browser. Run the SQL again.');
                const retained = result ?? resultFor(run);
                if (parts[2] === 'snapshot') return retained;
                const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0) || 0);
                const count = Math.max(1, Math.min(500, Number(url.searchParams.get('count') ?? 200) || 200));
                return { ...retained, rows: retained.rows.slice(offset, offset + count), offset, totalRows: retained.rows.length, nextOffset: offset + count < retained.rows.length ? offset + count : null } satisfies ResultPage;
            }
            if (parts[2] === 'cancel' && method === 'POST') {
                const cancelled = { ...run, status: 'cancelled' as const, resultState: 'unavailable' as const, finishedAt: now() };
                this.runs.set(run.id, cancelled);
                this.results.delete(run.id);
                this.persist();
                return cancelled;
            }
            if (parts[2] === 'profile') {
                if (run.connectionId === PLAYGROUND_CONNECTION_ID)
                    throw new Error('Query-log and pipeline profiling are unavailable on ClickHouse Playground.');
                if (parts[3] === 'flamegraph') {
                    if (!this.trusted) throw new Error('Trust this connection before inspecting profiler samples.');
                    if (run.status === 'running' || run.status === 'queued') throw new Error('Wait for the query to finish before loading its flamegraph.');
                    return demoFlamegraph(run.queryId);
                }
                const pipeline = {
                    available: true, source: 'query_shape' as const, truncated: false,
                    nodes: [
                        { id: 'read', label: 'Sample rows', kind: 'read' as const, status: 'estimated' as const, rows: String(run.rowCount) },
                        { id: 'output', label: 'Output', kind: 'output' as const, status: 'estimated' as const, rows: String(run.rowCount) },
                    ],
                    edges: [{ source: 'read', target: 'output' }],
                };
                if (parts[3] === 'pipeline') return pipeline;
                return {
                    version: 1, queryId: run.queryId, runId: run.id,
                    summary: { durationMs: run.elapsedMs, resultRows: run.rowCount, readRows: String(run.rowCount), readBytes: String(run.bytes) },
                    insights: [], pipeline,
                    capabilities: { queryLog: false, pipelineGraph: true, indexAnalysis: false, runtimePlan: false },
                    evidence: [], notice: 'Generated preview data only. This is not a ClickHouse profile.',
                };
            }
            return run;
        }

        if (pathname === '/scripts' && method === 'POST') {
            if (body.connectionId === PLAYGROUND_CONNECTION_ID)
                throw new Error('Run one statement at a time on ClickHouse Playground.');
            const sql = typeof body.sql === 'string' ? body.sql : body.connectionId === CLICKHOUSE_CLOUD_CONNECTION_ID ? '' : DEMO_PREVIEW_SQL;
            const id = crypto.randomUUID();
            const statements = splitSql(sql);
            if (body.connectionId === CLICKHOUSE_CLOUD_CONNECTION_ID) {
                if (!getClickHouseCloudConnection())
                    throw new CloudRequestError('CLOUD_DISCONNECTED', 'Reconnect to ClickHouse Cloud before running a script.', 401);
                if (!sql.trim() || sql.length > MAX_SCRIPT_SQL_LENGTH)
                    throw new Error(`Enter a script under ${MAX_SCRIPT_SQL_LENGTH.toLocaleString()} characters.`);
                if (statements.length === 0 || statements.length > MAX_SCRIPT_STATEMENTS)
                    throw new Error(`A script must contain 1–${MAX_SCRIPT_STATEMENTS} SQL statements.`);
                if (Object.keys(record(body.parameters)).length)
                    throw new Error('Remove query parameters before running a script on ClickHouse Cloud.');
                const script: Script = {
                    id, owner, connectionId: CLICKHOUSE_CLOUD_CONNECTION_ID, sql, createdAt: now(),
                    status: 'running', stopOnError: body.stopOnError !== false, cancelled: false,
                    statements: statements.map(statement => ({ ...statement, status: 'pending' })),
                };
                this.scripts.set(id, script);
                this.persist();
                void this.executeCloudScript(id);
                return script;
            }
            const items = statements.map(statement => {
                const run = this.addRun(crypto.randomUUID(), statement.sql, 'query', record(body.parameters) as Record<string, string>);
                return { ...statement, runId: run.id, status: 'succeeded' as const };
            });
            const script: Script = { id, owner, connectionId: 'demo', sql, createdAt: now(), status: 'succeeded', stopOnError: body.stopOnError !== false, cancelled: false, statements: items };
            this.scripts.set(id, script);
            this.persist();
            return script;
        }
        if (parts[0] === 'scripts' && parts[1]) {
            const script = this.scripts.get(parts[1]);
            if (parts[2] === 'cancel' && method === 'POST') {
                if (!script) throw new Error('This script is no longer available in this browser.');
                if (script.connectionId !== CLICKHOUSE_CLOUD_CONNECTION_ID || script.status !== 'running' || script.cancelled)
                    return script;
                const stopping = { ...script, cancelled: true };
                this.scripts.set(script.id, stopping);
                this.persist();
                return stopping;
            }
            return script ?? { id: parts[1], owner, connectionId: 'demo', sql: DEMO_PREVIEW_SQL, createdAt: now(), status: 'succeeded', stopOnError: true, cancelled: false, statements: [] } satisfies Script;
        }

        if (pathname === '/documents' && method === 'GET') return this.documentsFor(url.searchParams.get('trash') === 'true', url.searchParams.get('connectionId'));
        if (pathname === '/documents' && method === 'POST') return this.saveDocument(body);
        if (parts[0] === 'documents' && parts[1]) {
            const id = parts[1];
            if (parts.length === 2 && method === 'PUT') return this.saveDocument(body, id);
            if (parts[2] === 'revisions' && method === 'GET') {
                const current = this.documents.get(id);
                if (!current) throw new Error('Sample document not found.');
                return [...(this.revisions.get(id) ?? [current])].sort((left, right) => right.revision - left.revision);
            }
            if (parts[2] === 'restore-revision' && method === 'POST') {
                const current = this.documents.get(id);
                if (!current) throw new Error('Sample document not found.');
                const revisionNumber = typeof body.revision === 'number' ? body.revision : Number(body.revision);
                const baseRevision = typeof body.baseRevision === 'number' ? body.baseRevision : Number(body.baseRevision);
                if (!Number.isSafeInteger(revisionNumber) || revisionNumber < 1 || !Number.isSafeInteger(baseRevision) || baseRevision < 1)
                    throw new Error('Choose a valid saved version to restore.');
                if (current.revision !== baseRevision) throw new Error('A newer version exists. Refresh version history and try again.');
                const historical = this.revisions.get(id)?.find(version => version.revision === revisionNumber);
                if (!historical) throw new Error('This saved version is no longer available. Refresh version history and try again.');
                const restored: QueryDocument = { ...historical, revision: current.revision + 1, updatedAt: now(), runId: undefined };
                this.documents.set(id, restored);
                this.revisions.set(id, [...(this.revisions.get(id) ?? [current]), restored]);
                this.persist();
                return restored;
            }
            if (parts.length === 2 && method === 'DELETE') {
                const document = this.documents.get(id);
                if (document) {
                    this.documents.set(id, { ...document, deletedAt: now() });
                    this.persist();
                }
                return { ok: true };
            }
            if (parts[2] === 'restore' && method === 'POST') {
                const document = this.documents.get(id);
                if (document) {
                    const { deletedAt: _deletedAt, ...restored } = document;
                    this.documents.set(id, restored);
                    this.persist();
                    return restored;
                }
            }
            if (parts.length === 2) return this.documents.get(id) ?? { error: { code: 'NOT_FOUND', message: 'Sample document not found.' } };
        }

        if (pathname === '/assistant/status') return { available: false, reason: 'Assistant features are unavailable in the static sample preview.' };
        if (pathname === '/assistant/context' && method === 'POST')
            throw new Error('AI context preview is unavailable in this static sample. Open a connected workspace to use the assistant.');
        if (pathname === '/assistant/proposals' && method === 'POST')
            throw new Error('AI proposals are unavailable in this static sample. Open a connected workspace to use the assistant.');
        if (pathname === '/voice/status') return { available: false, reason: 'Voice features are unavailable in the static sample preview.' };
        if (pathname === '/imports' || pathname === '/monitors' || pathname === '/notices' || pathname === '/audit' || pathname === '/published') return [];
        if (pathname === '/health') return { ok: true, demo: true, version: '0.1.0' };
        return {};
    }
}
