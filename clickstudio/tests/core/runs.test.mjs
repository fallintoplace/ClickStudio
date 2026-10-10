import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import {
    DEFAULT_RECEIPT_LIMIT,
    DEFAULT_RECEIPT_RETENTION_MS,
    DEFAULT_RUN_HISTORY_LIMIT,
    DEFAULT_SCRIPT_RETENTION_MS,
    RunService,
    boundResult,
} from '../../.core-build/core/runs.js';
import { DEFAULT_LIMITS } from '../../.core-build/shared/types.js';
import { fixture, owner, other, viewer, until, columns, connection } from './helpers.mjs';
test('Lifecycle retains typed evidence and actual identity', async () => {
    const f = fixture(),
        r = f.runs.submit(owner, f.request());
    const done = await f.runs.wait(owner, r.id);
    assert.equal(done.status, 'succeeded');
    assert.equal(done.executedAs, 'reader');
    assert.equal(f.runs.result(owner, r.id).rows[0][0], '1');
    assert.equal(done.retryPolicy, 'never');
});
test('Duplicate request executes once', async () => {
    const f = fixture(),
        input = f.request();
    const a = f.runs.submit(owner, input),
        b = f.runs.submit(owner, input);
    assert.equal(a.id, b.id);
    await f.runs.wait(owner, a.id);
    assert.equal(f.calls.length, 1);
});
test('Run capacity checks use store counts without loading run or receipt records', async () => {
    const f = fixture(),
        list = f.store.list.bind(f.store);
    f.store.list = bucket => {
        if (bucket === 'runs' || bucket === 'receipts')
            throw new Error(`Capacity check loaded ${bucket}`);
        return list(bucket);
    };
    let run;
    try {
        run = f.runs.submit(owner, f.request());
    } finally {
        f.store.list = list;
    }
    assert.equal((await f.runs.wait(owner, run.id)).status, 'succeeded');
    assert.equal(f.store.count('runs'), 1);
    assert.equal(f.store.count('receipts'), 1);
});
test('Run history keeps the newest entries and preserves idempotency after pruning', async () => {
    assert.equal(DEFAULT_RUN_HISTORY_LIMIT, 10_000);
    assert.equal(DEFAULT_RECEIPT_LIMIT, 100_000);
    const f = fixture({ runHistoryLimit: 3 }),
        oldInput = f.request(),
        old = f.runs.submit(owner, oldInput);
    await f.runs.wait(owner, old.id);
    const finished = f.runs.get(owner, old.id);
    f.store.put('runs', old.id, {
        ...finished,
        createdAt: '2000-01-01T00:00:00.000Z',
        status: 'failed',
        resultState: 'unavailable',
    });
    f.store.put('runs', 'failed', {
        ...finished,
        id: 'failed',
        queryId: 'failed',
        createdAt: '2001-01-01T00:00:00.000Z',
        status: 'failed',
        finishedAt: '2001-01-01T00:00:01.000Z',
        resultState: 'unavailable',
    });
    f.store.put('results', 'failed', { runId: 'failed' });
    f.store.put('runs', 'active', {
        ...finished,
        id: 'active',
        queryId: 'active',
        createdAt: '2002-01-01T00:00:00.000Z',
        status: 'running',
        resultState: 'pending',
    });
    const next = f.runs.submit(owner, f.request());
    assert.equal(f.store.count('runs'), 3);
    assert.equal(f.store.get('runs', old.id), undefined);
    assert.ok(f.store.get('runs', 'failed'));
    assert.equal(f.store.get('results', old.id), undefined);
    assert.ok(f.store.get('results', 'failed'));
    assert.ok(f.store.get('runs', 'active'));
    assert.ok(f.store.get('runs', next.id));
    assert.ok(
        f.store.keys('receipts').some(key => f.store.get('receipts', key).resourceId === old.id),
    );
    assert.throws(() => f.runs.submit(owner, oldInput), { code: 'RETIRED_REQUEST' });
    await f.runs.wait(owner, next.id);
});
test('Concurrent run submissions prune only enough finished history to stay at the limit', async () => {
    const f = fixture({ runHistoryLimit: 2 });
    f.store.put('runs', 'oldest', {
        id: 'oldest',
        status: 'succeeded',
        createdAt: '2000-01-01T00:00:00.000Z',
    });
    f.store.put('runs', 'newer', {
        id: 'newer',
        status: 'succeeded',
        createdAt: '2001-01-01T00:00:00.000Z',
    });
    const first = f.runs.submit(owner, f.request()),
        second = f.runs.submit(owner, f.request());
    assert.equal(f.store.count('runs'), 2);
    assert.equal(f.store.get('runs', 'oldest'), undefined);
    assert.equal(f.store.get('runs', 'newer'), undefined);
    assert.ok(f.store.get('runs', first.id));
    assert.ok(f.store.get('runs', second.id));
    await Promise.all([f.runs.wait(owner, first.id), f.runs.wait(owner, second.id)]);
});
test('Run history stays intact when it is full and no finished run can be pruned', () => {
    const f = fixture({ runHistoryLimit: 2 });
    f.store.put('runs', 'queued', {
        id: 'queued',
        status: 'queued',
        createdAt: '2000-01-01T00:00:00.000Z',
    });
    f.store.put('runs', 'running', {
        id: 'running',
        status: 'running',
        createdAt: '2001-01-01T00:00:00.000Z',
    });
    assert.throws(() => f.runs.submit(owner, f.request()), { code: 'HISTORY_FULL' });
    assert.equal(f.store.count('runs'), 2);
    assert.equal(f.calls.length, 0);
});
test('Run history is not pruned when the separate receipt limit rejects a submission', async () => {
    const f = fixture({ runHistoryLimit: 1, receiptLimit: 1 }),
        existing = f.runs.submit(owner, f.request());
    await f.runs.wait(owner, existing.id);
    assert.throws(() => f.runs.submit(owner, f.request()), { code: 'RECEIPT_CAPACITY' });
    assert.ok(f.store.get('runs', existing.id));
    assert.equal(f.store.count('runs'), 1);
});
test('Reusing an id for different SQL rejects', () => {
    const f = fixture(),
        input = f.request();
    f.runs.submit(owner, input);
    assert.throws(() => f.runs.submit(owner, { ...input, sql: 'SELECT 9' }), {
        code: 'IDEMPOTENCY_CONFLICT',
    });
});
test('Connection trust is required server-side', () => {
    const f = fixture();
    f.runs.trust(owner, 'local', false);
    assert.throws(() => f.runs.submit(owner, f.request()), { code: 'WORKSPACE_UNTRUSTED' });
    assert.equal(f.calls.length, 0);
});
test('Connection trust is invalidated when the same profile id resolves to another target', () => {
    let host = 'http://localhost:8123';
    const f = fixture({
        authorize: (_p, id) => ({
            id,
            name: 'Local',
            host,
            database: 'default',
            username: 'reader',
            readonly: true,
            limits: { ...DEFAULT_LIMITS },
            manifest: {
                version: 1,
                serverVersion: 'fixture',
                testedAt: new Date().toISOString(),
                explain: { available: true },
                pipeline: { available: true },
            },
        }),
    });
    assert.equal(f.runs.isTrusted(owner, 'local'), true);
    host = 'http://other:8123';
    assert.equal(f.runs.isTrusted(owner, 'local'), false);
    assert.throws(() => f.runs.submit(owner, f.request()), { code: 'WORKSPACE_UNTRUSTED' });
});
test('Logical-plan requests are rejected before queuing when the capability is unavailable', () => {
    const f = fixture({
        authorize: (_principal, id) => ({
            ...connection,
            id,
            manifest: {
                ...connection.manifest,
                explainPlan: { available: false, reason: 'Plan JSON is not supported' },
            },
        }),
    });
    assert.throws(() => f.runs.submit(owner, f.request({ kind: 'plan' })), {
        code: 'CAPABILITY_UNAVAILABLE',
    });
    assert.equal(f.store.count('runs'), 0);
    assert.equal(f.calls.length, 0);
});
test('EXPLAIN ANALYZE is rejected without native support and retained as a measured run when supported', async () => {
    const unsupported = fixture({
        authorize: (_principal, id) => ({
            ...connection,
            id,
            manifest: {
                ...connection.manifest,
                explainAnalyze: { available: false, reason: 'Upgrade ClickHouse to 26.7 or newer' },
            },
        }),
    });
    assert.throws(() => unsupported.runs.submit(owner, unsupported.request({ kind: 'analyze' })), {
        code: 'CAPABILITY_UNAVAILABLE',
    });
    assert.equal(unsupported.store.count('runs'), 0);
    assert.equal(unsupported.calls.length, 0);

    const supported = fixture({
        authorize: (_principal, id) => ({
            ...connection,
            id,
            manifest: { ...connection.manifest, explainAnalyze: { available: true } },
        }),
    });
    const run = supported.runs.submit(owner, supported.request({ kind: 'analyze' }));
    assert.equal((await supported.runs.wait(owner, run.id)).kind, 'analyze');
    assert.equal(supported.calls[0].kind, 'analyze');
});
test('Viewer cannot execute', () => {
    const f = fixture();
    assert.throws(() => f.runs.submit(viewer, f.request()), { code: 'ROLE_READ_ONLY' });
});
test('Owners cannot inspect each other runs or history', async () => {
    const f = fixture(),
        r = f.runs.submit(owner, f.request());
    await f.runs.wait(owner, r.id);
    assert.throws(() => f.runs.get(other, r.id), { code: 'NOT_FOUND' });
    assert.equal(f.runs.list(other).length, 0);
});
test('Queued cancellation does not execute', async () => {
    const f = fixture(),
        r = f.runs.submit(owner, f.request());
    await f.runs.cancel(owner, r.id);
    assert.equal((await f.runs.wait(owner, r.id)).status, 'cancelled');
    assert.equal(f.calls.length, 0);
});
test('Active cancellation has a separate server kill request', async () => {
    const f = fixture({ delay: 500 }),
        r = f.runs.submit(owner, f.request());
    await until(() => f.calls.length);
    await f.runs.cancel(owner, r.id);
    assert.equal((await f.runs.wait(owner, r.id)).status, 'cancelled');
    assert.ok(f.kills.includes(r.id));
});
test('Server deadline marks timeout rather than query error', async () => {
    const f = fixture({ delay: 5000 }),
        r = f.runs.submit(owner, f.request({ limits: { seconds: 1 } }));
    assert.equal((await f.runs.wait(owner, r.id)).status, 'timed_out');
});
test('Reconnect after completion receives authoritative state', async () => {
    const f = fixture(),
        r = f.runs.submit(owner, f.request());
    await f.runs.wait(owner, r.id);
    let event;
    const close = f.runs.subscribe(owner, r.id, e => (event = e));
    close();
    assert.equal(event.run.status, 'succeeded');
    assert.ok(event.sequence >= 2);
});
test('Broken listener cannot fail execution', async () => {
    const f = fixture(),
        r = f.runs.submit(owner, f.request());
    let first = true;
    const close = f.runs.subscribe(owner, r.id, () => {
        if (!first) throw new Error('disconnected');
        first = false;
    });
    assert.equal((await f.runs.wait(owner, r.id)).status, 'succeeded');
    close();
});
test('Result expiry preserves SQL but removes row access', async () => {
    const f = fixture(),
        r = f.runs.submit(owner, f.request());
    const done = await f.runs.wait(owner, r.id);
    f.store.put('runs', r.id, { ...done, resultExpiresAt: '2000-01-01T00:00:00.000Z' });
    assert.throws(() => f.runs.result(owner, r.id), { code: 'RESULT_EXPIRED' });
    assert.ok(f.runs.get(owner, r.id).sql);
});
test('Quota eviction is explicit, not silent empty rows', async () => {
    const f = fixture({ snapshotBytes: 1 }),
        r = f.runs.submit(owner, f.request());
    await f.runs.wait(owner, r.id);
    assert.equal(f.runs.get(owner, r.id).resultState, 'expired');
});
test('Pagination never returns more than requested', async () => {
    const f = fixture(),
        r = f.runs.submit(owner, f.request());
    await f.runs.wait(owner, r.id);
    const page = f.runs.page(owner, r.id, 0, 1);
    assert.equal(page.rows.length, 1);
    assert.equal(page.nextOffset, 1);
    assert.equal(page.totalRows, 2);
});
test('Output row caps are explicit', () => {
    const r = boundResult(
        { columns, rows: [['1'], ['2']], truncated: false },
        { ...DEFAULT_LIMITS, rows: 1 },
    );
    assert.equal(r.rows.length, 1);
    assert.equal(r.truncated, true);
});
test('Output byte caps use UTF-8 bytes', () => {
    const limit = Buffer.byteLength(JSON.stringify(columns)) + 7;
    const r = boundResult(
        { columns, rows: [['éé'], ['x']], truncated: false },
        { ...DEFAULT_LIMITS, bytes: limit },
    );
    assert.equal(r.rows.length, 0);
    assert.equal(r.truncated, true);
});
test('Malformed row shapes are rejected', () =>
    assert.throws(
        () => boundResult({ columns, rows: [['1', '2']], truncated: false }, DEFAULT_LIMITS),
        { code: 'INVALID_RESULT' },
    ));
test('Partial scripts preserve each outcome, stop-on-error skips remainder', async () => {
    const f = fixture();
    const s = f.runs.submitScript(owner, f.request({ sql: 'SELECT 1; SELECT fail; SELECT 3' }));
    const done = await until(() => {
        const x = f.runs.getScript(owner, s.id);
        return x.status === 'running' ? false : x;
    });
    assert.equal(done.status, 'partial');
    assert.deepEqual(
        done.statements.map(s => s.status),
        ['succeeded', 'failed', 'skipped'],
    );
});
test('Terminal scripts and their receipts expire after the configured retention window', async () => {
    const f = fixture(),
        script = f.runs.submitScript(owner, f.request({ sql: 'SELECT 1' }));
    await until(() => f.runs.getScript(owner, script.id).status !== 'running');
    const receiptKey = f.store
        .keys('receipts')
        .find(key => f.store.get('receipts', key).resourceId === script.id);
    assert.ok(receiptKey);
    const old = '2000-01-01T00:00:00.000Z';
    f.store.put('scripts', script.id, { ...f.runs.getScript(owner, script.id), createdAt: old });
    f.store.put('receipts', receiptKey, { ...f.store.get('receipts', receiptKey), at: old });
    f.runs.sweep(Date.parse(old) + DEFAULT_SCRIPT_RETENTION_MS + 1);
    assert.equal(f.store.get('scripts', script.id), undefined);
    assert.equal(f.store.get('receipts', receiptKey), undefined);
});
test('Active scripts and live-resource idempotency receipts survive the retention cutoff', async () => {
    const f = fixture({ delay: 500 }),
        script = f.runs.submitScript(owner, f.request({ sql: 'SELECT 1' }));
    await until(() => f.calls.length);
    const receiptKey = f.store
        .keys('receipts')
        .find(key => f.store.get('receipts', key).resourceId === script.id);
    assert.ok(receiptKey);
    const old = '2000-01-01T00:00:00.000Z';
    f.store.put('scripts', script.id, { ...f.runs.getScript(owner, script.id), createdAt: old });
    f.store.put('receipts', receiptKey, { ...f.store.get('receipts', receiptKey), at: old });
    f.runs.sweep(Date.parse(old) + DEFAULT_SCRIPT_RETENTION_MS + 1);
    assert.ok(f.store.get('scripts', script.id));
    assert.ok(f.store.get('receipts', receiptKey));
    await f.runs.cancelScript(owner, script.id);
    await until(() => f.runs.getScript(owner, script.id).status !== 'running');
    f.runs.sweep(Date.parse(old) + DEFAULT_SCRIPT_RETENTION_MS + 1);
    assert.equal(f.store.get('scripts', script.id), undefined);
    await f.runs.close();
});
test('Continue-on-error scripts do not hide a failed statement', async () => {
    const f = fixture();
    const s = f.runs.submitScript(
        owner,
        f.request({ sql: 'SELECT 1; SELECT fail; SELECT 3' }),
        false,
    );
    const done = await until(() => {
        const x = f.runs.getScript(owner, s.id);
        return x.status === 'running' ? false : x;
    });
    assert.equal(done.status, 'partial');
    assert.deepEqual(
        done.statements.map(s => s.status),
        ['succeeded', 'failed', 'succeeded'],
    );
});
test('All script statements are guarded before the first executes', () => {
    const f = fixture();
    assert.throws(() => f.runs.submitScript(owner, f.request({ sql: 'SELECT 1; DROP TABLE t' })));
    assert.equal(f.calls.length, 0);
});
test('Cancellation applies to the active script and skips remaining statements', async () => {
    const f = fixture({ delay: 500 });
    const s = f.runs.submitScript(owner, f.request({ sql: 'SELECT 1; SELECT 2' }));
    await until(() => f.calls.length);
    await f.runs.cancelScript(owner, s.id);
    const done = await until(() => {
        const x = f.runs.getScript(owner, s.id);
        return x.status === 'running' ? false : x;
    });
    assert.equal(done.status, 'cancelled');
    assert.equal(f.calls.length, 1);
});
test('Restart marks active runs interrupted, never replays', async () => {
    const f = fixture({ delay: 100 }),
        r = f.runs.submit(owner, f.request());
    await until(() => f.calls.length);
    const restarted = new RunService(f.store, f.driver, f.authorize);
    assert.equal(restarted.get(owner, r.id).status, 'interrupted');
    assert.equal(f.calls.length, 1);
    await f.runs.close();
});
test('Ephemeral progress cannot outrank post-restart durable state', async () => {
    const f = fixture({ delay: 50 }),
        r = f.runs.submit(owner, f.request());
    let progressSequence;
    const close = f.runs.subscribe(owner, r.id, event => {
        if (event.type === 'progress') progressSequence = event.sequence;
    });
    await until(() => progressSequence !== undefined);
    const restarted = new RunService(f.store, f.driver, f.authorize);
    const interrupted = restarted.get(owner, r.id);
    assert.equal(interrupted.status, 'interrupted');
    assert.ok(interrupted.sequence > progressSequence);
    close();
    await sleep(60);
    await f.runs.close();
    await restarted.close();
});
test('Deleting history does not release the idempotency reservation', async () => {
    const f = fixture(),
        input = f.request(),
        r = f.runs.submit(owner, input);
    await f.runs.wait(owner, r.id);
    f.runs.remove(owner, r.id);
    assert.throws(() => f.runs.submit(owner, input), { code: 'RETIRED_REQUEST' });
});
test('Deleted-run idempotency tombstones expire after the retention window', async () => {
    const f = fixture(),
        input = f.request(),
        run = f.runs.submit(owner, input);
    await f.runs.wait(owner, run.id);
    f.runs.remove(owner, run.id);
    const receiptKey = f.store.keys('receipts')[0];
    const old = '2000-01-01T00:00:00.000Z';
    f.store.put('receipts', receiptKey, { ...f.store.get('receipts', receiptKey), at: old });
    f.runs.sweep(Date.parse(old) + DEFAULT_RECEIPT_RETENTION_MS + 1);
    assert.equal(f.store.get('receipts', receiptKey), undefined);
    const replacement = f.runs.submit(owner, input);
    assert.notEqual(replacement.id, run.id);
    await f.runs.wait(owner, replacement.id);
    assert.equal(f.calls.length, 2);
});
test('Child runs cannot cross connection boundaries', async () => {
    const f = fixture(),
        r = f.runs.submit(owner, f.request());
    await f.runs.wait(owner, r.id);
    f.runs.trust(owner, 'second', true);
    assert.throws(
        () => f.runs.submit(owner, f.request({ connectionId: 'second', parentRunId: r.id })),
        { code: 'CONNECTION_MISMATCH' },
    );
});
