import { isTerminalRunStatus } from '../../../shared/queries/execution/status.js';
import {
    MAX_SCRIPT_STATEMENTS,
    MAX_RESULT_PAGE_ROWS,
    DEFAULT_RESULT_PAGE_ROWS,
} from '../../../shared/queries/execution/limits.js';
import { randomUUID } from 'node:crypto';
import type { Column, Row } from '../../../shared/common/values.js';
import type { Connection } from '../../../shared/database/connections/types.js';
import type { Limits } from '../../../shared/queries/execution/settings.js';
import type { Principal } from '../../../shared/common/identity.js';
import type {
    Progress,
    Run,
    RunEvent,
    RunRequest,
    Script,
} from '../../../shared/queries/execution/types.js';
import type { Result, ResultPage } from '../../../shared/queries/results/types.js';
import { splitSql } from '../../../shared/sql/sql.js';
import { AppError, asError, requireThat } from '../../system/requests/errors.js';
import { canWrite, mustOwn } from '../../system/login/permissions.js';
import { guardRun } from './guards.js';
import { audit, hash, type Store } from '../../system/storage/store.js';
import { limits, runRequest } from '../../system/requests/validation.js';
export interface DriverResult {
    columns: Column[];
    rows: Row[];
    truncated: boolean;
    bytes?: number;
    bounded?: {
        rows: number;
        bytes: number;
    };
    warnings?: string[];
    serverVersion?: string;
}
export interface QueryDriver {
    execute(
        run: Run,
        signal: AbortSignal,
        progress: (value: Progress) => void,
    ): Promise<DriverResult>;
    cancel(run: Run): Promise<void>;
}
interface Receipt {
    id: string;
    fingerprint: string;
    resourceId: string;
    kind: 'run' | 'script';
    at: string;
}
export const DEFAULT_SCRIPT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const DEFAULT_RECEIPT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const DEFAULT_RUN_HISTORY_LIMIT = 10_000;
export const DEFAULT_RECEIPT_LIMIT = 100_000;
export function terminal(run: Pick<Run, 'status'>) {
    return isTerminalRunStatus(run.status);
}
export class RunService {
    private readonly listeners = new Map<string, Set<(event: RunEvent) => void>>();
    private readonly controllers = new Map<string, AbortController>();
    private readonly queue: string[] = [];
    private active = 0;
    private closed = false;
    constructor(
        public readonly store: Store,
        private readonly driver: QueryDriver,
        private readonly connection: (principal: Principal, id: string) => Connection,
        private readonly options: {
            concurrency?: number;
            retentionMs?: number;
            snapshotBytes?: number;
            scriptRetentionMs?: number;
            receiptRetentionMs?: number;
            runHistoryLimit?: number;
            receiptLimit?: number;
        } = {},
    ) {
        // An interrupted query is never automatically replayed after a process restart.
        for (const run of store.list<Run>('runs'))
            if (!terminal(run)) {
                run.status = 'interrupted';
                run.finishedAt = new Date().toISOString();
                run.resultState = 'unavailable';
                run.warnings.push('The application restarted during this run. It was not retried.');
                this.emit(run);
                void driver.cancel(run).catch(() => undefined);
            }
        for (const script of store.list<Script>('scripts'))
            if (script.status === 'running') {
                script.status = 'interrupted';
                for (const s of script.statements)
                    if (s.status === 'pending' || s.status === 'queued' || s.status === 'running')
                        s.status = 'interrupted';
                store.put('scripts', script.id, script);
            }
        this.sweep();
    }
    get acceptingRuns(): boolean {
        return !this.closed;
    }
    private trustFingerprint(principal: Principal, connectionId: string): string {
        const connection = this.connection(principal, connectionId);
        return hash([
            connection.dataSource ?? 'clickhouse',
            connection.host,
            connection.database,
            connection.username,
            connection.readonly,
        ]);
    }
    isTrusted(principal: Principal, connectionId: string): boolean {
        const trust = this.store.get<{
            trusted: boolean;
            fingerprint?: string;
        }>('trust', hash([principal.id, connectionId]));
        return (
            trust?.trusted === true &&
            trust.fingerprint === this.trustFingerprint(principal, connectionId)
        );
    }
    trust(principal: Principal, connectionId: string, trusted: boolean) {
        canWrite(principal);
        const fingerprint = this.trustFingerprint(principal, connectionId);
        this.store.put('trust', hash([principal.id, connectionId]), {
            owner: principal.id,
            connectionId,
            fingerprint,
            trusted,
        });
        audit(
            this.store,
            principal,
            trusted ? 'connection.trust' : 'connection.untrust',
            connectionId,
        );
        if (!trusted)
            for (const run of this.list(principal, connectionId))
                if (!terminal(run)) void this.cancel(principal, run.id);
    }
    private authorize(principal: Principal, request: RunRequest): Connection {
        const conn = this.connection(principal, request.connectionId);
        try {
            guardRun(principal, request, this.isTrusted(principal, request.connectionId));
        } catch (error) {
            audit(
                this.store,
                principal,
                'run.execute',
                request.connectionId,
                'denied',
                error instanceof AppError ? error.code : undefined,
            );
            throw error;
        }
        if (request.parentRunId) {
            const parent = this.get(principal, request.parentRunId);
            requireThat(
                parent.connectionId === request.connectionId,
                409,
                'CONNECTION_MISMATCH',
                'A child run must use its parent connection',
            );
        }
        if (request.documentId) {
            const document = this.store.get<{
                owner: string;
                connectionId: string;
                deletedAt?: string;
            }>('documents', request.documentId);
            requireThat(
                document && !document.deletedAt,
                404,
                'NOT_FOUND',
                'Query document not found',
            );
            mustOwn(principal, document.owner);
            requireThat(
                document.connectionId === conn.id,
                409,
                'CONNECTION_MISMATCH',
                'The document belongs to another connection',
            );
        }
        if (
            request.kind === 'explain' ||
            request.kind === 'plan' ||
            request.kind === 'pipeline' ||
            request.kind === 'analyze'
        ) {
            let capability;

            switch (request.kind) {
                case 'explain':
                    capability = conn.manifest?.explain;
                    break;
                case 'plan':
                    capability = conn.manifest?.explainPlan ?? conn.manifest?.explain;
                    break;
                case 'analyze':
                    capability = conn.manifest?.explainAnalyze;
                    break;
                default:
                    capability = conn.manifest?.explainPipeline ?? conn.manifest?.pipeline;
                    break;
            }
            requireThat(
                capability?.available,
                409,
                'CAPABILITY_UNAVAILABLE',
                capability?.reason ?? 'Test the connection before using EXPLAIN',
            );
        }
        return conn;
    }
    private receipt(
        principal: Principal,
        requestId: string,
        payload: unknown,
        kind: Receipt['kind'],
    ): Receipt | undefined {
        const old = this.store.get<Receipt>('receipts', hash([principal.id, requestId]));
        if (old)
            requireThat(
                old.fingerprint === hash(payload) && old.kind === kind,
                409,
                'IDEMPOTENCY_CONFLICT',
                'This request ID was already used for different input. Review the action and use a new ID.',
            );
        return old;
    }
    private makeRunHistoryRoom(principal: Principal) {
        const limit = this.options.runHistoryLimit ?? DEFAULT_RUN_HISTORY_LIMIT;
        const count = this.store.count('runs');
        if (count < limit) return;
        const removeCount = count - limit + 1;
        const oldestFinished = this.store
            .list<Run>('runs')
            .filter(terminal)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
            .slice(0, removeCount);
        requireThat(
            oldestFinished.length === removeCount,
            507,
            'HISTORY_FULL',
            'Run history is full. No finished runs can be removed.',
        );
        for (const run of oldestFinished) {
            this.store.delete('results', run.id);
            this.store.delete('runs', run.id);
            audit(this.store, principal, 'run.history_prune', run.id);
        }
    }
    submit(principal: Principal, input: unknown): Run {
        requireThat(!this.closed, 503, 'SHUTTING_DOWN', 'The server is shutting down');
        const request = runRequest(input),
            conn = this.authorize(principal, request);
        const previous = this.receipt(principal, request.clientRequestId, request, 'run');
        if (previous) {
            requireThat(
                this.store.get('runs', previous.resourceId),
                409,
                'RETIRED_REQUEST',
                'This earlier request was deleted and will not be replayed',
            );
            return this.get(principal, previous.resourceId);
        }
        requireThat(
            this.queue.length + this.active < 50,
            429,
            'RUN_QUEUE_FULL',
            'There are too many pending runs',
        );
        const receiptLimit = this.options.receiptLimit ?? DEFAULT_RECEIPT_LIMIT;
        if (this.store.count('receipts') >= receiptLimit) {
            this.sweep();
            requireThat(
                this.store.count('receipts') < receiptLimit,
                507,
                'RECEIPT_CAPACITY',
                'Idempotency storage needs operator maintenance',
            );
        }
        this.makeRunHistoryRoom(principal);
        const id = randomUUID();
        const run: Run = {
            id,
            queryId: `clickstudio-${randomUUID()}`,
            owner: principal.id,
            dataSource: conn.dataSource ?? 'clickhouse',
            connectionId: conn.id,
            documentId: request.documentId,
            sql: request.sql,
            ...(request.sourceFrom === undefined
                ? {}
                : { sourceFrom: request.sourceFrom, sourceTo: request.sourceTo }),
            kind: request.kind ?? 'query',
            parameters: request.parameters ?? {},
            limits: limits(request.limits, conn.limits),
            tags: { ...request.tags, owner: principal.id },
            parentRunId: request.parentRunId,
            status: 'queued',
            createdAt: new Date().toISOString(),
            elapsedMs: 0,
            rowCount: 0,
            bytes: 0,
            columns: [],
            warnings: [],
            sequence: 0,
            resultState: 'pending',
            requestedBy: principal.id,
            executedAs: conn.username,
            permissionSnapshot: { readonly: true, role: principal.role },
            retryPolicy: 'never',
            serverVersion: conn.manifest?.serverVersion,
        };
        // Persist the reservation BEFORE making a database request. A failed save cannot execute
        // SQL.
        this.store.put('runs', id, run);
        const receiptId = hash([principal.id, request.clientRequestId]);
        this.store.put<Receipt>('receipts', receiptId, {
            id: receiptId,
            kind: 'run',
            fingerprint: hash(request),
            resourceId: id,
            at: run.createdAt,
        });
        audit(this.store, principal, 'run.execute', id);
        this.queue.push(id);
        queueMicrotask(() => this.drain());
        return structuredClone(run);
    }
    get(principal: Principal, id: string): Run {
        const run = this.store.get<Run>('runs', id);
        requireThat(run, 404, 'NOT_FOUND', 'Run not found');
        mustOwn(principal, run.owner);
        this.connection(principal, run.connectionId);
        if (
            run.resultExpiresAt &&
            Date.parse(run.resultExpiresAt) <= Date.now() &&
            run.resultState === 'reopenable'
        ) {
            run.resultState = 'expired';
            this.store.delete('results', run.id);
            this.store.put('runs', run.id, run);
        }
        return run;
    }
    list(principal: Principal, connectionId?: string, documentId?: string): Run[] {
        return this.store
            .list<Run>('runs')
            .filter(
                r =>
                    r.owner === principal.id &&
                    (!connectionId || r.connectionId === connectionId) &&
                    (!documentId || r.documentId === documentId),
            )
            .filter(r => {
                try {
                    this.connection(principal, r.connectionId);
                    return true;
                } catch {
                    return false;
                }
            })
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    result(principal: Principal, id: string): Result {
        const run = this.get(principal, id);
        requireThat(
            run.resultState !== 'expired',
            410,
            'RESULT_EXPIRED',
            'The retained result expired. SQL and run evidence remain available.',
        );
        requireThat(
            run.resultState === 'reopenable',
            409,
            'RESULT_UNAVAILABLE',
            'This run has no completed result',
        );
        const result = this.store.get<Result>('results', id);
        requireThat(
            result,
            410,
            'RESULT_EXPIRED',
            'Result data was evicted. Rerun explicitly to obtain fresh data.',
        );
        return result;
    }
    page(
        principal: Principal,
        id: string,
        offset = 0,
        count = DEFAULT_RESULT_PAGE_ROWS,
    ): ResultPage {
        requireThat(
            Number.isSafeInteger(offset) &&
                offset >= 0 &&
                Number.isSafeInteger(count) &&
                count >= 1 &&
                count <= MAX_RESULT_PAGE_ROWS,
            400,
            'INVALID_PAGE',
            'Invalid result page',
        );
        const result = this.result(principal, id);
        return {
            ...result,
            rows: result.rows.slice(offset, offset + count),
            offset,
            totalRows: result.rows.length,
            nextOffset: offset + count < result.rows.length ? offset + count : null,
        };
    }
    subscribe(principal: Principal, id: string, fn: (event: RunEvent) => void): () => void {
        const run = this.get(principal, id);
        if (!this.listeners.has(id)) this.listeners.set(id, new Set());
        this.listeners.get(id)!.add(fn);
        // Full authoritative snapshots make reconnect and finish-before-subscribe race-free.
        fn({ sequence: run.sequence, type: 'state', run });
        return () => {
            this.listeners.get(id)?.delete(fn);
            if (!this.listeners.get(id)?.size) this.listeners.delete(id);
        };
    }
    wait(principal: Principal, id: string): Promise<Run> {
        const run = this.get(principal, id);
        if (terminal(run)) return Promise.resolve(run);
        return new Promise(resolve => {
            const unsubscribe = this.subscribe(principal, id, e => {
                if (terminal(e.run)) {
                    unsubscribe();
                    resolve(e.run);
                }
            });
        });
    }
    async cancel(principal: Principal, id: string): Promise<Run> {
        canWrite(principal);
        const run = this.get(principal, id);
        if (terminal(run)) return run;
        audit(this.store, principal, 'run.cancel', id);
        if (run.status === 'queued') {
            const index = this.queue.indexOf(id);
            if (index >= 0) this.queue.splice(index, 1);
            run.status = 'cancelled';
            run.finishedAt = new Date().toISOString();
            run.resultState = 'unavailable';
            this.emit(run);
        } else {
            this.controllers
                .get(id)
                ?.abort(new AppError(409, 'CANCELLED', 'Cancellation requested by the user'));
            // Transport abort does not prove server-side cancellation. Keep that boundary visible.
            void this.driver
                .cancel(run)
                .catch(() =>
                    this.warning(
                        id,
                        'Server cancellation could not be confirmed; the server-side deadline still applies.',
                    ),
                );
        }
        return this.get(principal, id);
    }
    remove(principal: Principal, id: string) {
        canWrite(principal);
        const run = this.get(principal, id);
        requireThat(
            terminal(run),
            409,
            'RUN_ACTIVE',
            'Cancel or finish the run before deleting it',
        );
        this.store.delete('results', id);
        this.store.delete('runs', id);
        audit(this.store, principal, 'run.delete', id);
    }
    private warning(id: string, message: string) {
        const run = this.store.get<Run>('runs', id);
        if (!run) return;
        if (!run.warnings.includes(message)) {
            run.warnings.push(message);
            this.emit(run);
        }
    }
    private emit(run: Run, type: RunEvent['type'] = 'state', options: { persist?: boolean } = {}) {
        // sequence is a durable state revision. Ephemeral progress must never outrank
        // a later authoritative state recovered from disk after a process restart.
        if (options.persist !== false) {
            run.sequence++;
            this.store.put('runs', run.id, run);
        }
        const event: RunEvent = { sequence: run.sequence, type, run: structuredClone(run) };
        for (const fn of this.listeners.get(run.id) ?? []) {
            try {
                fn(structuredClone(event));
            } catch {
                /* A disconnected UI must not alter a database run. */
            }
        }
    }
    private drain() {
        while (!this.closed && this.active < (this.options.concurrency ?? 2) && this.queue.length) {
            const id = this.queue.shift()!;
            this.active++;
            void this.execute(id)
                .finally(() => {
                    this.active--;
                    this.drain();
                })
                .catch(error => {
                    this.closed = true;
                    console.error(
                        'Run persistence failure; shutting down is required.',
                        error instanceof Error ? error.name : 'Error',
                    );
                    process.exitCode = 1;
                });
        }
    }
    private async execute(id: string) {
        const run = this.store.get<Run>('runs', id);
        if (!run || terminal(run)) return;
        const principal: Principal = { id: run.owner, role: 'owner' };
        const controller = new AbortController();
        this.controllers.set(id, controller);
        let timeout: ReturnType<typeof setTimeout> | undefined;
        let removeAbort = () => {};
        const start = performance.now();
        try {
            // Trust is rechecked when queued work actually starts, not just when it is submitted.
            requireThat(
                this.isTrusted(principal, run.connectionId),
                403,
                'WORKSPACE_UNTRUSTED',
                'Connection trust was revoked while the query was queued',
            );
            this.connection(principal, run.connectionId);
            run.status = 'running';
            run.startedAt = new Date().toISOString();
            this.emit(run);
            timeout = setTimeout(() => {
                controller.abort(
                    new AppError(408, 'DEADLINE_EXCEEDED', 'The query exceeded its deadline'),
                );
                void this.driver
                    .cancel(run)
                    .catch(() =>
                        this.warning(
                            id,
                            'Server cancellation could not be confirmed after the deadline.',
                        ),
                    );
            }, run.limits.seconds * 1000);
            const aborted = new Promise<never>((_, reject) => {
                const onAbort = () => reject(controller.signal.reason);
                controller.signal.addEventListener('abort', onAbort, { once: true });
                removeAbort = () => controller.signal.removeEventListener('abort', onAbort);
            });
            const output = await Promise.race([
                this.driver.execute(run, controller.signal, progress => {
                    if (controller.signal.aborted || run.status !== 'running') return;
                    run.progress = progress;
                    run.elapsedMs = performance.now() - start;
                    this.emit(run, 'progress', { persist: false });
                }),
                aborted,
            ]);
            if (controller.signal.aborted) throw controller.signal.reason;
            const bounded = boundResult(output, run.limits);
            run.columns = bounded.columns;
            run.rowCount = bounded.rows.length;
            run.bytes = bounded.bytes;
            run.status = bounded.truncated ? 'truncated' : 'succeeded';
            run.warnings.push(...(output.warnings ?? []));
            run.serverVersion = output.serverVersion ?? run.serverVersion;
            if (bounded.truncated)
                run.warnings.push(
                    'Output is truncated; charts and local filters describe only the retained rows.',
                );
            const expiresAt = new Date(
                Date.now() + (this.options.retentionMs ?? 86400000),
            ).toISOString();
            const result: Result = {
                runId: id,
                queryId: run.queryId,
                columns: bounded.columns,
                rows: bounded.rows,
                completeness: bounded.truncated ? 'truncated' : 'complete',
                createdAt: new Date().toISOString(),
                expiresAt,
            };
            this.store.put('results', id, result);
            run.resultExpiresAt = expiresAt;
            run.resultState = 'reopenable';
        } catch (error) {
            const e = asError(error);
            run.error = e;
            run.resultState = 'unavailable';
            const getFailedRunStatus = () => {
                switch (e.code) {
                    case 'CANCELLED':
                        return 'cancelled';

                    case 'DEADLINE_EXCEEDED':
                        return 'timed_out';

                    default:
                        return 'failed';
                }
            };
            run.status = getFailedRunStatus();
            audit(this.store, principal, 'run.finish', id, 'failed', e.code);
        } finally {
            if (timeout) clearTimeout(timeout);
            removeAbort();
            this.controllers.delete(id);
            run.elapsedMs = Math.round(performance.now() - start);
            run.finishedAt = new Date().toISOString();
            // Preserve warnings that a cancellation callback may have appended to persisted state.
            const saved = this.store.get<Run>('runs', id);
            run.warnings = [...new Set([...run.warnings, ...(saved?.warnings ?? [])])];
            this.emit(run);
            this.sweepResultSnapshots();
        }
    }
    sweep(now = Date.now()) {
        this.sweepResultSnapshots(now);
        this.sweepRetainedHistory(now);
    }
    private sweepResultSnapshots(now = Date.now()) {
        const runs = this.store.list<Run>('runs');
        const retained: {
            run: Run;
            bytes: number;
        }[] = [];
        for (const run of runs) {
            if (run.resultState !== 'reopenable') continue;
            if (!run.resultExpiresAt || Date.parse(run.resultExpiresAt) <= now) {
                this.store.delete('results', run.id);
                run.resultState = 'expired';
                this.emit(run);
            } else retained.push({ run, bytes: run.bytes });
        }
        let total = retained.reduce((n, r) => n + r.bytes, 0);
        for (const { run, bytes } of retained.sort((a, b) =>
            a.run.createdAt.localeCompare(b.run.createdAt),
        )) {
            if (total <= (this.options.snapshotBytes ?? 50000000)) break;
            this.store.delete('results', run.id);
            run.resultState = 'expired';
            this.emit(run);
            total -= bytes;
        }
    }
    private sweepRetainedHistory(now: number) {
        const scriptCutoff = now - (this.options.scriptRetentionMs ?? DEFAULT_SCRIPT_RETENTION_MS);
        const expiredScriptIds = new Set<string>();
        for (const script of this.store.list<Script>('scripts')) {
            if (script.status === 'running' || Date.parse(script.createdAt) > scriptCutoff)
                continue;
            this.store.delete('scripts', script.id);
            expiredScriptIds.add(script.id);
        }
        const liveResourceIds = new Set([
            ...this.store.list<Run>('runs').map(run => run.id),
            ...this.store.list<Script>('scripts').map(script => script.id),
        ]);
        const receiptCutoff =
            now - (this.options.receiptRetentionMs ?? DEFAULT_RECEIPT_RETENTION_MS);
        for (const key of this.store.keys('receipts')) {
            const receipt = this.store.get<Receipt>('receipts', key);
            if (!receipt) continue;
            if (receipt.kind === 'script' && expiredScriptIds.has(receipt.resourceId)) {
                this.store.delete('receipts', key);
                continue;
            }
            if (!liveResourceIds.has(receipt.resourceId) && Date.parse(receipt.at) <= receiptCutoff)
                this.store.delete('receipts', key);
        }
    }
    submitScript(principal: Principal, input: unknown, stopOnError = true): Script {
        requireThat(!this.closed, 503, 'SHUTTING_DOWN', 'The server is shutting down');
        const request = runRequest(input),
            statements = splitSql(request.sql);
        requireThat(
            statements.length > 0 && statements.length <= MAX_SCRIPT_STATEMENTS,
            400,
            'SCRIPT_SIZE',
            `A script must contain 1–${MAX_SCRIPT_STATEMENTS} statements`,
        );
        requireThat(
            !request.kind || request.kind === 'query',
            400,
            'SCRIPT_KIND',
            'Explain one statement at a time',
        );
        for (const statement of statements)
            this.authorize(principal, { ...request, sql: statement.sql });
        const payload = { request, stopOnError },
            old = this.receipt(principal, request.clientRequestId, payload, 'script');
        if (old) return this.getScript(principal, old.resourceId);
        if (this.store.count('scripts') >= 200) {
            this.sweep();
            requireThat(
                this.store.count('scripts') < 200,
                507,
                'SCRIPT_CAPACITY',
                'Script history needs operator maintenance',
            );
        }
        requireThat(
            this.store.list<Script>('scripts').filter(s => s.status === 'running').length < 4,
            429,
            'SCRIPT_LIMIT',
            'At most four scripts can be active',
        );
        const id = randomUUID();
        const script: Script = {
            id,
            owner: principal.id,
            connectionId: request.connectionId,
            sql: request.sql,
            createdAt: new Date().toISOString(),
            status: 'running',
            stopOnError,
            cancelled: false,
            statements: statements.map(s => ({ ...s, status: 'pending' })),
        };
        this.store.put('scripts', id, script);
        const receiptId = hash([principal.id, request.clientRequestId]);
        this.store.put<Receipt>('receipts', receiptId, {
            id: receiptId,
            fingerprint: hash(payload),
            resourceId: id,
            kind: 'script',
            at: script.createdAt,
        });
        void this.executeScript(principal, request, script).catch(() => {
            this.closed = true;
            process.exitCode = 1;
            console.error('Script persistence failed; new execution is disabled.');
        });
        return script;
    }
    getScript(principal: Principal, id: string): Script {
        const script = this.store.get<Script>('scripts', id);
        requireThat(script, 404, 'NOT_FOUND', 'Script not found');
        mustOwn(principal, script.owner);
        this.connection(principal, script.connectionId);
        return script;
    }
    async cancelScript(principal: Principal, id: string): Promise<Script> {
        canWrite(principal);
        const script = this.getScript(principal, id);
        if (script.status !== 'running') return script;
        script.cancelled = true;
        this.store.put('scripts', id, script);
        for (const s of script.statements)
            if (s.runId && (s.status === 'running' || s.status === 'queued'))
                await this.cancel(principal, s.runId);
        return this.getScript(principal, id);
    }
    private async executeScript(principal: Principal, request: RunRequest, initial: Script) {
        let failed = false;
        for (let index = 0; index < initial.statements.length; index++) {
            let script = this.getScript(principal, initial.id),
                statement = script.statements[index]!;
            if (script.cancelled || (failed && script.stopOnError) || this.closed) {
                statement.status = 'skipped';
                this.store.put('scripts', script.id, script);
                continue;
            }
            try {
                const run = this.submit(principal, {
                    ...request,
                    sql: statement.sql,
                    clientRequestId: `${script.id}-${index}`,
                    sourceFrom: statement.from,
                    sourceTo: statement.to,
                });
                statement.runId = run.id;
                statement.status = 'running';
                this.store.put('scripts', script.id, script);
                const done = await this.wait(principal, run.id);
                script = this.getScript(principal, initial.id);
                statement = script.statements[index]!;
                statement.status = done.status;
                if (done.status !== 'succeeded' && done.status !== 'truncated') failed = true;
                this.store.put('scripts', script.id, script);
            } catch {
                script = this.getScript(principal, initial.id);
                script.statements[index]!.status = 'failed';
                failed = true;
                this.store.put('scripts', script.id, script);
            }
        }
        const script = this.getScript(principal, initial.id);
        const successes = script.statements.filter(
            s => s.status === 'succeeded' || s.status === 'truncated',
        ).length;
        const getScriptStatus = () => {
            if (script.cancelled) {
                return 'cancelled';
            }

            if (failed) {
                if (successes) {
                    return 'partial';
                }

                return 'failed';
            }

            return 'succeeded';
        };
        script.status = getScriptStatus();
        this.store.put('scripts', script.id, script);
    }
    async close() {
        this.closed = true;
        for (const run of this.store.list<Run>('runs'))
            if (!terminal(run)) await this.cancel({ id: run.owner, role: 'owner' }, run.id);
    }
}
export function boundResult(output: DriverResult, limit: Limits) {
    if (output.bounded?.rows === limit.rows && output.bounded.bytes === limit.bytes) {
        requireThat(
            output.bytes !== undefined && output.bytes <= limit.bytes,
            502,
            'INVALID_RESULT',
            'The server returned an invalid bounded result',
        );
        return {
            columns: output.columns,
            rows: output.rows,
            bytes: output.bytes,
            truncated: output.truncated,
        };
    }
    requireThat(
        output.columns.length <= 500,
        413,
        'TOO_MANY_COLUMNS',
        'The result exceeds the 500-column display limit',
    );
    const rows: Row[] = [];
    let bytes = Buffer.byteLength(JSON.stringify(output.columns)),
        truncated = output.truncated;
    requireThat(
        bytes <= limit.bytes,
        413,
        'METADATA_TOO_LARGE',
        'Column metadata exceeds the output byte limit',
    );
    for (const row of output.rows) {
        requireThat(
            Array.isArray(row) && row.length === output.columns.length,
            502,
            'INVALID_RESULT',
            'The server returned an invalid row shape',
        );
        const size = Buffer.byteLength(JSON.stringify(row));
        if (rows.length >= limit.rows || bytes + size > limit.bytes) {
            truncated = true;
            break;
        }
        rows.push(row);
        bytes += size;
    }
    return { columns: output.columns, rows, bytes, truncated };
}
