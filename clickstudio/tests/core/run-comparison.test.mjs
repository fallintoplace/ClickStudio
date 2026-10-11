import test from 'node:test';
import assert from 'node:assert/strict';
import {
    compareRuns,
    comparisonDelta,
    comparableRun,
    comparePipelineOperators,
} from '../../.core-build/src/frontend/workspace/queries/history/comparison.js';
const run = (id, fields = {}) => ({
    id,
    queryId: `query-${id}`,
    connectionId: 'local',
    dataSource: 'clickhouse',
    kind: 'query',
    status: 'succeeded',
    elapsedMs: 100,
    rowCount: 10,
    parameters: {},
    limits: {},
    ...fields,
});
const profile = (run, fields = {}) => ({
    runId: run.id,
    queryId: run.queryId,
    evidence: [{ query_id: run.queryId, type: 'QueryFinish', ...fields }],
});
for (const [a, b, expected] of [
    ['1000', '294', '↓ 70.6%'],
    ['0', '0', 'No change'],
    ['0', '9', 'Increase from zero'],
    ['10', '11', '↑ 10.0%'],
    [undefined, '10', 'Unavailable'],
    ['18446744073709551615', '0', '↓ 100.0%'],
])
    test(`Comparison delta ${a} → ${b}`, () => assert.equal(comparisonDelta(a, b).text, expected));
test('Comparison never mixes one server duration with another client duration', () => {
    const a = run('a'),
        b = run('b', { elapsedMs: 250 });
    const result = compareRuns(a, b, profile(a, { query_duration_ms: '5' }));
    assert.equal(result.metrics[0].before, '100');
    assert.equal(result.metrics[0].after, '250');
    assert.equal(result.metrics[0].source, 'Client-observed elapsed time');
    assert.equal(result.metrics.find(row => row.label === 'Peak memory').before, undefined);
});
test('Comparison rejects mismatched profile identity, query IDs and non-terminal evidence', () => {
    const a = run('a'),
        b = run('b');
    for (const bad of [
        profile(b),
        {
            ...profile(a),
            evidence: [{ query_id: a.queryId, type: 'QueryStart', query_duration_ms: '2' }],
        },
        {
            ...profile(a),
            evidence: [{ query_id: 'other', type: 'QueryFinish', query_duration_ms: '2' }],
        },
    ])
        assert.equal(
            compareRuns(a, b, bad, profile(b, { query_duration_ms: '3' })).metrics[0].before,
            '100',
        );
});
test('Comparison retains precise counts and guards different sources, parameters, limits, truncated results', () => {
    const a = run('a'),
        b = run('b', {
            connectionId: 'other',
            dataSource: 'fixture',
            status: 'truncated',
            parameters: { x: '1' },
            limits: { threads: 8 },
        });
    const result = compareRuns(
        a,
        b,
        profile(a, { read_rows: '18446744073709551615' }),
        profile(b, { read_rows: '18446744073709551614' }),
    );
    assert.equal(result.deltasEnabled, false);
    assert.equal(result.metrics[1].before, '18446744073709551615');
    assert.match(result.warnings.join(' '), /parameters differ/);
    assert.match(result.warnings.join(' '), /limits differ/);
    assert.match(result.warnings.join(' '), /truncated/);
    assert.equal(comparableRun(run('x', { kind: 'analyze' }), 'local'), false);
    assert.equal(comparableRun(run('x', { status: 'failed' }), 'local'), false);
});
test('Pipeline diff ignores ephemeral node IDs and compares operator multiplicities', () => {
    const result = comparePipelineOperators(
        {
            nodes: [
                { id: 'a', label: 'Read' },
                { id: 'b', label: 'Filter' },
            ],
        },
        {
            nodes: [
                { id: 'x', label: 'Read' },
                { id: 'y', label: 'Filter' },
                { id: 'z', label: 'Filter' },
            ],
        },
    );
    assert.deepEqual(result, [{ label: 'Filter', before: 1, after: 2 }]);
});
