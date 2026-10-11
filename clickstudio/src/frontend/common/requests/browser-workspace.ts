import {
    MAX_SCRIPT_STATEMENTS,
    MAX_SQL_CHARS,
    DEFAULT_RESULT_PAGE_ROWS,
} from '../../../shared/queries/execution/limits.js';
import { IMPORT_FORMATS, IMPORT_PREVIEW_ROWS } from '../../../shared/database/imports/limits.js';
import { nativeExplorerFixture } from '../../../shared/samples/explorers.js';
import type { ApiError } from '../../../shared/common/errors.js';
import type { ClickHouseDocumentationEntry } from '../../../shared/database/reference/types.js';
import type { ProfilePipeline, QueryProfile } from '../../../shared/queries/inspection/types.js';
import type { QueryDocument } from '../../../shared/queries/saved-queries/types.js';
import type { Result, ResultPage } from '../../../shared/queries/results/types.js';
import type { Run, Script } from '../../../shared/queries/execution/types.js';
import type { Schema } from '../../../shared/database/schema/types.js';
import { splitSql } from '../../../shared/sql/sql.js';
import {
    explainPrefixLength,
    sqlForRunKind,
} from '../../../shared/queries/inspection/explain-plan.js';
import {
    buildQueryProfile,
    parsePipelineResult,
} from '../../../shared/queries/inspection/profile.js';
import { isResult, isRun } from '../../workspace/queries/execution/events.js';
import {
    loadPlaygroundSchema,
    PLAYGROUND_CONNECTION,
    PLAYGROUND_CONNECTION_ID,
    queryPlayground,
    queryPlaygroundQueryTree,
} from './sources/playground.js';
import {
    cancelClickHouseCloudQuery,
    CLICKHOUSE_CLOUD_CONNECTION_ID,
    getClickHouseCloudConnection,
    loadClickHouseCloudDocumentationEntry,
    loadClickHouseCloudFlamegraph,
    loadClickHouseCloudPipeline,
    loadClickHouseCloudProfileEvidence,
    loadClickHouseCloudProgress,
    loadClickHouseCloudQueryTree,
    loadClickHouseCloudSchema,
    runClickHouseCloudSql,
    searchClickHouseCloudDocumentation,
    CloudRequestError,
} from './sources/cloud-connection.js';
import { demoMergeTreePartRows } from '../../../shared/samples/database.js';
import { parseMergeTreeParts } from '../../../shared/database/explorer/storage/parts.js';
import {
    DEMO_IMPORT_TARGET,
    demoImportQuery,
    loadDemoImportRows,
    parseDemoImport,
    saveDemoImportRows,
    type DemoImportFormat,
    type DemoImportRow,
} from './samples/demo-import-data.js';
import { demoFlamegraph, demoReplication, demoWorkload } from '../../../shared/samples/activity.js';
import {
    WORKLOAD_WINDOWS,
    type WorkloadWindow,
} from '../../../shared/database/explorer/activity/workload.js';
import {
    DEMO_PREVIEW_RUN_ID,
    DEMO_PREVIEW_SQL,
    DEMO_PREVIEW_STARTER_DOCUMENT_ID,
    DEMO_PREVIEW_STARTERS,
    DEMO_PREVIEW_STARTER_VERSIONS,
    PLAYGROUND_PREVIEW_STARTER,
    demoPreviewStarterRunId,
} from './samples/demo-preview-data.js';
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
} from './samples/demo-preview-fixtures.js';

export {
    DEMO_PREVIEW_INITIAL_STARTERS,
    DEMO_PREVIEW_RUN_ID,
    DEMO_PREVIEW_SQL,
    DEMO_PREVIEW_STARTER_DOCUMENT_ID,
    DEMO_PREVIEW_STARTERS,
    PLAYGROUND_PREVIEW_STARTER,
    demoPreviewStarterRunId,
} from './samples/demo-preview-data.js';
export type { DemoPreviewStarter } from './samples/demo-preview-data.js';

export class RetainedRunUnavailableError extends Error {
    constructor() {
        super('This retained run is no longer available in this browser. Run the SQL again.');
        this.name = 'RetainedRunUnavailableError';
    }
}

type RequestOptions = { method?: string; body?: unknown; signal?: AbortSignal };
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

export class BrowserWorkspaceApi {
    private trusted = true;
    private runs = new Map<string, Run>();
    private results = new Map<string, Result>();
    private scripts = new Map<string, Script>();
    private documents = new Map<string, QueryDocument>();
    private revisions = new Map<string, QueryDocument[]>();
    private demoImportInputs = new Map<
        string,
        {
            id: string;
            name: string;
            format: DemoImportFormat;
            columns: string[];
            rows: DemoImportRow[];
            expiresAt: string;
        }
    >();
    private demoImportMappings = new Map<
        string,
        {
            id: string;
            inputId: string;
            connectionId: string;
            table: string;
            fields: Record<string, string>;
            rows: DemoImportRow[];
        }
    >();
    private demoImportJobs = new Map<
        string,
        {
            id: string;
            connectionId: string;
            table: string;
            rows: number;
            createdAt: string;
            status: 'succeeded';
            demoRows: DemoImportRow[];
            demoPersisted: boolean;
        }
    >();
    private demoImportRows: DemoImportRow[] = [];
    private demoImportRowsReady: Promise<void>;
    private cloudProgressInFlight = new Set<string>();
    private sequence = 0;

    constructor() {
        this.restore();
        this.interruptRestoredCloudRuns();
        this.interruptRestoredCloudScripts();
        if (!this.runs.has(DEMO_PREVIEW_RUN_ID))
            this.addRun(DEMO_PREVIEW_RUN_ID, DEMO_PREVIEW_SQL, 'query', {});
        for (const starter of DEMO_PREVIEW_STARTERS) {
            if (this.documents.has(starter.id)) continue;
            const runId = demoPreviewStarterRunId(starter.id);
            const run = this.runs.get(runId) ?? this.addRun(runId, starter.sql, 'query', {});
            const timestamp = now();
            const document: QueryDocument = {
                id: starter.id,
                owner,
                name: starter.name,
                connectionId: 'demo',
                sql: starter.sql,
                revision: starter.revision ?? 1,
                createdAt: timestamp,
                updatedAt: timestamp,
                parameters: {},
                chart: starter.chart,
                runId: run.id,
                dependencies: [],
                kind: 'query',
            };
            const sqlVersions =
                starter.id === DEMO_PREVIEW_STARTER_DOCUMENT_ID
                    ? DEMO_PREVIEW_STARTER_VERSIONS
                    : [starter.sql];
            const nowMs = Date.now(),
                firstSavedAt = nowMs - (sqlVersions.length - 1) * 86_400_000;
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
                id: PLAYGROUND_PREVIEW_STARTER.id,
                owner,
                name: PLAYGROUND_PREVIEW_STARTER.name,
                connectionId: PLAYGROUND_CONNECTION_ID,
                sql: PLAYGROUND_PREVIEW_STARTER.sql,
                revision: 1,
                createdAt: timestamp,
                updatedAt: timestamp,
                parameters: {},
                chart: PLAYGROUND_PREVIEW_STARTER.chart,
                dependencies: [],
                kind: 'query',
            });
        }
        for (const document of this.documents.values())
            if (!this.revisions.has(document.id)) this.revisions.set(document.id, [document]);
        this.persist();
        this.demoImportRowsReady = loadDemoImportRows()
            .then(rows => {
                this.demoImportRows = rows;
            })
            .catch(() => undefined);
    }

    private restore() {
        try {
            const saved: unknown = JSON.parse(localStorage.getItem(previewStorageKey) ?? 'null');
            if (record(saved).version !== 1) return;
            const state = record(saved);
            if (typeof state.trusted === 'boolean') this.trusted = state.trusted;
            if (
                typeof state.sequence === 'number' &&
                Number.isSafeInteger(state.sequence) &&
                state.sequence >= 0
            )
                this.sequence = state.sequence;
            this.restoreExecutionState(state);
            this.restoreDocumentState(state);
            for (const run of this.runs.values()) {
                if (
                    run.connectionId === PLAYGROUND_CONNECTION_ID &&
                    run.resultState === 'reopenable' &&
                    !this.results.has(run.id)
                )
                    this.runs.set(run.id, { ...run, resultState: 'expired' });
            }
            for (const run of this.runs.values())
                this.sequence = Math.max(this.sequence, run.sequence);
        } catch {
            this.runs.clear();
            this.results.clear();
            this.scripts.clear();
            this.documents.clear();
            this.revisions.clear();
            this.sequence = 0;
        }
    }

    private restoreExecutionState(state: ReturnType<typeof record>) {
        if (Array.isArray(state.runs))
            for (const value of state.runs) {
                if (isRun(value)) this.runs.set(value.id, value);
            }
        if (Array.isArray(state.results))
            for (const value of state.results) {
                if (!isResult(value)) continue;
                const run = this.runs.get(value.runId);
                const expiredPlaygroundResult =
                    run?.connectionId === PLAYGROUND_CONNECTION_ID &&
                    Date.parse(value.expiresAt) <= Date.now();
                if (!expiredPlaygroundResult) this.results.set(value.runId, value);
            }
        if (Array.isArray(state.scripts))
            for (const value of state.scripts) {
                const script = record(value);
                if (typeof script.id === 'string' && typeof script.sql === 'string')
                    this.scripts.set(script.id, value as Script);
            }
    }

    private restoreDocumentState(state: ReturnType<typeof record>) {
        if (Array.isArray(state.documents))
            for (const value of state.documents) {
                const document = record(value);
                if (
                    typeof document.id === 'string' &&
                    typeof document.sql === 'string' &&
                    typeof document.name === 'string'
                )
                    this.documents.set(document.id, value as QueryDocument);
            }
        if (Array.isArray(state.revisions))
            for (const entry of state.revisions) {
                if (
                    !Array.isArray(entry) ||
                    typeof entry[0] !== 'string' ||
                    !Array.isArray(entry[1])
                )
                    continue;
                const versions = entry[1].filter((value): value is QueryDocument => {
                    const revision = record(value);
                    return (
                        typeof revision.id === 'string' &&
                        typeof revision.name === 'string' &&
                        typeof revision.sql === 'string' &&
                        typeof revision.revision === 'number' &&
                        Number.isSafeInteger(revision.revision) &&
                        revision.revision > 0
                    );
                });
                if (versions.length) this.revisions.set(entry[0], versions);
            }
    }

    private interruptRestoredCloudScripts() {
        for (const script of this.scripts.values()) {
            if (
                script.connectionId !== CLICKHOUSE_CLOUD_CONNECTION_ID ||
                script.status !== 'running'
            )
                continue;
            const statements = script.statements.map(statement => {
                switch (statement.status) {
                    case 'running':
                        return {
                            ...statement,
                            status: 'interrupted' as const,
                            error: {
                                code: 'SCRIPT_INTERRUPTED',
                                message:
                                    'The page closed before ClickHouse returned a result. This statement may have completed, so it was not retried.',
                            },
                        };

                    case 'pending':
                        return { ...statement, status: 'skipped' as const };

                    default:
                        return statement;
                }
            });
            this.scripts.set(script.id, { ...script, status: 'interrupted', statements });
        }
    }

    private interruptRestoredCloudRuns() {
        for (const run of this.runs.values()) {
            if (
                run.connectionId !== CLICKHOUSE_CLOUD_CONNECTION_ID ||
                !['running', 'queued'].includes(run.status)
            )
                continue;
            this.runs.set(run.id, {
                ...run,
                status: 'interrupted',
                finishedAt: now(),
                resultState: 'unavailable',
                error: {
                    code: 'RUN_INTERRUPTED',
                    message:
                        'The page closed before ClickHouse returned the result. The query may have finished on the server, but its result was not saved or retried.',
                },
                sequence: ++this.sequence,
            });
            this.results.delete(run.id);
        }
    }

    private persist() {
        try {
            const results = [...this.results.values()].slice(-100);
            const scripts = [...this.scripts.values()].slice(-50);
            const serialize = () =>
                JSON.stringify({
                    version: 1,
                    trusted: this.trusted,
                    sequence: this.sequence,
                    runs: [...this.runs.values()]
                        .slice(-100)
                        .map(run =>
                            run.resultState === 'reopenable' &&
                            !results.some(result => result.runId === run.id)
                                ? { ...run, resultState: 'expired' as const }
                                : run,
                        ),
                    results,
                    scripts,
                    documents: [...this.documents.values()].slice(-100),
                    revisions: [...this.revisions.entries()].slice(-100),
                });
            let serialized = serialize();
            while (serialized.length > previewStorageBudget) {
                const playgroundResult = results.findIndex(
                    result =>
                        this.runs.get(result.runId)?.connectionId === PLAYGROUND_CONNECTION_ID,
                );
                const oldestCloudOrPlayground = results.findIndex(
                    result => this.runs.get(result.runId)?.connectionId !== 'demo',
                );
                let resultToExpire: number;

                if (playgroundResult >= 0) {
                    resultToExpire = playgroundResult;
                } else if (oldestCloudOrPlayground >= 0) {
                    resultToExpire = oldestCloudOrPlayground;
                } else if (results.length) {
                    resultToExpire = 0;
                } else {
                    resultToExpire = -1;
                }
                if (resultToExpire >= 0) {
                    results.splice(resultToExpire, 1);
                } else {
                    const oldestCompletedScript = scripts.findIndex(
                        script => script.status !== 'running',
                    );
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
            run.warnings = [
                'BROWSER DEMO: these imported rows are stored in this browser. SQL was not sent to ClickHouse.',
            ];
        }
        this.results.set(
            id,
            imported
                ? {
                      runId: id,
                      queryId: run.queryId,
                      columns: imported.columns,
                      rows: imported.rows,
                      completeness: 'complete',
                      createdAt: now(),
                      expiresAt: expiresAt(),
                  }
                : resultFor(run),
        );
        this.persist();
        return run;
    }

    private startCloudRun(
        sql: string,
        kind: Run['kind'],
        parameters: Record<string, string>,
        cloud: NonNullable<ReturnType<typeof getClickHouseCloudConnection>>,
    ) {
        const id = crypto.randomUUID();
        const queryId = `clickstudio-run-${id}`;
        const startedAt = now();
        const run: Run = {
            dataSource: 'clickhouse',
            id,
            queryId,
            owner,
            connectionId: CLICKHOUSE_CLOUD_CONNECTION_ID,
            sql,
            kind,
            parameters,
            limits: { ...cloud.limits },
            tags: {
                workspace: 'clickstudio',
                source: 'ClickHouse Cloud',
                execution: 'browser direct',
            },
            status: 'running',
            createdAt: startedAt,
            startedAt,
            elapsedMs: 0,
            rowCount: 0,
            bytes: 0,
            columns: [],
            warnings: [],
            sequence: ++this.sequence,
            resultState: 'pending',
            requestedBy: owner,
            executedAs: cloud.username,
            permissionSnapshot: { readonly: cloud.readonly, role: 'ClickHouse Cloud user' },
            retryPolicy: 'never',
            serverVersion: cloud.manifest?.serverVersion,
        };
        this.runs.set(id, run);
        this.persist();
        void runClickHouseCloudSql(sql, undefined, { queryId, parameters })
            .then(response => {
                const current = this.runs.get(id);
                if (!current || current.status === 'cancelled') return;
                const finishedAt = now();
                const resultExpiresAt = expiresAt();
                const status = response.truncated ? ('truncated' as const) : ('succeeded' as const);
                const completed: Run = {
                    ...current,
                    status,
                    finishedAt,
                    elapsedMs: response.elapsedMs,
                    rowCount: response.rows.length,
                    bytes: response.bytes,
                    columns: response.columns,
                    ...(response.writtenRows === undefined
                        ? {}
                        : { writtenRows: response.writtenRows }),
                    warnings: response.truncated
                        ? ['The result reached the 1,000-row display limit and may be incomplete.']
                        : [],
                    resultExpiresAt,
                    resultState: 'reopenable',
                    sequence: ++this.sequence,
                };
                const result: Result = {
                    runId: id,
                    queryId: response.queryId,
                    columns: response.columns,
                    rows: response.rows,
                    completeness: response.truncated ? 'truncated' : 'complete',
                    createdAt: finishedAt,
                    expiresAt: resultExpiresAt,
                };
                this.runs.set(id, completed);
                this.results.set(id, result);
                this.persist();
            })
            .catch(caught => {
                const current = this.runs.get(id);
                if (!current || current.status === 'cancelled') return;
                const text =
                    caught instanceof Error
                        ? caught.message
                        : 'ClickHouse could not run this query.';
                const timedOut = /timeout|timed out|maximum execution time/i.test(text);
                this.runs.set(id, {
                    ...current,
                    status: timedOut ? 'timed_out' : 'failed',
                    finishedAt: now(),
                    elapsedMs: Math.max(current.elapsedMs, Date.now() - Date.parse(startedAt)),
                    error: {
                        code:
                            caught instanceof CloudRequestError ? caught.code : 'CLICKHOUSE_ERROR',
                        message: text.slice(0, 2_000),
                    },
                    resultState: 'unavailable',
                    sequence: ++this.sequence,
                });
                this.persist();
            });
        return run;
    }

    private async refreshCloudRunProgress(run: Run) {
        if (
            run.connectionId !== CLICKHOUSE_CLOUD_CONNECTION_ID ||
            run.status !== 'running' ||
            this.cloudProgressInFlight.has(run.id)
        )
            return run;
        this.cloudProgressInFlight.add(run.id);
        try {
            const cloud = getClickHouseCloudConnection();
            const progress = cloud?.manifest?.progress.available
                ? await loadClickHouseCloudProgress(run.queryId)
                : undefined;
            const current = this.runs.get(run.id);
            if (!current || current.status !== 'running') return current ?? run;
            const started = current.startedAt ? Date.parse(current.startedAt) : Date.now();
            const next: Run = {
                ...current,
                elapsedMs: Math.max(
                    current.elapsedMs,
                    Number.isFinite(started) ? Date.now() - started : 0,
                ),
                ...(progress ? { progress } : {}),
                sequence: ++this.sequence,
            };
            this.runs.set(run.id, next);
            this.persist();
            return next;
        } catch {
            return this.runs.get(run.id) ?? run;
        } finally {
            this.cloudProgressInFlight.delete(run.id);
        }
    }

    private async executeCloudScript(scriptId: string) {
        let script = this.scripts.get(scriptId);
        const cloud = getClickHouseCloudConnection();
        if (!script) return;
        if (!cloud) {
            const firstPending = script.statements.findIndex(
                statement => statement.status === 'pending',
            );
            const statements = script.statements.map((statement, index) => {
                if (index === firstPending) {
                    return {
                        ...statement,
                        status: 'failed' as const,
                        error: {
                            code: 'CLOUD_DISCONNECTED',
                            message: 'Reconnect to ClickHouse Cloud before running this script.',
                        },
                    };
                }

                if (statement.status === 'pending') {
                    return { ...statement, status: 'skipped' as const };
                }

                return statement;
            });
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
                    statements: script.statements.map(item =>
                        item.status === 'pending' ? { ...item, status: 'skipped' } : item,
                    ),
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
                const status = response.truncated ? ('truncated' as const) : ('succeeded' as const);
                const run: Run = {
                    dataSource: 'clickhouse',
                    id: runId,
                    queryId: response.queryId,
                    owner,
                    connectionId: CLICKHOUSE_CLOUD_CONNECTION_ID,
                    sql: statement.sql,
                    sourceFrom: statement.from,
                    sourceTo: statement.to,
                    kind: 'query',
                    parameters: {},
                    limits: { ...cloud.limits },
                    tags: {
                        workspace: 'clickstudio',
                        source: 'ClickHouse Cloud',
                        execution: 'Vercel function',
                    },
                    status,
                    createdAt: startedAt,
                    startedAt,
                    finishedAt,
                    elapsedMs: response.elapsedMs,
                    rowCount: response.rows.length,
                    ...(response.writtenRows === undefined
                        ? {}
                        : { writtenRows: response.writtenRows }),
                    bytes: response.bytes,
                    columns: response.columns,
                    warnings: response.truncated
                        ? ['The result reached the 1,000-row display limit and may be incomplete.']
                        : [],
                    sequence: ++this.sequence,
                    resultExpiresAt,
                    resultState: 'reopenable',
                    requestedBy: owner,
                    executedAs: cloud.username,
                    permissionSnapshot: { readonly: cloud.readonly, role: 'ClickHouse Cloud user' },
                    retryPolicy: 'never',
                    serverVersion: cloud.manifest?.serverVersion,
                };
                const result: Result = {
                    runId,
                    queryId: response.queryId,
                    columns: response.columns,
                    rows: response.rows,
                    completeness: response.truncated ? 'truncated' : 'complete',
                    createdAt: finishedAt,
                    expiresAt: resultExpiresAt,
                };
                this.runs.set(run.id, run);
                this.results.set(run.id, result);

                const current = this.scripts.get(scriptId);
                if (!current) return;
                const statements = [...current.statements];
                statements[index] = {
                    ...statements[index]!,
                    runId: run.id,
                    status,
                    error: undefined,
                };
                this.scripts.set(scriptId, { ...current, statements });
                this.persist();
            } catch (caught) {
                if (this.recordCloudScriptFailure(scriptId, index, caught)) return;
            }
        }

        this.finishCloudScript(scriptId);
    }

    private finishCloudScript(scriptId: string) {
        const script = this.scripts.get(scriptId);
        if (!script) return;
        const successes = script.statements.filter(
            item => item.status === 'succeeded' || item.status === 'truncated',
        ).length;
        const failed = script.statements.some(
            item =>
                item.status === 'failed' ||
                item.status === 'timed_out' ||
                item.status === 'interrupted',
        );
        let status: 'cancelled' | 'failed' | 'succeeded' | 'partial';

        if (script.cancelled) {
            status = 'cancelled';
        } else if (failed) {
            if (successes) {
                status = 'partial';
            } else {
                status = 'failed';
            }
        } else {
            status = 'succeeded';
        }
        const statements = script.cancelled
            ? script.statements.map(item =>
                  item.status === 'pending' ? { ...item, status: 'skipped' as const } : item,
              )
            : script.statements;
        this.scripts.set(scriptId, { ...script, status, statements });
        this.persist();
    }

    private recordCloudScriptFailure(scriptId: string, index: number, caught: unknown): boolean {
        const current = this.scripts.get(scriptId);
        if (!current) return true;
        const error: ApiError =
            caught instanceof CloudRequestError
                ? { code: caught.code, message: caught.message }
                : {
                      code: 'CLOUD_SCRIPT_STATEMENT',
                      message:
                          caught instanceof Error
                              ? caught.message
                              : 'ClickHouse could not run this statement.',
                  };
        const statements = [...current.statements];
        statements[index] = { ...statements[index]!, status: 'failed', error };
        if (current.stopOnError)
            for (let later = index + 1; later < statements.length; later++)
                if (statements[later]!.status === 'pending')
                    statements[later] = { ...statements[later]!, status: 'skipped' };
        const successes = statements.filter(
            item => item.status === 'succeeded' || item.status === 'truncated',
        ).length;
        const hasPending = statements.some(item => item.status === 'pending');
        const getInterruptedScriptStatus = () => {
            if (current.cancelled) {
                return 'cancelled';
            }

            if (hasPending) {
                return 'running';
            }

            if (successes) {
                return 'partial';
            }

            return 'failed';
        };
        this.scripts.set(scriptId, {
            ...current,
            status: getInterruptedScriptStatus(),
            statements,
        });
        this.persist();
        return current.stopOnError;
    }

    private demoSchema(): Schema {
        const importedBytes = JSON.stringify(this.demoImportRows).length;
        return {
            ...schema,
            fetchedAt: now(),
            tables: schema.tables.map(table =>
                table.name === 'interview_imports'
                    ? {
                          ...table,
                          rowEstimate: String(this.demoImportRows.length),
                          sizeBytes: String(importedBytes),
                          uncompressedBytes: String(importedBytes),
                          parts: this.demoImportRows.length ? '1' : '0',
                          activeParts: this.demoImportRows.length ? '1' : '0',
                      }
                    : table,
            ),
        };
    }

    private async importRequest(
        parts: string[],
        method: string,
        body: Record<string, unknown>,
    ): Promise<unknown> {
        if (parts.length === 1 && method === 'GET') return [];
        if (parts[1] === 'preview' && method === 'POST') return this.previewDemoImport(body);
        const id = parts[1];
        if (!id) throw new Error('Import request is incomplete');
        if (parts.length === 2 && method === 'DELETE') {
            this.demoImportInputs.delete(id);
            for (const [mappingId, mapping] of this.demoImportMappings)
                if (mapping.inputId === id) this.demoImportMappings.delete(mappingId);
            return { ok: true };
        }
        if (parts[2] === 'mapping' && method === 'POST') return this.mapDemoImport(id, body);
        if (parts[2] === 'commit' && method === 'POST') return this.commitDemoImport(id);
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
        throw new Error('Unknown browser demo import action');
    }

    private previewDemoImport(body: Record<string, unknown>) {
        const format = IMPORT_FORMATS.find(format => format === body.format);
        if (!format) throw new Error('Use CSV, JSON, or NDJSON');
        if (typeof body.source !== 'string' || typeof body.name !== 'string')
            throw new Error('Choose a file to preview');
        const parsed = parseDemoImport(body.source, format);
        if (!parsed.rows.length) throw new Error('The input contains no data rows');
        const id = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        const input = { id, name: body.name.slice(0, 128), format, ...parsed, expiresAt };
        this.demoImportInputs.set(id, input);
        return {
            ...input,
            rows: input.rows.slice(0, IMPORT_PREVIEW_ROWS),
            rowCount: input.rows.length,
        };
    }

    private mapDemoImport(id: string, body: Record<string, unknown>) {
        const input = this.demoImportInputs.get(id);
        if (!input || Date.parse(input.expiresAt) <= Date.now())
            throw new Error('This preview expired; upload the file again');
        if (body.connectionId !== 'demo' || body.table !== DEMO_IMPORT_TARGET)
            throw new Error('Choose the browser demo table as the destination');
        const fields = record(body.fields) as Record<string, unknown>;
        const destinations = Object.values(fields);
        const allowed = ['day', 'region', 'channel', 'events', 'revenue'];
        if (
            !destinations.length ||
            destinations.some(value => typeof value !== 'string' || !allowed.includes(value)) ||
            new Set(destinations).size !== destinations.length
        )
            throw new Error('Each destination column must be mapped once');
        const mappedRows = input.rows.map(row => {
            const mapped = Object.create(null) as DemoImportRow;
            for (const [source, destination] of Object.entries(fields)) {
                if (
                    !input.columns.includes(source) ||
                    typeof destination !== 'string' ||
                    !allowed.includes(destination) ||
                    !Object.hasOwn(row, source)
                )
                    throw new Error('Mapping references an unknown source or destination column');
                mapped[destination] = row[source]!;
            }
            return mapped;
        });
        const mapping = {
            id: crypto.randomUUID(),
            inputId: id,
            connectionId: 'demo',
            table: DEMO_IMPORT_TARGET,
            fields: fields as Record<string, string>,
            rows: mappedRows,
        };
        this.demoImportMappings.set(mapping.id, mapping);
        return {
            ...mapping,
            rows: mappedRows.slice(0, IMPORT_PREVIEW_ROWS),
            rowCount: mappedRows.length,
        };
    }

    private async commitDemoImport(id: string) {
        const mapping = this.demoImportMappings.get(id);
        if (!mapping) throw new Error('Mapping not found; review the columns again');
        if (this.demoImportJobs.has(id)) return this.demoImportJobs.get(id);
        const rows = [...this.demoImportRows, ...mapping.rows];
        let demoPersisted = true;
        try {
            await saveDemoImportRows(rows);
        } catch {
            demoPersisted = false;
        }
        this.demoImportRows = rows;
        const job = {
            id,
            connectionId: 'demo',
            table: mapping.table,
            rows: mapping.rows.length,
            createdAt: now(),
            status: 'succeeded' as const,
            demoRows: mapping.rows.slice(0, 8),
            demoPersisted,
        };
        this.demoImportJobs.set(id, job);
        return job;
    }

    private getRun(id: string) {
        let run = this.runs.get(id);
        if (!run) throw new RetainedRunUnavailableError();
        const expiresAtMs = run.resultExpiresAt ? Date.parse(run.resultExpiresAt) : Number.NaN;
        if (
            run.connectionId === PLAYGROUND_CONNECTION_ID &&
            run.resultState === 'reopenable' &&
            (!this.results.has(run.id) ||
                (Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now()))
        ) {
            this.results.delete(run.id);
            run = { ...run, resultState: 'expired' };
            this.runs.set(run.id, run);
            this.persist();
        }
        return run;
    }

    private documentsFor(trash: boolean, connectionId?: string | null) {
        return [...this.documents.values()].filter(
            document =>
                (trash || !document.deletedAt) &&
                (!connectionId || document.connectionId === connectionId),
        );
    }

    private saveDocument(input: Record<string, unknown>, id?: string) {
        const previous = id ? this.documents.get(id) : undefined;
        const timestamp = now();
        const parameters = Object.fromEntries(
            Object.entries(record(input.parameters)).filter(
                (entry): entry is [string, string] => typeof entry[1] === 'string',
            ),
        );
        const document: QueryDocument = {
            id: previous?.id ?? id ?? crypto.randomUUID(),
            owner,
            name: typeof input.name === 'string' ? input.name : 'Untitled.sql',
            connectionId:
                input.connectionId === PLAYGROUND_CONNECTION_ID ||
                input.connectionId === CLICKHOUSE_CLOUD_CONNECTION_ID
                    ? input.connectionId
                    : 'demo',
            sql: typeof input.sql === 'string' ? input.sql : DEMO_PREVIEW_SQL,
            revision: (previous?.revision ?? 0) + 1,
            createdAt: previous?.createdAt ?? timestamp,
            updatedAt: timestamp,
            parameters,
            chart: chartConfig(input.chart),
            runId: typeof input.runId === 'string' ? input.runId : undefined,
            parentDocumentId:
                typeof input.parentDocumentId === 'string' ? input.parentDocumentId : undefined,
            dependencies: Array.isArray(input.dependencies)
                ? input.dependencies.filter((value): value is string => typeof value === 'string')
                : [],
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
        if (options.signal?.aborted)
            throw options.signal.reason ?? new Error('The request was cancelled.');
        const url = new URL(path, 'https://preview.invalid');
        const pathname = url.pathname.replace(/\/+$/, '') || '/';
        const method = options.method ?? 'GET';
        const parts = pathname
            .split('/')
            .filter(Boolean)
            .map(part => decodeURIComponent(part));
        const body = record(options.body);

        switch (parts[0]) {
            case 'connections':
                if (pathname === '/connections' && method === 'GET') {
                    const cloud = getClickHouseCloudConnection();
                    return [
                        connection(this.trusted),
                        PLAYGROUND_CONNECTION,
                        ...(cloud ? [cloud] : []),
                    ];
                }
                return this.requestConnection(parts, method, body, url, options);
            case 'imports':
                return this.importRequest(parts, method, body);
            case 'runs':
                return this.requestRuns(pathname, parts, method, body, url, options);
            case 'scripts':
                if (pathname === '/scripts' && method === 'POST') return this.submitScript(body);
                if (parts[1]) return this.requestScript(parts[1], parts[2], method);
                break;
            case 'documents':
                if (pathname === '/documents' && method === 'GET')
                    return this.documentsFor(
                        url.searchParams.get('trash') === 'true',
                        url.searchParams.get('connectionId'),
                    );
                if (pathname === '/documents' && method === 'POST') return this.saveDocument(body);
                if (parts[1]) return this.requestDocument(parts[1], parts, method, body);
                break;
        }
        return this.requestStaticPath(pathname, method);
    }

    private requestRuns(
        pathname: string,
        parts: string[],
        method: string,
        body: ReturnType<typeof record>,
        url: URL,
        options: RequestOptions,
    ): unknown {
        if (pathname === '/runs' && method === 'POST') return this.submitRun(body, options);
        if (pathname === '/runs' && method === 'GET') {
            const connectionId = url.searchParams.get('connectionId');
            return [...this.runs.values()]
                .filter(run => !connectionId || run.connectionId === connectionId)
                .sort(
                    (left, right) =>
                        right.createdAt.localeCompare(left.createdAt) ||
                        right.sequence - left.sequence,
                );
        }
        if (parts[1]) return this.requestRun(parts, method, url);
        return {};
    }

    private requestStaticPath(pathname: string, method: string): unknown {
        if (pathname === '/session')
            return { principal: { id: owner, role: 'owner' }, requiresLogin: false, demo: true };
        if (pathname === '/assistant/status')
            return {
                available: false,
                reason: 'Assistant features are unavailable in the static sample preview.',
            };
        if (pathname === '/assistant/context' && method === 'POST')
            throw new Error(
                'AI context preview is unavailable in this static sample. Open a connected workspace to use the assistant.',
            );
        if (pathname === '/assistant/proposals' && method === 'POST')
            throw new Error(
                'AI proposals are unavailable in this static sample. Open a connected workspace to use the assistant.',
            );
        if (pathname === '/voice/status')
            return {
                available: false,
                reason: 'Voice features are unavailable in the static sample preview.',
            };
        if (
            pathname === '/imports' ||
            pathname === '/monitors' ||
            pathname === '/notices' ||
            pathname === '/audit' ||
            pathname === '/published'
        )
            return [];
        if (pathname === '/health') return { ok: true, demo: true, version: '0.1.0' };
        return {};
    }

    private async requestConnection(
        parts: string[],
        method: string,
        body: ReturnType<typeof record>,
        url: URL,
        options: RequestOptions,
    ): Promise<unknown> {
        switch (parts[2]) {
            case 'schema':
                switch (parts[1]) {
                    case 'demo':
                        return this.demoSchema();
                    case PLAYGROUND_CONNECTION_ID:
                        return loadPlaygroundSchema(
                            options.signal,
                            url.searchParams.get('refresh') === 'true',
                        );
                    case CLICKHOUSE_CLOUD_CONNECTION_ID:
                        if (method === 'GET')
                            return loadClickHouseCloudSchema({
                                databaseOffset: Number(url.searchParams.get('databaseOffset') ?? 0),
                                tableOffset: Number(url.searchParams.get('tableOffset') ?? 0),
                                columnOffset: Number(url.searchParams.get('columnOffset') ?? 0),
                            });
                }
                break;
            case 'documentation':
                if (parts[1] === CLICKHOUSE_CLOUD_CONNECTION_ID && method === 'GET')
                    return this.requestCloudDocumentation(parts, url, options);
                break;
            case 'query-tree':
                if (method === 'POST') return this.requestQueryTree(parts, body, options);
                break;
            default:
                return this.requestConnectionMetadata(parts, method, body, url);
        }
        return {};
    }

    private requestConnectionMetadata(
        parts: string[],
        method: string,
        body: ReturnType<typeof record>,
        url: URL,
    ): unknown {
        if (parts[1] === PLAYGROUND_CONNECTION_ID) {
            switch (parts[2]) {
                case 'workload':
                case 'replication':
                    throw new Error(
                        'Observability system-table access is unavailable in the public Playground browser preview.',
                    );
                case 'import-targets':
                    return [];
            }
        }
        if (parts[1] !== 'demo') return {};
        switch (parts[2]) {
            case 'native-explorer':
                if (method === 'POST') return this.requestDemoNativeExplorer(body);
                break;
            case 'workload': {
                if (!this.trusted)
                    throw new Error('Trust this connection before inspecting workload history.');
                const rawMinutes = url.searchParams.get('minutes') ?? '60';
                if (!WORKLOAD_WINDOWS.some(minutes => String(minutes) === rawMinutes))
                    throw new Error('minutes must be 15, 60, 360, or 1440.');
                return demoWorkload('demo', Number(rawMinutes) as WorkloadWindow);
            }
            case 'replication':
                if (!this.trusted)
                    throw new Error('Trust this connection before inspecting replication health.');
                return demoReplication('demo');
            case 'table-parts':
                if (method === 'POST') {
                    if (body.database !== 'demo' || body.table !== 'events')
                        throw new Error('The selected table is not available in this sample.');
                    return parseMergeTreeParts('demo', 'events', demoMergeTreePartRows());
                }
                break;
            case 'trust':
                if (method === 'POST') {
                    this.trusted = body.trusted === true;
                    this.persist();
                    return { trusted: this.trusted };
                }
                break;
            case 'import-targets':
                return [DEMO_IMPORT_TARGET];
        }
        return {};
    }

    private async requestCloudDocumentation(
        parts: string[],
        url: URL,
        options: RequestOptions,
    ): Promise<unknown> {
        const cloud = getClickHouseCloudConnection();
        if (!cloud)
            throw new CloudRequestError(
                'CLOUD_DISCONNECTED',
                'Reconnect to ClickHouse Cloud before opening reference docs.',
                401,
            );
        if (parts[3] === 'search')
            return await searchClickHouseCloudDocumentation(
                url.searchParams.get('query') ?? '',
                url.searchParams.get('category') ?? 'all',
                options.signal,
            );
        if (parts[3] === 'entry') {
            const entry = await loadClickHouseCloudDocumentationEntry(
                url.searchParams.get('name') ?? '',
                url.searchParams.get('type') ?? '',
                options.signal,
            );
            if (!entry) throw new Error('ClickHouse returned no documentation for this entry.');
            return entry satisfies ClickHouseDocumentationEntry;
        }
        const name = url.searchParams.get('name') ?? '';
        const entry = await loadClickHouseCloudDocumentationEntry(
            name,
            'System Table',
            options.signal,
        );
        if (!entry) throw new Error(`ClickHouse returned no documentation for system.${name}.`);
        return entry satisfies ClickHouseDocumentationEntry;
    }

    private requestDemoNativeExplorer(body: ReturnType<typeof record>): unknown {
        if (!this.trusted)
            throw new Error('Trust this connection before inspecting native metadata.');
        if (typeof body.database !== 'string') throw new Error('A database is required.');
        if (body.kind === 'lineage')
            return nativeExplorerFixture({ kind: 'lineage', database: body.database });
        if ((body.kind === 'merges' || body.kind === 'mutations') && typeof body.table === 'string')
            return nativeExplorerFixture({
                kind: body.kind,
                database: body.database,
                table: body.table,
            });
        throw new Error('Unknown native explorer request.');
    }

    private async requestQueryTree(
        parts: string[],
        body: ReturnType<typeof record>,
        options: RequestOptions,
    ): Promise<unknown> {
        const sql = typeof body.sql === 'string' ? body.sql : '';
        const parameters = record(body.parameters) as Record<string, string>;
        if (parts[1] === PLAYGROUND_CONNECTION_ID) {
            if (Object.keys(parameters).length)
                throw new Error(
                    'Remove query parameters before inspecting SQL on ClickHouse Playground.',
                );
            const response = await queryPlaygroundQueryTree(sql, options.signal);
            return response.rows.map(row => String(row[0] ?? '')).filter(Boolean);
        }
        if (parts[1] === CLICKHOUSE_CLOUD_CONNECTION_ID) {
            if (!getClickHouseCloudConnection())
                throw new CloudRequestError(
                    'CLOUD_DISCONNECTED',
                    'Reconnect to ClickHouse Cloud before analyzing SQL.',
                    401,
                );
            return await loadClickHouseCloudQueryTree(sql, parameters, options.signal);
        }
        if (parts[1] === 'demo') return [...demoQueryTree];
        return {};
    }

    private submitScript(body: ReturnType<typeof record>): Script {
        if (body.connectionId === PLAYGROUND_CONNECTION_ID)
            throw new Error('Run one statement at a time on ClickHouse Playground.');
        let sql: string;

        if (typeof body.sql === 'string') {
            sql = body.sql;
        } else if (body.connectionId === CLICKHOUSE_CLOUD_CONNECTION_ID) {
            sql = '';
        } else {
            sql = DEMO_PREVIEW_SQL;
        }
        const id = crypto.randomUUID();
        const statements = splitSql(sql);
        if (body.connectionId === CLICKHOUSE_CLOUD_CONNECTION_ID) {
            if (!getClickHouseCloudConnection())
                throw new CloudRequestError(
                    'CLOUD_DISCONNECTED',
                    'Reconnect to ClickHouse Cloud before running a script.',
                    401,
                );
            if (!sql.trim() || sql.length > MAX_SQL_CHARS)
                throw new Error(
                    `Enter a script under ${MAX_SQL_CHARS.toLocaleString()} characters.`,
                );
            if (statements.length === 0 || statements.length > MAX_SCRIPT_STATEMENTS)
                throw new Error(`A script must contain 1–${MAX_SCRIPT_STATEMENTS} SQL statements.`);
            if (Object.keys(record(body.parameters)).length)
                throw new Error(
                    'Remove query parameters before running a script on ClickHouse Cloud.',
                );
            const script: Script = {
                id,
                owner,
                connectionId: CLICKHOUSE_CLOUD_CONNECTION_ID,
                sql,
                createdAt: now(),
                status: 'running',
                stopOnError: body.stopOnError !== false,
                cancelled: false,
                statements: statements.map(statement => ({ ...statement, status: 'pending' })),
            };
            this.scripts.set(id, script);
            this.persist();
            void this.executeCloudScript(id);
            return script;
        }
        const items = statements.map(statement => {
            const run = this.addRun(
                crypto.randomUUID(),
                statement.sql,
                'query',
                record(body.parameters) as Record<string, string>,
            );
            return { ...statement, runId: run.id, status: 'succeeded' as const };
        });
        const script: Script = {
            id,
            owner,
            connectionId: 'demo',
            sql,
            createdAt: now(),
            status: 'succeeded',
            stopOnError: body.stopOnError !== false,
            cancelled: false,
            statements: items,
        };
        this.scripts.set(id, script);
        this.persist();
        return script;
    }

    private requestScript(id: string, action: string | undefined, method: string): Script {
        const script = this.scripts.get(id);
        if (action === 'cancel' && method === 'POST') {
            if (!script) throw new Error('This script is no longer available in this browser.');
            if (
                script.connectionId !== CLICKHOUSE_CLOUD_CONNECTION_ID ||
                script.status !== 'running' ||
                script.cancelled
            )
                return script;
            const stopping = { ...script, cancelled: true };
            this.scripts.set(script.id, stopping);
            this.persist();
            return stopping;
        }
        return (
            script ??
            ({
                id,
                owner,
                connectionId: 'demo',
                sql: DEMO_PREVIEW_SQL,
                createdAt: now(),
                status: 'succeeded',
                stopOnError: true,
                cancelled: false,
                statements: [],
            } satisfies Script)
        );
    }

    private requestDocument(
        id: string,
        parts: string[],
        method: string,
        body: ReturnType<typeof record>,
    ): unknown {
        if (parts.length === 2 && method === 'PUT') return this.saveDocument(body, id);
        if (parts[2] === 'revisions' && method === 'GET') {
            const current = this.documents.get(id);
            if (!current) throw new Error('Sample document not found.');
            return [...(this.revisions.get(id) ?? [current])].sort(
                (left, right) => right.revision - left.revision,
            );
        }
        if (parts[2] === 'restore-revision' && method === 'POST')
            return this.restoreDocumentRevision(id, body);
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
        if (parts.length === 2)
            return (
                this.documents.get(id) ?? {
                    error: { code: 'NOT_FOUND', message: 'Sample document not found.' },
                }
            );
        return {};
    }

    private restoreDocumentRevision(id: string, body: ReturnType<typeof record>): QueryDocument {
        const current = this.documents.get(id);
        if (!current) throw new Error('Sample document not found.');
        const revisionNumber =
            typeof body.revision === 'number' ? body.revision : Number(body.revision);
        const baseRevision =
            typeof body.baseRevision === 'number' ? body.baseRevision : Number(body.baseRevision);
        if (
            !Number.isSafeInteger(revisionNumber) ||
            revisionNumber < 1 ||
            !Number.isSafeInteger(baseRevision) ||
            baseRevision < 1
        )
            throw new Error('Choose a valid saved version to restore.');
        if (current.revision !== baseRevision)
            throw new Error('A newer version exists. Refresh version history and try again.');
        const historical = this.revisions
            .get(id)
            ?.find(version => version.revision === revisionNumber);
        if (!historical)
            throw new Error(
                'This saved version is no longer available. Refresh version history and try again.',
            );
        const restored: QueryDocument = {
            ...historical,
            revision: current.revision + 1,
            updatedAt: now(),
            runId: undefined,
        };
        this.documents.set(id, restored);
        this.revisions.set(id, [...(this.revisions.get(id) ?? [current]), restored]);
        this.persist();
        return restored;
    }

    private async requestRun(parts: string[], method: string, url: URL): Promise<unknown> {
        let run = this.getRun(parts[1]!);
        if (
            parts.length === 2 &&
            method === 'GET' &&
            run.connectionId === CLICKHOUSE_CLOUD_CONNECTION_ID
        )
            run = await this.refreshCloudRunProgress(run);
        if (parts[2] === 'result' || parts[2] === 'snapshot') {
            const result = this.results.get(run.id);
            if (!result && run.connectionId === PLAYGROUND_CONNECTION_ID)
                throw new Error(
                    'This retained Playground result is no longer available in this browser. Run the SQL again.',
                );
            const retained = result ?? resultFor(run);
            if (parts[2] === 'snapshot') return retained;
            const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0) || 0);
            const count = Math.max(
                1,
                Math.min(
                    500,
                    Number(url.searchParams.get('count') ?? DEFAULT_RESULT_PAGE_ROWS) ||
                        DEFAULT_RESULT_PAGE_ROWS,
                ),
            );
            return {
                ...retained,
                rows: retained.rows.slice(offset, offset + count),
                offset,
                totalRows: retained.rows.length,
                nextOffset: offset + count < retained.rows.length ? offset + count : null,
            } satisfies ResultPage;
        }
        if (parts[2] === 'cancel' && method === 'POST') {
            if (run.connectionId === CLICKHOUSE_CLOUD_CONNECTION_ID && run.status === 'running') {
                const cloud = getClickHouseCloudConnection();
                if (!cloud)
                    throw new CloudRequestError(
                        'CLOUD_DISCONNECTED',
                        'Reconnect to ClickHouse Cloud before stopping SQL.',
                        401,
                    );
                if (!cloud.manifest?.cancellation.available)
                    throw new CloudRequestError(
                        'CAPABILITY_UNAVAILABLE',
                        cloud.manifest?.cancellation.reason ??
                            'ClickHouse query cancellation is unavailable.',
                        409,
                    );
                const cancellation = await cancelClickHouseCloudQuery(run.queryId);
                const current = this.runs.get(run.id) ?? run;
                if (current.status !== 'running' || !cancellation.cancelled) return current;
                const cancelled: Run = {
                    ...current,
                    status: 'cancelled',
                    resultState: 'unavailable',
                    finishedAt: now(),
                    sequence: ++this.sequence,
                };
                this.runs.set(run.id, cancelled);
                this.results.delete(run.id);
                this.persist();
                return cancelled;
            }
            const cancelled = {
                ...run,
                status: 'cancelled' as const,
                resultState: 'unavailable' as const,
                finishedAt: now(),
            };
            this.runs.set(run.id, cancelled);
            this.results.delete(run.id);
            this.persist();
            return cancelled;
        }
        if (parts[2] === 'profile') return this.requestRunProfile(run, parts[3]);
        return run;
    }

    private async requestRunProfile(run: Run, view?: string): Promise<unknown> {
        if (run.connectionId === PLAYGROUND_CONNECTION_ID)
            throw new Error(
                'Query-log and pipeline profiling are unavailable on ClickHouse Playground.',
            );
        if (run.connectionId === CLICKHOUSE_CLOUD_CONNECTION_ID)
            return this.requestCloudRunProfile(run, view);
        if (view === 'flamegraph') {
            if (!this.trusted)
                throw new Error('Trust this connection before inspecting profiler samples.');
            if (run.status === 'running' || run.status === 'queued')
                throw new Error('Wait for the query to finish before loading its flamegraph.');
            return demoFlamegraph(run.queryId);
        }
        const pipeline = {
            available: true,
            source: 'query_shape' as const,
            truncated: false,
            nodes: [
                {
                    id: 'read',
                    label: 'Sample rows',
                    kind: 'read' as const,
                    status: 'estimated' as const,
                    rows: String(run.rowCount),
                },
                {
                    id: 'output',
                    label: 'Output',
                    kind: 'output' as const,
                    status: 'estimated' as const,
                    rows: String(run.rowCount),
                },
            ],
            edges: [{ source: 'read', target: 'output' }],
        };
        if (view === 'pipeline') return pipeline;
        return {
            version: 1,
            queryId: run.queryId,
            runId: run.id,
            summary: {
                durationMs: run.elapsedMs,
                resultRows: run.rowCount,
                readRows: String(run.rowCount),
                readBytes: String(run.bytes),
            },
            insights: [],
            pipeline,
            capabilities: {
                queryLog: false,
                pipelineGraph: true,
                indexAnalysis: false,
                runtimePlan: false,
            },
            evidence: [],
            notice: 'Generated preview data only. This is not a ClickHouse profile.',
        };
    }

    private async requestCloudRunProfile(run: Run, view?: string): Promise<unknown> {
        const cloud = getClickHouseCloudConnection();
        if (!cloud)
            throw new CloudRequestError(
                'CLOUD_DISCONNECTED',
                'Reconnect to ClickHouse Cloud before inspecting the query.',
                401,
            );
        if (view === 'flamegraph') {
            if (!cloud.manifest?.traceLog?.available)
                throw new CloudRequestError(
                    'CAPABILITY_UNAVAILABLE',
                    cloud.manifest?.traceLog?.reason ?? 'Profiler samples are unavailable.',
                    409,
                );
            if (run.status === 'running' || run.status === 'queued')
                throw new Error('Wait for the query to finish before loading its flamegraph.');
            return await loadClickHouseCloudFlamegraph(run.queryId, run.createdAt, run.finishedAt);
        }
        if (view === 'pipeline') {
            if (!cloud.manifest?.pipeline.available)
                throw new CloudRequestError(
                    'CAPABILITY_UNAVAILABLE',
                    cloud.manifest?.pipeline.reason ??
                        'ClickHouse pipeline evidence is unavailable.',
                    409,
                );
            const prefix = sqlForRunKind('', run.kind);
            const sql =
                run.kind !== 'query' && run.sql.startsWith(prefix)
                    ? run.sql.slice(explainPrefixLength(run.kind))
                    : run.sql;
            const raw = await loadClickHouseCloudPipeline(sql, run.parameters);
            const parsed = parsePipelineResult(raw);
            if (!parsed)
                throw new Error(
                    'ClickHouse returned no structured EXPLAIN PIPELINE graph for this query.',
                );
            return parsed satisfies ProfilePipeline;
        }
        const queryLogAvailable = Boolean(
            cloud.manifest?.queryLog.available && cloud.manifest.queryLogSource,
        );
        const evidence = queryLogAvailable
            ? await loadClickHouseCloudProfileEvidence(run.queryId).catch(() => [])
            : [];
        return buildQueryProfile(run, evidence, {
            queryLogAvailable,
            pipelineAvailable: Boolean(cloud.manifest?.pipeline.available),
            notice: queryLogAvailable
                ? 'ClickHouse query-log rows may arrive after a server flush interval. Missing rows are shown as unavailable, not estimated.'
                : (cloud.manifest?.queryLog.reason ??
                  'Query-log access is unavailable. Only retained run metrics are shown.'),
        }) satisfies QueryProfile;
    }

    private async submitRun(body: ReturnType<typeof record>, options: RequestOptions) {
        const requestedKind =
            body.kind === 'explain' ||
            body.kind === 'plan' ||
            body.kind === 'pipeline' ||
            body.kind === 'analyze'
                ? body.kind
                : 'query';
        const parameters = record(body.parameters) as Record<string, string>;
        if (body.connectionId === PLAYGROUND_CONNECTION_ID) {
            if (Object.keys(parameters).length)
                throw new Error(
                    'Remove query parameters before running SQL on ClickHouse Playground.',
                );
            const sql = typeof body.sql === 'string' ? body.sql : '';
            const executionSql = sqlForRunKind(sql, requestedKind);
            const response = await queryPlayground(executionSql, options.signal);
            const finishedAt = now();
            const startedAt = new Date(Date.now() - response.elapsedMs).toISOString();
            const runId = crypto.randomUUID();
            const status = response.truncated ? ('truncated' as const) : ('succeeded' as const);
            const warnings = response.truncated
                ? ['The result reached the 1,000-row display limit and may be incomplete.']
                : [];
            const resultExpiresAt = expiresAt();
            const run: Run = {
                dataSource: 'clickhouse',
                id: runId,
                queryId: response.queryId,
                owner,
                connectionId: PLAYGROUND_CONNECTION_ID,
                sql,
                kind: requestedKind,
                parameters: {},
                limits: { ...PLAYGROUND_CONNECTION.limits },
                tags: {
                    workspace: 'clickstudio',
                    source: 'ClickHouse SQL Playground',
                    execution: 'browser direct',
                },
                status,
                createdAt: startedAt,
                startedAt,
                finishedAt,
                elapsedMs: response.elapsedMs,
                rowCount: response.rows.length,
                bytes: response.bytes,
                columns: response.columns,
                warnings,
                sequence: ++this.sequence,
                resultExpiresAt,
                resultState: 'reopenable',
                requestedBy: owner,
                executedAs: PLAYGROUND_CONNECTION.username,
                permissionSnapshot: { readonly: true, role: 'public demo' },
                retryPolicy: 'never',
            };
            const result: Result = {
                runId,
                queryId: response.queryId,
                columns: response.columns,
                rows: response.rows,
                completeness: response.truncated ? 'truncated' : 'complete',
                createdAt: finishedAt,
                expiresAt: resultExpiresAt,
            };
            this.runs.set(run.id, run);
            this.results.set(run.id, result);
            this.persist();
            return run;
        }
        if (body.connectionId === CLICKHOUSE_CLOUD_CONNECTION_ID) {
            const cloud = getClickHouseCloudConnection();
            if (!cloud)
                throw new CloudRequestError(
                    'CLOUD_DISCONNECTED',
                    'Reconnect to ClickHouse Cloud before running SQL.',
                    401,
                );
            const sql = typeof body.sql === 'string' ? body.sql : '';
            const executionSql = sqlForRunKind(sql, requestedKind);
            return this.startCloudRun(executionSql, requestedKind, parameters, cloud);
        }
        const run = this.addRun(
            crypto.randomUUID(),
            typeof body.sql === 'string' ? body.sql : DEMO_PREVIEW_SQL,
            requestedKind,
            parameters,
        );
        return run;
    }
}
