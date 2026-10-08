import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRunEvent, preferNewerRun } from '../../.core-build/shared/run-wire.js';

const run = {
    dataSource: 'fixture',
    id: 'run-1',
    queryId: 'query-1',
    owner: 'owner-1',
    connectionId: 'demo',
    sql: 'SELECT 1',
    kind: 'query',
    parameters: {},
    limits: { rows: 5000, bytes: 2000000, seconds: 30, memory: 536870912, threads: 4 },
    tags: {},
    status: 'running',
    createdAt: '2026-09-24T19:00:00.000Z',
    elapsedMs: 12.5,
    rowCount: 0,
    bytes: 0,
    columns: [],
    warnings: [],
    sequence: 3,
    resultState: 'pending',
    requestedBy: 'owner-1',
    executedAs: 'fixture',
    permissionSnapshot: { readonly: true, role: 'owner' },
    retryPolicy: 'never',
};

test('run event decoder preserves valid live events', () => {
    const event = parseRunEvent({ sequence: 3, type: 'progress', run });
    assert.equal(event.sequence, 3);
    assert.equal(event.type, 'progress');
    assert.equal(event.run.id, 'run-1');
});

test('run event decoder preserves an EXPLAIN PLAN run kind', () => {
    const event = parseRunEvent({ sequence: 3, type: 'progress', run: { ...run, kind: 'plan' } });
    assert.equal(event.run.kind, 'plan');
});

test('run event decoder preserves an EXPLAIN ANALYZE run kind', () => {
    const event = parseRunEvent({ sequence: 3, type: 'progress', run: { ...run, kind: 'analyze' } });
    assert.equal(event.run.kind, 'analyze');
});

test('run event decoder rejects malformed run payloads', () => {
    assert.throws(
        () => parseRunEvent({ sequence: 4, type: 'progress', run: { ...run, limits: { rows: '5000' } } }),
        /Invalid run event/,
    );
    assert.throws(
        () => parseRunEvent({ sequence: 4, type: 'unknown', run }),
        /Invalid run event/,
    );
});

test('older HTTP responses cannot undo a newer completed run event', () => {
    const queued = { ...run, status: 'queued', sequence: 0 };
    const running = { ...run, status: 'running', sequence: 2 };
    const completed = { ...run, status: 'succeeded', sequence: 3, resultState: 'reopenable' };

    assert.equal(preferNewerRun(undefined, queued), queued);
    assert.equal(preferNewerRun(queued, running), running);
    assert.equal(preferNewerRun(running, completed), completed);
    assert.equal(preferNewerRun(completed, queued), completed);
    assert.equal(preferNewerRun(completed, running), completed);
});

test('equal-sequence snapshots can still update result retention state', () => {
    const completed = { ...run, status: 'succeeded', sequence: 3, resultState: 'reopenable' };
    const expired = { ...completed, resultState: 'expired' };
    assert.equal(preferNewerRun(completed, expired), expired);
});
