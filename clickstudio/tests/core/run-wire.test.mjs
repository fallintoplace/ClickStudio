import test from 'node:test';
import assert from 'node:assert/strict';
import {
    isResult,
    parseRunEvent,
} from '../../.core-build/src/frontend/workspace/queries/execution/events.js';
import { terminal } from '../../.core-build/src/backend/queries/execution/runs.js';

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
    const event = parseRunEvent({
        sequence: 3,
        type: 'progress',
        run: { ...run, kind: 'analyze' },
    });
    assert.equal(event.run.kind, 'analyze');
});

test('run event decoder rejects malformed run payloads', () => {
    assert.throws(
        () =>
            parseRunEvent({
                sequence: 4,
                type: 'progress',
                run: { ...run, limits: { rows: '5000' } },
            }),
        /Invalid run event/,
    );
    assert.throws(() => parseRunEvent({ sequence: 4, type: 'unknown', run }), /Invalid run event/);
});

test('run event decoding preserves every supported kind, status and result state', () => {
    const domains = {
        kind: ['query', 'explain', 'plan', 'pipeline', 'analyze'],
        status: [
            'queued',
            'running',
            'succeeded',
            'truncated',
            'failed',
            'cancelled',
            'timed_out',
            'interrupted',
        ],
        resultState: ['pending', 'reopenable', 'expired', 'unavailable'],
    };
    for (const [field, values] of Object.entries(domains)) {
        for (const value of values) {
            const event = parseRunEvent({
                sequence: 3,
                type: 'state',
                run: { ...run, [field]: value },
            });
            assert.equal(event.run[field], value);
        }
    }
});

test('run event decoding rejects unknown, non-string and unrelated domain values', () => {
    for (const field of ['kind', 'status', 'resultState']) {
        for (const value of [
            'constructor',
            'toString',
            '__proto__',
            'partial',
            'unknown',
            'skipped',
            '',
            null,
            1,
            {},
            [],
        ])
            assert.throws(
                () =>
                    parseRunEvent({
                        sequence: 3,
                        type: 'progress',
                        run: { ...run, [field]: value },
                    }),
                /Invalid run event/,
            );
    }
    for (const type of ['constructor', 'state-change', '', null, 1])
        assert.throws(() => parseRunEvent({ sequence: 3, type, run }), /Invalid run event/);
});

test('terminal run classification preserves successful and unsuccessful outcomes', () => {
    for (const status of [
        'succeeded',
        'truncated',
        'failed',
        'cancelled',
        'timed_out',
        'interrupted',
    ])
        assert.equal(terminal({ status }), true);
    for (const status of ['queued', 'running']) assert.equal(terminal({ status }), false);
});

test('result decoding accepts existing completeness values and rejects foreign statuses', () => {
    const result = {
        runId: 'run-1',
        queryId: 'query-1',
        columns: [],
        rows: [],
        createdAt: 'now',
        expiresAt: 'later',
    };
    for (const completeness of ['complete', 'truncated'])
        assert.equal(isResult({ ...result, completeness }), true);
    for (const completeness of ['succeeded', 'partial', 'constructor', null, 1])
        assert.equal(isResult({ ...result, completeness }), false);
});
