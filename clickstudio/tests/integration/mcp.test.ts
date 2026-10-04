import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { request } from 'node:http';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { Client as LegacyClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport as LegacyTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp } from '../../server/app.js';
import { loadConfig } from '../../server/config.js';
import { DemoDriver } from '../../server/demo.js';
import { AppError } from '../../core/errors.js';
import { MemoryStore } from '../../core/store.js';
import type { ApiError, Connection, ResultPage, Run } from '../../shared/types.js';

const owner = { id: 'local-owner', role: 'owner' } as const;
type FixtureResult = Awaited<ReturnType<DemoDriver['execute']>>;
class McpFixtureDriver extends DemoDriver {
    readonly calls: Run[] = [];
    readonly cancellations: string[] = [];
    failureMessage = 'Fixture database failure';
    cancelFails = false;
    explainAvailable = true;
    result: FixtureResult = {
        columns: [{ name: 'large_id', type: 'UInt64' }, { name: 'amount', type: 'Decimal(38, 4)' }],
        rows: [['18446744073709551615', '12345678901234567890.1234']], truncated: false,
    };
    override connection(principal: Parameters<DemoDriver['connection']>[0], id: string) {
        const connection = super.connection(principal, id);
        return { ...connection, manifest: { ...connection.manifest!, explain: { available: this.explainAvailable, reason: 'EXPLAIN is unavailable for this test' } } };
    }
    override async execute(run: Run, signal: AbortSignal, progress: Parameters<DemoDriver['execute']>[2]): Promise<FixtureResult> {
        this.calls.push(structuredClone(run));
        if (run.sql.includes('mcp_slow')) await sleep(2000, undefined, { signal });
        if (run.sql.includes('mcp_error')) throw new AppError(400, 'DATABASE_ERROR', this.failureMessage, this.failureMessage);
        progress({ readRows: '1', readBytes: '100', elapsedMs: 1 });
        if (run.sql.includes('FROM system.tables')) return { columns: [{ name: 'database', type: 'String' }, { name: 'name', type: 'String' }, { name: 'engine', type: 'String' }], rows: [[run.parameters.database!, 'events', 'MergeTree']], truncated: false };
        if (run.sql.includes('FROM system.columns')) return { columns: [{ name: 'name', type: 'String' }, { name: 'type', type: 'String' }], rows: [['large_id', 'UInt64']], truncated: false };
        if (run.kind !== 'query') return { columns: [{ name: 'explain', type: 'String' }], rows: [['ReadFromMergeTree']], truncated: false };
        return structuredClone(this.result);
    }
    override async cancel(run: Run) {
        this.cancellations.push(run.id);
        if (this.cancelFails) throw new Error('Cannot confirm remote cancellation');
    }
}
interface Output {
    clientRequestId?: string;
    connections?: Array<Connection & { trusted: boolean }>;
    run?: Run;
    runId?: string;
    result?: ResultPage;
    error?: ApiError;
    cancellationRequested?: boolean;
}
async function start(t: TestContext, options: { token?: string; trusted?: boolean; secret?: string; driver?: McpFixtureDriver; protocol?: 'modern' | 'legacy' } = {}) {
    const config = loadConfig({ DEMO_MODE: 'true', CLICKSTUDIO_TOKEN: options.token });
    if (options.secret) config.profiles[0]!.password = options.secret;
    const driver = options.driver ?? new McpFixtureDriver(), store = new MemoryStore();
    const service = createApp(config, { store, driver });
    const listener = service.app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => { listener.once('listening', resolve); listener.once('error', reject); });
    config.port = (listener.address() as AddressInfo).port;
    config.origin = `http://127.0.0.1:${config.port}`;
    const client = new Client({ name: 'ClickStudio integration tests', version: '1.0.0' }, options.protocol === 'legacy' ? undefined : {
        versionNegotiation: { mode: options.protocol === 'modern' ? { pin: '2026-07-28' } : 'auto' },
    });
    const headers = options.token ? { Authorization: `Bearer ${options.token}` } : {};
    const transport = new StreamableHTTPClientTransport(new URL('/mcp', config.origin), { requestInit: { headers } });
    t.after(async () => {
        await client.close();
        await service.close();
        listener.closeAllConnections();
        await new Promise<void>(resolve => listener.close(() => resolve()));
    });
    await client.connect(transport);
    if (options.trusted !== false) service.runs.trust(owner, 'demo', true);
    const call = async (name: string, args: Record<string, unknown> = {}) => {
        const value = await client.callTool({ name, arguments: args });
        assert.ok(value.structuredContent);
        const content = value.content as Array<{ type: string; text: string }>;
        assert.equal(content[0]?.type, 'text');
        assert.deepEqual(JSON.parse(content[0]!.text), value.structuredContent);
        return { ...value, data: value.structuredContent as Output };
    };
    const completed = async (name: string, args: Record<string, unknown> = {}) => {
        const submission = await call(name, args);
        const result = submission.data.run ? await call('get_result', { runId: submission.data.run.id, waitSeconds: 3 }) : submission;
        return { ...result, submission };
    };
    const http = (method = 'POST', extraHeaders: Record<string, string> = {}, body: unknown = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) => {
        const requestHeaders = new Headers({ ...headers, 'content-type': 'application/json', accept: 'application/json, text/event-stream' });
        for (const [name, value] of Object.entries(extraHeaders)) requestHeaders.set(name, value);
        return fetch(`${config.origin}/mcp`, { method, headers: requestHeaders, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) });
    };
    return { ...service, client, transport, call, completed, http, origin: config.origin, fixture: driver };
}
const query = (extra: Record<string, unknown> = {}) => ({ connectionId: 'demo', sql: 'SELECT 1', ...extra });

test('MCP initializes, discovers seven tools, and exposes safe connection metadata', async t => {
    const s = await start(t, { token: 'workspace-token-for-mcp-integration-test', trusted: false });
    assert.equal(s.client.getProtocolEra(), 'modern');
    assert.equal(s.client.getNegotiatedProtocolVersion(), '2026-07-28');
    assert.equal(s.transport.sessionId, undefined);
    const tools = (await s.client.listTools()).tools;
    assert.deepEqual(tools.map(tool => tool.name), ['list_connections', 'execute_sql', 'list_tables', 'describe_table', 'explain_query', 'get_result', 'cancel_query']);
    assert.equal(tools.find(tool => tool.name === 'cancel_query')?.annotations?.readOnlyHint, false);
    assert.equal(tools.find(tool => tool.name === 'cancel_query')?.annotations?.destructiveHint, true);
    const response = await s.call('list_connections');
    assert.equal(response.data.connections?.[0]?.trusted, false);
    assert.equal(response.data.connections?.[0]?.readonly, true);
    assert.equal(response.data.connections?.[0]?.limits.rows, 5000);
    assert.equal(JSON.stringify(response).includes('workspace-token-for-mcp-integration-test'), false);
    assert.equal(s.fixture.calls.length, 0);
});

test('MCP serves a current client pinned to the modern protocol', async t => {
    const s = await start(t, { protocol: 'modern' });
    assert.equal(s.client.getProtocolEra(), 'modern');
    assert.equal(s.client.getNegotiatedProtocolVersion(), '2026-07-28');
    const result = await s.completed('execute_sql', query());
    assert.equal(result.submission.data.run?.status, 'queued');
    assert.equal(result.data.run?.status, 'succeeded');
    assert.equal(s.fixture.calls.length, 1);
});

test('MCP serves a current client using legacy negotiation', async t => {
    const s = await start(t, { protocol: 'legacy' });
    assert.equal(s.client.getProtocolEra(), 'legacy');
    assert.equal(s.client.getNegotiatedProtocolVersion(), '2025-11-25');
    const result = await s.completed('execute_sql', query());
    assert.equal(result.submission.data.run?.status, 'queued');
    assert.equal(result.data.run?.status, 'succeeded');
});

test('MCP remains compatible with a legacy SDK client on the same endpoint', async t => {
    const token = 'legacy-client-workspace-token', s = await start(t, { token });
    const client = new LegacyClient({ name: 'ClickStudio legacy integration tests', version: '1.0.0' });
    t.after(() => client.close());
    await client.connect(new LegacyTransport(new URL('/mcp', s.origin), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    assert.equal((await client.listTools()).tools.length, 7);
    const input = query({ clientRequestId: randomUUID() });
    const submission = (await client.callTool({ name: 'execute_sql', arguments: input })).structuredContent as Output;
    assert.equal(submission.run?.status, 'queued');
    assert.equal(submission.result, undefined);
    const result = await client.callTool({ name: 'get_result', arguments: { runId: submission.run!.id, waitSeconds: 3 } });
    assert.equal((result.structuredContent as Output).run?.status, 'succeeded');
    assert.deepEqual((result.structuredContent as Output).result?.rows, s.fixture.result.rows);
    assert.equal((await s.call('execute_sql', input)).data.run?.id, submission.run!.id);
    assert.equal(s.fixture.calls.length, 1);
});

test('MCP publishes parameter limits and reserves waiting for result requests', async t => {
    const s = await start(t), tools = (await s.client.listTools()).tools;
    for (const name of ['execute_sql', 'list_tables', 'describe_table', 'explain_query']) {
        const schema = tools.find(tool => tool.name === name)!.inputSchema;
        assert.equal(Object.hasOwn(schema.properties!, 'waitSeconds'), false);
        assert.equal(schema.additionalProperties, false);
    }
    assert.ok(tools.find(tool => tool.name === 'get_result')!.inputSchema.properties!.waitSeconds);
    for (const name of ['execute_sql', 'explain_query']) {
        const parameters = tools.find(tool => tool.name === name)!.inputSchema.properties!.parameters as {
            maxProperties: number; propertyNames: { pattern: string }; additionalProperties: { type: string; maxLength: number };
        };
        assert.equal(parameters.maxProperties, 50);
        assert.equal(parameters.additionalProperties.type, 'string');
        assert.equal(parameters.additionalProperties.maxLength, 4000);
        const key = new RegExp(parameters.propertyNames.pattern);
        for (const name of ['value', '_value', 'a'.repeat(64)]) assert.equal(key.test(name), true);
        for (const name of ['', 'bad-name', '1value', 'a'.repeat(65), '__proto__', 'constructor', 'prototype']) assert.equal(key.test(name), false);
    }
});

test('MCP uses bearer authentication independently of browser cookies', async t => {
    const s = await start(t, { token: 'workspace-token-for-mcp-integration-test' });
    for (const authorization of ['', 'Bearer wrong-token', 'Basic wrong-token']) {
        const response = await s.http('POST', { authorization });
        assert.equal(response.status, 401);
        assert.match(response.headers.get('www-authenticate')!, /Bearer/);
        assert.equal((await response.json()).error.message.includes('wrong-token'), false);
    }
    const login = await fetch(`${s.origin}/api/session`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-clickstudio-intent': '1' }, body: JSON.stringify({ token: 'workspace-token-for-mcp-integration-test' }) });
    assert.equal(login.status, 200);
    assert.equal((await s.http('POST', { authorization: '', cookie: login.headers.get('set-cookie')! })).status, 401);
    assert.equal((await s.http()).status, 200);
    assert.equal((await s.http('POST', { authorization: 'bearer workspace-token-for-mcp-integration-test' })).status, 200);
});

test('MCP validates origins and hosts even on a tokenless local server', async t => {
    const s = await start(t);
    assert.equal((await s.http('POST', { origin: 'https://unrelated.example' })).status, 403);
    assert.equal((await s.http('POST', { origin: 'null' })).status, 403);
    const invalidHostStatus = await new Promise<number>((resolve, reject) => {
        const req = request(`${s.origin}/mcp`, { method: 'POST', headers: { host: 'unrelated.example', 'content-type': 'application/json' } }, response => {
            response.resume();
            resolve(response.statusCode!);
        });
        req.once('error', reject);
        req.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }));
    });
    assert.equal(invalidHostStatus, 403);
    assert.equal((await s.http('POST', { origin: s.origin })).status, 200);
    assert.equal((await s.http()).headers.get('cache-control'), 'no-store');
    for (const method of ['GET', 'DELETE', 'OPTIONS']) {
        const response = await s.http(method);
        assert.equal(response.status, 405);
        assert.equal(response.headers.get('allow'), 'POST');
    }
    assert.equal(s.fixture.calls.length, 0);
});

test('MCP rejects untrusted connections and unsafe SQL before calling the database', async t => {
    const s = await start(t, { trusted: false });
    const untrusted = await s.call('execute_sql', query());
    assert.equal(untrusted.isError, true);
    assert.equal(untrusted.data.error?.code, 'WORKSPACE_UNTRUSTED');
    assert.equal((await s.call('list_tables', { connectionId: 'demo' })).data.error?.code, 'WORKSPACE_UNTRUSTED');
    s.runs.trust(owner, 'demo', true);
    for (const sql of ['CREATE TABLE x (id UInt64)', 'DELETE FROM x WHERE 1', 'SELECT 1; SELECT 2', "SELECT * FROM url('https://unrelated.example', CSV, 'x String')", 'SELECT cluster()', 'SELECT clusterAllReplicas()']) {
        assert.equal((await s.call('execute_sql', query({ sql }))).isError, true);
    }
    assert.equal((await s.call('explain_query', query({ sql: 'SELECT cluster /* comment */ ()' }))).data.error?.code, 'EXTERNAL_IO');
    assert.equal((await s.call('execute_sql', query({ connectionId: 'missing' }))).data.error?.code, 'CONNECTION_NOT_FOUND');
    assert.equal(s.fixture.calls.length, 0);
    assert.equal(s.store.count('runs'), 0);
});

test('MCP preserves exact values, bound parameters, limits, and shared API history', async t => {
    const s = await start(t), requestId = randomUUID();
    const response = await s.completed('execute_sql', query({ sql: 'SELECT {value:UInt64}', parameters: { value: '18446744073709551615' }, clientRequestId: requestId, limits: { rows: 2, seconds: 3 } }));
    assert.equal(response.isError, undefined);
    assert.equal(response.data.run?.status, 'succeeded');
    assert.deepEqual(response.data.result?.rows, [['18446744073709551615', '12345678901234567890.1234']]);
    assert.equal(response.data.result?.columns[0]?.type, 'UInt64');
    assert.equal(response.submission.data.clientRequestId, requestId);
    assert.equal(response.data.run?.limits.rows, 2);
    assert.equal(response.data.run?.limits.seconds, 3);
    assert.equal(response.data.run?.limits.memory, 536870912);
    assert.equal(Object.hasOwn(response.data.run!, 'sql'), false);
    assert.equal(Object.hasOwn(response.data.run!, 'parameters'), false);
    assert.deepEqual(s.fixture.calls[0]?.parameters, { value: '18446744073709551615' });
    const history = await (await fetch(`${s.origin}/api/runs`)).json() as Run[];
    assert.equal(history[0]?.id, response.data.run?.id);
    assert.equal(history[0]?.sql, 'SELECT {value:UInt64}');
});

test('MCP reuses a request ID and rejects conflicting input without rerunning SQL', async t => {
    const s = await start(t), input = query({ clientRequestId: randomUUID() });
    const first = await s.call('execute_sql', input);
    const second = await s.call('execute_sql', input);
    assert.equal(second.data.run?.id, first.data.run?.id);
    assert.equal((await s.call('execute_sql', { ...input, sql: 'SELECT 2' })).data.error?.code, 'IDEMPOTENCY_CONFLICT');
    assert.equal(s.fixture.calls.length, 1);
    assert.equal(s.store.count('runs'), 1);
});

test('MCP pages retained output and distinguishes paging from query truncation', async t => {
    const s = await start(t);
    s.fixture.result.rows = Array.from({ length: 105 }, (_, i) => [String(i), '0.0000']);
    const first = await s.completed('execute_sql', query());
    assert.equal(first.data.result?.rows.length, 100);
    assert.equal(first.data.result?.nextOffset, 100);
    assert.equal(first.data.result?.completeness, 'complete');
    const last = await s.call('get_result', { runId: first.data.run!.id, offset: 100, count: 10 });
    assert.equal(last.data.result?.rows.length, 5);
    assert.equal(last.data.result?.nextOffset, null);
    const bounded = await s.completed('execute_sql', query({ limits: { rows: 3 } }));
    assert.equal(bounded.data.run?.status, 'truncated');
    assert.equal(bounded.data.result?.totalRows, 3);
    assert.equal(bounded.data.result?.completeness, 'truncated');
    const beyond = await s.call('get_result', { runId: bounded.data.run!.id, offset: 20 });
    assert.deepEqual(beyond.data.result?.rows, []);
    assert.equal(s.fixture.calls.length, 2);
});

test('MCP returns a run ID immediately and can poll the same run to completion', async t => {
    const s = await start(t);
    const pending = await s.call('execute_sql', query({ sql: 'SELECT mcp_slow' }));
    assert.equal(pending.data.run?.status, 'queued');
    assert.equal(pending.data.result, undefined);
    const finished = await s.call('get_result', { runId: pending.data.run!.id, waitSeconds: 3 });
    assert.equal(finished.data.run?.status, 'succeeded');
    assert.equal(finished.data.result?.rows.length, 1);
    assert.equal(s.fixture.calls.length, 1);
});

test('MCP wait timeout returns pending state and keeps the database run alive', async t => {
    const s = await start(t);
    const submission = await s.call('execute_sql', query({ sql: 'SELECT mcp_slow' }));
    const pending = await s.call('get_result', { runId: submission.data.run!.id, waitSeconds: 1 });
    assert.equal(pending.data.run?.status, 'running');
    assert.equal(s.fixture.cancellations.length, 0);
    await s.call('cancel_query', { runId: pending.data.run!.id });
});

test('MCP request cancellation releases the result wait and leaves the durable run available', async t => {
    const s = await start(t, { protocol: 'modern' });
    const submission = await s.call('execute_sql', query({ sql: 'SELECT mcp_slow' })), runId = submission.data.run!.id;
    let subscriptions = 0;
    const subscribe = s.runs.subscribe.bind(s.runs);
    s.runs.subscribe = (...args: Parameters<typeof subscribe>) => {
        subscriptions++;
        const unsubscribe = subscribe(...args);
        return () => { subscriptions--; unsubscribe(); };
    };
    const controller = new AbortController();
    t.after(() => controller.abort());
    const rejected = assert.rejects(s.client.callTool({ name: 'get_result', arguments: { runId, waitSeconds: 30 } }, { signal: controller.signal }));
    const waitForSubscriptions = async (count: number) => {
        const deadline = Date.now() + 1000;
        while (subscriptions !== count && Date.now() < deadline) await sleep(10);
        assert.equal(subscriptions, count);
    };
    await waitForSubscriptions(1);
    controller.abort();
    await rejected;
    await waitForSubscriptions(0);
    assert.equal(s.runs.get(owner, runId).status, 'running');
    assert.equal(s.fixture.cancellations.length, 0);
    assert.equal((await s.call('get_result', { runId })).data.run?.status, 'running');
    assert.equal((await s.call('cancel_query', { runId })).data.cancellationRequested, true);
    assert.equal((await s.call('get_result', { runId, waitSeconds: 1 })).data.run?.status, 'cancelled');
    assert.deepEqual(s.fixture.cancellations, [runId]);
});

test('MCP cancels running and queued work and reports unconfirmed remote cancellation', async t => {
    const s = await start(t);
    s.fixture.cancelFails = true;
    const inputs = await Promise.all(Array.from({ length: 3 }, () => s.call('execute_sql', query({ sql: 'SELECT mcp_slow' }))));
    const queued = inputs.find(value => s.runs.get(owner, value.data.run!.id).status === 'queued')!;
    assert.ok(queued);
    const cancelledQueue = await s.call('cancel_query', { runId: queued.data.run!.id });
    assert.equal(cancelledQueue.isError, undefined);
    assert.equal(cancelledQueue.data.run?.status, 'cancelled');
    assert.equal(s.fixture.calls.length, 2);
    assert.equal(s.fixture.cancellations.length, 0);
    const active = inputs.find(value => value !== queued)!;
    const cancelled = await s.call('cancel_query', { runId: active.data.run!.id });
    assert.equal(cancelled.isError, undefined);
    assert.equal(cancelled.data.cancellationRequested, true);
    const finished = await s.call('get_result', { runId: active.data.run!.id, waitSeconds: 1 });
    assert.equal(finished.data.run?.status, 'cancelled');
    assert.ok(finished.data.run?.warnings.some(warning => warning.includes('could not be confirmed')));
    assert.ok(s.fixture.cancellations.includes(active.data.run!.id));
    const repeated = await s.call('cancel_query', { runId: active.data.run!.id });
    assert.equal(repeated.isError, undefined);
    assert.equal(repeated.data.cancellationRequested, false);
    assert.equal(repeated.data.result, undefined);
});

test('MCP uses bound metadata filters rather than interpolating database and table names', async t => {
    const s = await start(t);
    const tables = await s.completed('list_tables', { connectionId: 'demo' });
    assert.equal(tables.submission.data.run?.status, 'queued');
    assert.equal(tables.data.run?.status, 'succeeded');
    assert.equal(s.fixture.calls[0]?.parameters.database, 'demo');
    const database = "odd'name", table = 'table with spaces';
    const columns = await s.completed('describe_table', { connectionId: 'demo', database, table });
    assert.equal(columns.submission.data.run?.status, 'queued');
    assert.equal(columns.data.run?.status, 'succeeded');
    assert.deepEqual(s.fixture.calls[1]?.parameters, { database, table });
    assert.equal(s.fixture.calls[1]?.sql.includes(database), false);
    assert.equal(s.fixture.calls[1]?.sql.includes(table), false);
    assert.match(s.fixture.calls[1]!.sql, /system\.columns/);
    assert.equal(s.fixture.calls.length, 2);
});

test('MCP explain honors tested capabilities and uses the existing run kinds', async t => {
    const s = await start(t);
    s.fixture.explainAvailable = false;
    assert.equal((await s.call('explain_query', query())).data.error?.code, 'CAPABILITY_UNAVAILABLE');
    assert.equal(s.fixture.calls.length, 0);
    s.fixture.explainAvailable = true;
    for (const [mode, kind] of [['indexes', 'explain'], ['plan', 'plan'], ['pipeline', 'pipeline'], ['analyze', 'analyze']]) {
        const result = await s.completed('explain_query', query({ mode }));
        assert.equal(result.submission.data.run?.status, 'queued');
        assert.equal(result.data.run?.kind, kind);
        assert.equal(result.data.run?.status, 'succeeded');
    }
    assert.equal(s.fixture.calls.length, 4);
});

test('MCP validates tool arguments and parameter keys before submitting a run', async t => {
    const s = await start(t);
    for (const args of [query({ limits: { rows: 20001 } }), query({ unexpected: true }), query({ waitSeconds: 0 }), query({ parameters: { x: 42 } }), query({ sql: 'x'.repeat(200001) })]) {
        assert.equal((await s.client.callTool({ name: 'execute_sql', arguments: args })).isError, true);
    }
    for (const parameters of [
        { 'bad-name': '1' }, { '1value': '1' }, { '': '1' }, { ['a'.repeat(65)]: '1' },
        ...['__proto__', 'constructor', 'prototype'].map(key => Object.fromEntries([[key, '1']])),
        { value: 'x'.repeat(4001) }, Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`p${i}`, '1'])),
    ]) {
        for (const name of ['execute_sql', 'explain_query']) assert.equal((await s.client.callTool({ name, arguments: query({ parameters }) })).isError, true, `${name}: ${Object.keys(parameters).join(', ')}`);
    }
    for (const name of ['list_tables', 'describe_table', 'explain_query']) assert.equal((await s.client.callTool({ name, arguments: query({ table: 'events', waitSeconds: 0 }) })).isError, true);
    assert.equal((await s.client.callTool({ name: 'get_result', arguments: { runId: randomUUID(), count: 0 } })).isError, true);
    assert.equal((await s.client.callTool({ name: 'get_result', arguments: { runId: randomUUID(), waitSeconds: 31 } })).isError, true);
    assert.equal((await s.call('get_result', { runId: randomUUID() })).data.error?.code, 'NOT_FOUND');
    assert.equal(s.fixture.calls.length, 0);
});

test('MCP accepts the parameter count, key length, and value length boundaries', async t => {
    const s = await start(t);
    const parameters = { ...Object.fromEntries(Array.from({ length: 48 }, (_, i) => [`p${i}`, '1'])), ['a'.repeat(64)]: 'x'.repeat(4000), _empty: '' };
    assert.equal(Object.keys(parameters).length, 50);
    const result = await s.completed('execute_sql', query({ parameters }));
    assert.equal(result.data.run?.status, 'succeeded');
    assert.deepEqual(s.fixture.calls[0]?.parameters, parameters);
});

test('MCP distinguishes an empty completed result, a failure, and an expired snapshot', async t => {
    const s = await start(t);
    s.fixture.result.rows = [];
    const empty = await s.completed('execute_sql', query());
    assert.equal(empty.data.run?.status, 'succeeded');
    assert.deepEqual(empty.data.result?.rows, []);
    assert.equal(empty.data.result?.completeness, 'complete');
    const failed = await s.completed('execute_sql', query({ sql: 'SELECT mcp_error' }));
    assert.equal(failed.isError, true);
    assert.equal(failed.data.run?.status, 'failed');
    assert.equal(failed.data.run?.error?.code, 'DATABASE_ERROR');
    const run = s.runs.get(owner, empty.data.run!.id);
    run.resultExpiresAt = new Date(0).toISOString();
    s.store.put('runs', run.id, run);
    const expired = await s.call('get_result', { runId: run.id });
    assert.equal(expired.isError, true);
    assert.equal(expired.data.run?.resultState, 'expired');
    assert.equal(expired.data.error?.code, 'RESULT_EXPIRED');
    assert.equal(s.fixture.calls.length, 2);
});

test('MCP redacts configured secrets in errors and rejects secret-bearing result rows', async t => {
    const secret = 'configured-db-"secret"\nwith-newline', s = await start(t, { secret });
    s.fixture.failureMessage = `Database rejected ${secret}`;
    const failed = await s.completed('execute_sql', query({ sql: 'SELECT mcp_error' }));
    assert.match(failed.data.run!.error!.message, /\[redacted\]/);
    assert.equal(JSON.stringify(failed).includes(JSON.stringify(secret).slice(1, -1)), false);
    s.fixture.result.rows = [[secret, '0.0000']];
    const blocked = await s.completed('execute_sql', query());
    assert.equal(blocked.isError, true);
    assert.equal(blocked.data.error?.code, 'SECRET_IN_EXPORT');
    assert.ok(blocked.data.runId);
    assert.equal(JSON.stringify(blocked).includes(JSON.stringify(secret).slice(1, -1)), false);
});

test('MCP never reads or cancels a run owned by another principal', async t => {
    const s = await start(t), finished = await s.completed('execute_sql', query());
    const run = s.runs.get(owner, finished.data.run!.id);
    run.owner = 'another-owner';
    s.store.put('runs', run.id, run);
    assert.equal((await s.call('get_result', { runId: run.id })).isError, true);
    assert.equal((await s.call('cancel_query', { runId: run.id })).isError, true);
    assert.equal(s.fixture.cancellations.length, 0);
});
