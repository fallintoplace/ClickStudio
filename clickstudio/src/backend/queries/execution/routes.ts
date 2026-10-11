import { DEFAULT_RESULT_PAGE_ROWS } from '../../../shared/queries/execution/limits.js';
import express from 'express';
import type { Principal } from '../../../shared/common/identity.js';
import { RunService, terminal } from './runs.js';
import { SessionService } from '../../system/login/sessions.js';
import { type Store } from '../../system/storage/store.js';
import { requireThat } from '../../system/requests/errors.js';
import { exportCsv } from '../../../shared/queries/results/results.js';
import { buildQueryProfile } from '../../../shared/queries/inspection/profile.js';
import { type Config } from '../../system/settings/config.js';
import { recordRun } from '../../system/logging/telemetry.js';
import type { Driver } from '../../app/types.js';
import { principal, id, number, body, boolean } from '../../system/requests/http.js';

export function registerRunRoutes({
    app,
    runs,
    store,
    sessions,
    safeExport,
    authorized,
    driver,
    config,
}: {
    app: ReturnType<typeof express>;
    runs: RunService;
    store: Store;
    sessions: SessionService;
    safeExport: (value: unknown) => void;
    authorized: (p: Principal, c: string) => boolean;
    driver: Driver;
    config: Config;
}) {
    app.get('/api/runs', (req, res) =>
        res.json(
            runs.list(
                principal(res),
                typeof req.query.connectionId === 'string' ? req.query.connectionId : undefined,
                typeof req.query.documentId === 'string' ? req.query.documentId : undefined,
            ),
        ),
    );
    app.post('/api/runs', (req, res) => {
        const run = runs.submit(principal(res), req.body);
        if (!run.traceId && res.locals.traceId) {
            run.traceId = String(res.locals.traceId);
            store.put('runs', run.id, run);
        }
        recordRun(run.id, run.queryId, run.connectionId);
        res.status(202).json(run);
    });
    app.get('/api/runs/:id', (req, res) => res.json(runs.get(principal(res), id(req))));
    app.get('/api/runs/:id/events', (req, res) => {
        const p = principal(res),
            runId = id(req);
        runs.get(p, runId);
        res.status(200).set({
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
        });
        res.flushHeaders();
        let unsubscribe: () => void = () => {},
            ended = false;
        let heartbeat: ReturnType<typeof setInterval> | undefined;
        const finish = () => {
            if (ended) return;
            ended = true;
            if (heartbeat) clearInterval(heartbeat);
            unsubscribe();
            res.end();
        };
        req.once('close', finish);
        unsubscribe = runs.subscribe(p, runId, event => {
            if (ended) return;
            if (!sessions.principal(req.get('cookie'))) {
                finish();
                return;
            }
            const accepted = res.write(`id: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`);
            if (!accepted || terminal(event.run)) setImmediate(finish);
        });
        heartbeat = setInterval(() => {
            if (!sessions.principal(req.get('cookie')) || !res.write(': keepalive\n\n')) finish();
        }, 15000);
    });
    app.get('/api/runs/:id/result', (req, res) =>
        res.json(
            runs.page(
                principal(res),
                id(req),
                number(req.query.offset, 0),
                number(req.query.count, DEFAULT_RESULT_PAGE_ROWS),
            ),
        ),
    );
    app.get('/api/runs/:id/snapshot', (req, res) => res.json(runs.result(principal(res), id(req))));
    app.get('/api/runs/:id/export', (req, res) => {
        const p = principal(res),
            run = runs.get(p, id(req)),
            result = runs.result(p, run.id);
        safeExport({ run, result });
        res.attachment(`${run.queryId}.${req.query.format === 'csv' ? 'csv' : 'json'}`);
        if (req.query.format === 'csv') res.type('text/csv').send(exportCsv(result));
        else res.json({ format: 'clickstudio-evidence', version: 1, run, result });
    });
    app.post('/api/runs/:id/cancel', async (req, res) =>
        res.json(await runs.cancel(principal(res), id(req))),
    );
    app.delete('/api/runs/:id', (req, res) => {
        runs.remove(principal(res), id(req));
        res.json({ ok: true });
    });
    app.get('/api/runs/:id/profile', async (req, res) => {
        const run = runs.get(principal(res), id(req));
        requireThat(
            authorized(principal(res), run.connectionId),
            403,
            'WORKSPACE_UNTRUSTED',
            'Trust this connection before inspecting live query-log evidence',
        );
        const evidence = await driver.profileEvidence(run);
        const connection = driver.connection(principal(res), run.connectionId);
        let traceUrl: string | undefined;
        if (config.traceUrl && run.traceId) {
            const url = new URL(
                config.traceUrl.replace('{traceId}', encodeURIComponent(run.traceId)),
            );
            if (['http:', 'https:'].includes(url.protocol)) traceUrl = url.toString();
        }
        res.json(
            buildQueryProfile(run, evidence, {
                queryLogAvailable: true,
                pipelineAvailable: Boolean(connection.manifest?.pipeline.available),
                traceUrl,
                notice: 'Query-log rows may arrive after a server flush interval. This is server evidence, not an operator-level performance model.',
            }),
        );
    });
    app.get('/api/runs/:id/profile/flamegraph', async (req, res) => {
        const p = principal(res),
            run = runs.get(p, id(req));
        requireThat(
            authorized(p, run.connectionId),
            403,
            'WORKSPACE_UNTRUSTED',
            'Trust this connection before inspecting query profiler samples',
        );
        requireThat(
            terminal(run),
            409,
            'RUN_IN_PROGRESS',
            'Wait for the query to finish before loading its flamegraph',
        );
        const capability = driver.connection(p, run.connectionId).manifest?.traceLog;
        requireThat(
            capability?.available === true,
            409,
            'CAPABILITY_UNAVAILABLE',
            capability?.reason ?? 'ClickHouse trace-log symbols are unavailable on this connection',
        );
        res.json(await driver.profileFlamegraph(run));
    });
    app.get('/api/runs/:id/profile/pipeline', async (req, res) => {
        const p = principal(res),
            run = runs.get(p, id(req));
        requireThat(
            authorized(p, run.connectionId),
            403,
            'WORKSPACE_UNTRUSTED',
            'Trust this connection before inspecting live pipeline evidence',
        );
        const connection = driver.connection(p, run.connectionId);
        requireThat(
            Boolean(connection.manifest?.pipeline.available),
            409,
            'CAPABILITY_UNAVAILABLE',
            'EXPLAIN PIPELINE is unavailable on this connection',
        );
        const queryLogAvailable = Boolean(connection.manifest?.queryLog.available);
        const evidence = queryLogAvailable ? await driver.profileEvidence(run).catch(() => []) : [];
        const pipelineEvidence = await driver.profilePipeline(run);
        let traceUrl: string | undefined;
        if (config.traceUrl && run.traceId) {
            const url = new URL(
                config.traceUrl.replace('{traceId}', encodeURIComponent(run.traceId)),
            );
            if (['http:', 'https:'].includes(url.protocol)) traceUrl = url.toString();
        }
        const profile = buildQueryProfile(run, evidence, {
            queryLogAvailable,
            pipelineAvailable: true,
            pipelineEvidence,
            traceUrl,
            notice: queryLogAvailable
                ? 'Query-log rows may arrive after a server flush interval. This is server evidence, not an operator-level performance model.'
                : 'Query-log access is unavailable. The graph uses ClickHouse pipeline evidence and retained run metrics.',
        });
        res.json(profile.pipeline);
    });
    app.post('/api/scripts', (req, res) => {
        const v = body(req);
        res.status(202).json(
            runs.submitScript(
                principal(res),
                v,
                v.stopOnError === undefined ? true : boolean(v.stopOnError, 'stopOnError'),
            ),
        );
    });
    app.get('/api/scripts/:id', (req, res) => res.json(runs.getScript(principal(res), id(req))));
    app.post('/api/scripts/:id/cancel', async (req, res) =>
        res.json(await runs.cancelScript(principal(res), id(req))),
    );
}
