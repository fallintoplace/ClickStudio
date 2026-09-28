import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../server/app.js';
import { loadConfig } from '../../server/config.js';
import { MemoryStore } from '../../core/store.js';
import { DemoDriver } from '../../server/demo.js';
import type { VoiceService } from '../../server/voice.js';
import type { ImportJob } from '../../core/imports.js';
import type { CreateTableColumn } from '../../core/table-creation.js';
import type { ClickHouseDocumentationEntry, ClickHouseDocumentationSummary, QueryDocument, ReferenceCategory, Run, Published } from '../../shared/types.js';
async function start(token?: string, voice?: VoiceService, parserWasm?: () => Promise<Uint8Array>, driver = new DemoDriver()) {
    const config = loadConfig({ DEMO_MODE: 'true', CLICKSTUDIO_TOKEN: token });
    const service = createApp(config, { store: new MemoryStore(), driver, voice, parserWasm });
    const server = service.app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    config.port = (server.address() as AddressInfo).port;
    config.origin = `http://127.0.0.1:${config.port}`;
    const call = (path: string, body?: unknown, headers: Record<string, string> = {}, method = body === undefined ? 'GET' : 'POST') => fetch(config.origin + '/api' + path, { method, headers: { 'content-type': 'application/json', 'x-clickstudio-intent': '1', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { ...service, call, origin: config.origin, stop: async () => { await service.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}
const owner = { id: 'local-owner', role: 'owner' } as const;
class NoQueryLogDemoDriver extends DemoDriver {
    evidenceCalls = 0;
    override connection(principal: Parameters<DemoDriver['connection']>[0], id: string) {
        const connection = super.connection(principal, id);
        return { ...connection, manifest: { ...connection.manifest!, queryLog: { available: false, reason: 'Disabled for this test' } } };
    }
    override async profileEvidence(_run: Run) {
        this.evidenceCalls++;
        throw new Error('Query-log evidence must not be required for pipeline inspection');
    }
}
class MissingObservabilityDemoDriver extends DemoDriver {
    override connection(principal: Parameters<DemoDriver['connection']>[0], id: string) {
        const connection = super.connection(principal, id);
        return { ...connection, manifest: { ...connection.manifest!, queryLog: { available: false, reason: 'Disabled for this test' }, traceLog: { available: false, reason: 'Disabled for this test' }, replication: { available: false, reason: 'Disabled for this test' } } };
    }
}
class ReferenceDocsDemoDriver extends DemoDriver {
    readonly searches: Array<{ id: string; query: string; category: ReferenceCategory }> = [];
    readonly entries: Array<{ id: string; name: string; type: string }> = [];
    override connection(principal: Parameters<DemoDriver['connection']>[0], id: string) {
        const connection = super.connection(principal, id);
        return { ...connection, manifest: { ...connection.manifest!, documentation: { available: true } } };
    }
    override async searchDocumentation(id: string, query: string, category: ReferenceCategory): Promise<ClickHouseDocumentationSummary[]> {
        this.searches.push({ id, query, category });
        return [{ name: 'MergeTree', type: 'Table Engine', source: 'system.documentation' }];
    }
    override async documentationEntry(id: string, name: string, type: string): Promise<ClickHouseDocumentationEntry | undefined> {
        this.entries.push({ id, name, type });
        return { name, type, source: 'system.documentation', description: '# Native docs', serverVersion: '24.6-test', origin: 'native' };
    }
}

class TableCreationDemoDriver extends DemoDriver {
    readonly createdTables: Array<{ id: string; table: string; columns: CreateTableColumn[]; orderBy: string; queryId: string }> = [];
    override createTargets(_id: string) { return ['demo.new_events']; }
    override async createTable(id: string, table: string, columns: CreateTableColumn[], orderBy: string, queryId: string) {
        this.createdTables.push({ id, table, columns, orderBy, queryId });
    }
}

test('Table creation needs trust, an exact target, and an exact confirmation', async (t) => {
    const driver = new TableCreationDemoDriver(), s = await start(undefined, undefined, undefined, driver);
    t.after(() => s.stop());
    assert.deepEqual(await (await s.call('/connections/demo/create-table-targets')).json(), ['demo.new_events']);
    const request = { table: 'demo.new_events', columns: [{ name: 'id', type: 'UInt64' }], orderBy: 'id', confirmation: 'CREATE TABLE demo.new_events' };
    assert.equal((await s.call('/connections/demo/tables', request)).status, 403);
    await s.call('/connections/demo/trust', { trusted: true, confirmation: 'demo' });
    assert.equal((await s.call('/connections/demo/tables', { ...request, confirmation: 'yes' })).status, 400);
    assert.equal((await s.call('/connections/demo/tables', { ...request, columns: [{ name: 'id); DROP TABLE x', type: 'UInt64' }] })).status, 400);
    assert.equal((await s.call('/connections/demo/tables', { ...request, columns: [{ name: 'id', type: 'String); DROP TABLE x' }] })).status, 400);
    const response = await s.call('/connections/demo/tables', request);
    assert.equal(response.status, 201);
    assert.equal(driver.createdTables.length, 1);
    assert.deepEqual(driver.createdTables[0], { id: 'demo', table: 'demo.new_events', columns: request.columns, orderBy: 'id', queryId: driver.createdTables[0].queryId });
    assert.match(driver.createdTables[0].queryId, /^clickstudio-create-table-/);
});

test('Reference routes require trust, validate bounded filters, and preserve entry type identity', async (t) => {
    const driver = new ReferenceDocsDemoDriver(), s = await start(undefined, undefined, undefined, driver);
    t.after(() => s.stop());
    assert.equal((await s.call('/connections/demo/documentation/search')).status, 403);
    assert.equal(driver.searches.length, 0);
    await s.call('/connections/demo/trust', { trusted: true, confirmation: 'demo' });

    assert.equal((await s.call('/connections/demo/documentation/search?category=unknown')).status, 400);
    assert.equal((await s.call(`/connections/demo/documentation/search?${new URLSearchParams({ query: 'x'.repeat(129) })}`)).status, 400);
    assert.equal((await s.call('/connections/demo/documentation/search?category=all&category=engines')).status, 400);
    assert.equal(driver.searches.length, 0);

    const searchText = "%' OR 1 = 1 --";
    const search = await s.call(`/connections/demo/documentation/search?${new URLSearchParams({ query: searchText, category: 'engines' })}`);
    assert.equal(search.status, 200);
    assert.deepEqual(await search.json(), [{ name: 'MergeTree', type: 'Table Engine', source: 'system.documentation' }]);
    assert.deepEqual(driver.searches, [{ id: 'demo', query: searchText, category: 'engines' }]);

    assert.equal((await s.call('/connections/demo/documentation/entry?name=MergeTree')).status, 400);
    const entry = await s.call(`/connections/demo/documentation/entry?${new URLSearchParams({ name: 'MergeTree', type: 'Table Engine' })}`);
    assert.equal(entry.status, 200);
    assert.deepEqual(await entry.json(), { name: 'MergeTree', type: 'Table Engine', source: 'system.documentation', description: '# Native docs', serverVersion: '24.6-test', origin: 'native' });

    const legacy = await s.call('/connections/demo/documentation?name=query_log');
    assert.equal(legacy.status, 200);
    assert.deepEqual(driver.entries.slice(-2), [
        { id: 'demo', name: 'MergeTree', type: 'Table Engine' },
        { id: 'demo', name: 'query_log', type: 'System Table' },
    ]);
});

test('Reference routes report unavailable native documentation instead of returning empty results', async (t) => {
    const s = await start();
    t.after(() => s.stop());
    await s.call('/connections/demo/trust', { trusted: true, confirmation: 'demo' });
    const response = await s.call('/connections/demo/documentation/search');
    assert.equal(response.status, 409);
    assert.equal((await response.json() as { error: { code: string } }).error.code, 'CAPABILITY_UNAVAILABLE');
});

test('Assistant context includes relevant native ClickHouse documentation before consent', async (t) => {
    const driver = new ReferenceDocsDemoDriver(), s = await start(undefined, undefined, undefined, driver);
    t.after(() => s.stop());
    await s.call('/connections/demo/trust', { trusted: true, confirmation: 'demo' });

    const response = await s.call('/assistant/context', {
        connectionId: 'demo', action: 'explain', question: 'Explain quantileExact',
        sql: 'SELECT quantileExact(0.5)(latency_ms) FROM events',
    });
    assert.equal(response.status, 201);
    const prepared = await response.json() as { payload: { context: string }; summary: string[] };
    const context = JSON.parse(prepared.payload.context) as { referenceDocs: Array<{ name: string; origin: string; serverVersion: string }> };
    assert.ok(driver.entries.some(entry => entry.name === 'quantileExact' && entry.type === 'Aggregate Function'));
    assert.equal(context.referenceDocs[0]?.name, 'quantileExact');
    assert.equal(context.referenceDocs[0]?.origin, 'native');
    assert.ok(prepared.summary.some(item => item.includes('server 24.6-test')));
});

test('Assistant context falls back to the bundled ClickHouse documentation', async (t) => {
    const s = await start();
    t.after(() => s.stop());
    await s.call('/connections/demo/trust', { trusted: true, confirmation: 'demo' });

    const response = await s.call('/assistant/context', {
        connectionId: 'demo', action: 'explain', question: 'Explain quantileExact',
        sql: 'SELECT quantileExact(0.5)(latency_ms) FROM events',
    });
    assert.equal(response.status, 201);
    const prepared = await response.json() as { payload: { context: string }; summary: string[] };
    const context = JSON.parse(prepared.payload.context) as { referenceDocs: Array<{ name: string; origin: string; serverVersion: string }> };
    assert.equal(context.referenceDocs[0]?.name, 'quantileExact');
    assert.equal(context.referenceDocs[0]?.origin, 'bundled');
    assert.match(context.referenceDocs[0]?.serverVersion ?? '', /^(?:Offline docs |Demo catalog)/);
});

test('Voice sessions require trust and keep the provider behind the server', async (t) => {
    const calls: unknown[] = [];
    const s = await start(undefined, { available: true, model: 'test-voice', createSession: async input => { calls.push(input); return { sdp: 'answer-sdp', model: 'test-voice' }; } });
    t.after(() => s.stop());
    assert.equal((await s.call('/voice/status')).status, 200);
    assert.equal((await s.call('/voice/session', { connectionId: 'demo', sdp: 'offer-sdp', context: 'SELECT 1' })).status, 403);
    await s.call('/connections/demo/trust', { trusted: true, confirmation: 'demo' });
    const response = await s.call('/voice/session', { connectionId: 'demo', sdp: 'offer-sdp', context: 'SELECT 1' });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { sdp: 'answer-sdp', model: 'test-voice' });
    assert.equal((calls[0] as { safetyIdentifier: string }).safetyIdentifier.length, 64);
});
test('HTTP query flow requires explicit trust and is idempotent', async (t) => {
    const s = await start();
    t.after(() => s.stop());
    const input = { clientRequestId: randomUUID(), connectionId: 'demo', sql: 'SELECT 1' };
    assert.equal((await s.call('/runs', input)).status, 403);
    assert.equal((await s.call('/connections/demo/trust', { trusted: true, confirmation: 'demo' })).status, 200);
    const a = await s.call('/runs', input);
    assert.equal(a.status, 202);
    const run = await a.json() as Run;
    const duplicate = await (await s.call('/runs', input)).json() as Run;
    assert.equal(duplicate.id, run.id);
    await s.runs.wait(owner, run.id);
    const page = await s.call(`/runs/${run.id}/result?offset=0&count=2`);
    assert.equal(page.status, 200);
    assert.equal((await page.json()).rows.length, 2);
    const event = await s.call(`/runs/${run.id}/events`);
    const text = await event.text();
    assert.match(text, /data: /);
    assert.match(text, /succeeded/);
});
test('Pipeline inspection works when query-log evidence is unavailable', async (t) => {
    const driver = new NoQueryLogDemoDriver(), s = await start(undefined, undefined, undefined, driver);
    t.after(() => s.stop());
    await s.call('/connections/demo/trust', { trusted: true, confirmation: 'demo' });
    const run = await (await s.call('/runs', { clientRequestId: randomUUID(), connectionId: 'demo', sql: 'SELECT number FROM numbers(4)' })).json() as Run;
    await s.runs.wait(owner, run.id);
    const response = await s.call(`/runs/${run.id}/profile/pipeline`);
    assert.equal(response.status, 200);
    const pipeline = await response.json();
    assert.equal(pipeline.source, 'explain_pipeline');
    assert.equal(driver.evidenceCalls, 0);
});
test('Observability routes require trust, validate windows, and return scoped fixture evidence', async (t) => {
    const s = await start();
    t.after(() => s.stop());
    assert.equal((await s.call('/connections/demo/workload')).status, 403);
    assert.equal((await s.call('/connections/demo/replication')).status, 403);
    await s.call('/connections/demo/trust', { trusted: true, confirmation: 'demo' });
    assert.equal((await s.call('/connections/demo/workload?minutes=30')).status, 400);
    assert.equal((await s.call('/connections/demo/workload?minutes=60&minutes=15')).status, 400);

    const workloadResponse = await s.call('/connections/demo/workload?minutes=15');
    assert.equal(workloadResponse.status, 200);
    const workload = await workloadResponse.json();
    assert.equal(workload.scope, 'local-user');
    assert.equal(workload.minutes, 15);
    assert.ok(workload.families.length > 0);
    assert.ok(workload.points.every((point: { queryId: string }) => point.queryId.length > 0));

    const replicationResponse = await s.call('/connections/demo/replication');
    assert.equal(replicationResponse.status, 200);
    const replication = await replicationResponse.json();
    assert.equal(replication.scope, 'local-node');
    assert.ok(replication.replicas.every((replica: { database: string }) => replica.database === 'demo'));
    assert.ok(replication.queue.length > 0);
});
test('Observability routes honor manifest capabilities and keep flamegraphs scoped to completed runs', async (t) => {
    const driver = new MissingObservabilityDemoDriver(), s = await start(undefined, undefined, undefined, driver);
    t.after(() => s.stop());
    await s.call('/connections/demo/trust', { trusted: true, confirmation: 'demo' });
    assert.equal((await s.call('/connections/demo/workload')).status, 409);
    assert.equal((await s.call('/connections/demo/replication')).status, 409);

    const run = await (await s.call('/runs', { clientRequestId: randomUUID(), connectionId: 'demo', sql: 'SELECT 1' })).json() as Run;
    await s.runs.wait(owner, run.id);
    assert.equal((await s.call(`/runs/${run.id}/profile/flamegraph`)).status, 409);
});
test('Completed demo runs expose one bounded flamegraph with CPU and wall-clock evidence', async (t) => {
    const s = await start();
    t.after(() => s.stop());
    await s.call('/connections/demo/trust', { trusted: true, confirmation: 'demo' });
    const run = await (await s.call('/runs', { clientRequestId: randomUUID(), connectionId: 'demo', sql: 'SELECT 1' })).json() as Run;
    await s.runs.wait(owner, run.id);
    const response = await s.call(`/runs/${run.id}/profile/flamegraph`);
    assert.equal(response.status, 200);
    const flamegraph = await response.json();
    assert.equal(flamegraph.queryId, run.queryId);
    assert.ok(flamegraph.series.CPU.samples > 0);
    assert.ok(flamegraph.series.Real.samples > 0);
    assert.ok(flamegraph.symbolizedSamples <= flamegraph.samples.CPU + flamegraph.samples.Real);
});
test('Native ClickHouse parser bytes are served same-origin behind the session boundary', async (t) => {
    const fixture = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
    const s = await start(undefined, undefined, async () => fixture);
    t.after(() => s.stop());
    const response = await s.call('/editor/clickhouse-parser.wasm');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /^application\/wasm/);
    assert.match(response.headers.get('cache-control') ?? '', /private/);
    assert.match(response.headers.get('content-security-policy') ?? '', /script-src 'self' 'wasm-unsafe-eval'/);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), fixture);
});
test('Vendored ClickHouse parser artifact is served without a remote fetch', async (t) => {
    const s = await start();
    t.after(() => s.stop());
    const response = await s.call('/editor/clickhouse-parser.wasm');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /^application\/wasm/);
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.ok(bytes.length >= 8 && bytes.length <= 64 * 1024 * 1024);
    assert.deepEqual([...bytes.slice(0, 8)], [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
});
test('Assistant evaluation report is available without a provider and keeps SQL out of the summary', async (t) => {
    const s = await start();
    t.after(() => s.stop());
    const response = await s.call('/assistant/evaluation');
    assert.equal(response.status, 200);
    const report = await response.json() as { total: number; benchmark: { total: number; passed: number; score: number; mode: string }; latest: unknown[] };
    assert.equal(report.total, 0);
    assert.deepEqual(report.benchmark, { total: 5, passed: 5, score: 100, mode: 'static' });
    assert.deepEqual(report.latest, []);
});
test('Cookie login and request intent are enforced', async (t) => {
    const token = 'owner-token-'.repeat(4), s = await start(token);
    t.after(() => s.stop());
    assert.equal((await s.call('/connections')).status, 401);
    assert.equal((await s.call('/session', { token }, { 'x-clickstudio-intent': '' })).status, 403);
    assert.equal((await s.call('/session', { token: 'wrong' })).status, 401);
    const login = await s.call('/session', { token });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
    assert.match(cookie, /^clickstudio_session=/);
    assert.equal((await s.call('/connections', undefined, { cookie })).status, 200);
    assert.equal((await s.call('/session', {}, { cookie }, 'DELETE')).status, 200);
    assert.equal((await s.call('/connections', undefined, { cookie })).status, 401);
});
test('Workspace bootstrap and actions work when browser origin differs from configuration', async (t) => {
    const s = await start();
    t.after(() => s.stop());
    const headers = { host: 'clickstudio.invalid', origin: 'https://clickstudio.invalid' };
    assert.equal((await s.call('/session', undefined, headers)).status, 200);
    assert.equal((await s.call('/connections', undefined, headers)).status, 200);
    assert.equal((await s.call('/connections/demo/trust', { trusted: true, confirmation: 'demo' }, headers)).status, 200);
});
test('Sharing exposes an immutable snapshot, not an execution credential', async (t) => {
    const s = await start();
    t.after(() => s.stop());
    await s.call('/connections/demo/trust', { trusted: true, confirmation: 'demo' });
    const run = await (await s.call('/runs', { clientRequestId: randomUUID(), connectionId: 'demo', sql: 'SELECT 1' })).json() as Run;
    await s.runs.wait(owner, run.id);
    const doc = await (await s.call('/documents', { name: 'Evidence.sql', connectionId: 'demo', sql: 'SELECT 1', runId: run.id })).json() as QueryDocument;
    const pub = await (await s.call(`/documents/${doc.id}/publish`, { revision: 1 })).json() as Published;
    assert.equal((await s.call(`/published/${pub.id}/share`, {})).status, 400);
    const share = await (await s.call(`/published/${pub.id}/share`, { acknowledgeShare: true })).json();
    await s.call(`/documents/${doc.id}`, { ...doc, baseRevision: 1, sql: 'SELECT 2' }, {}, 'PUT');
    const snapshot = await (await s.call(`/shared/${share.token}`)).json() as Published;
    assert.equal(snapshot.document.sql, 'SELECT 1');
    assert.equal((await s.call('/runs', { clientRequestId: randomUUID(), connectionId: 'unrecognized', sql: 'SELECT 1' })).status, 404);
});
test('Invalid workspace import is rejected without partially saving documents', async (t) => {
    const s = await start();
    t.after(() => s.stop());
    const input = { format: 'clickstudio-workspace', version: 1, documents: [{ name: 'ok.sql', connectionId: 'demo', sql: 'SELECT 1' }, { name: 'bad.sql', connectionId: 'demo', sql: 7 }] };
    assert.equal((await s.call('/workspace/import', input)).status, 400);
    assert.deepEqual(await (await s.call('/documents')).json(), []);
});
test('Recoverable import endpoints expose only owned unresolved jobs and keep ambiguous writes blocked', async (t) => {
    const s = await start();
    t.after(() => s.stop());
    const makeJob = (id: string, jobOwner: string, reviewedAt?: string): ImportJob => ({ id, owner: jobOwner, inputId: `input-${id}`, connectionId: 'demo', table: 'demo.events', queryId: `query-${id}`, rows: 2, createdAt: '2026-09-23T00:00:00.000Z', status: 'unknown', reconciliationRequired: true, reviewedAt });
    s.store.put('imports', 'open-job', makeJob('open-job', owner.id));
    s.store.put('imports', 'other-owner-job', makeJob('other-owner-job', 'other-owner'));
    s.store.put('imports', 'reviewed-job', makeJob('reviewed-job', owner.id, '2026-09-23T00:01:00.000Z'));

    const listed = await s.call('/imports?connectionId=demo&recoverable=true');
    assert.equal(listed.status, 200);
    assert.deepEqual((await listed.json() as ImportJob[]).map(job => job.id), ['open-job']);
    assert.equal((await s.call('/imports?recoverable=false')).status, 400);
    assert.equal((await s.call('/imports/other-owner-job')).status, 404);

    await s.call('/connections/demo/trust', { trusted: true, confirmation: 'demo' });
    const reconciled = await s.call('/imports/open-job/reconcile', {});
    assert.equal(reconciled.status, 200);
    assert.equal((await reconciled.json() as ImportJob).status, 'unknown');
    assert.equal((await s.call('/imports/open-job/review', { inspected: false, noActiveInsert: false })).status, 400);
    assert.equal((await s.call('/imports/open-job/review', { inspected: true, noActiveInsert: false })).status, 400);
    const review = await s.call('/imports/open-job/review', { inspected: true, noActiveInsert: true });
    assert.equal(review.status, 200);
    assert.ok((await review.json() as ImportJob).reviewedAt);
    assert.deepEqual(await (await s.call('/imports?connectionId=demo&recoverable=true')).json(), []);
});
