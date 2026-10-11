import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildQueryProfile,
    parsePipelineResult,
} from '../../.core-build/src/shared/queries/inspection/profile.js';

const run = {
    id: 'run-1',
    queryId: 'query-1',
    sql: 'SELECT count() FROM events',
    elapsedMs: 17,
    rowCount: 1,
    bytes: 8,
    status: 'succeeded',
    progress: { readRows: '1200', readBytes: '4096', elapsedMs: 17 },
    limits: { memory: 1_000_000 },
};

function profile(pipelineEvidence) {
    return buildQueryProfile(run, [], {
        queryLogAvailable: true,
        pipelineAvailable: true,
        pipelineEvidence,
        notice: 'fixture profile',
    });
}

test('native ClickHouse DOT preserves operator topology, labels, and parallel lanes', () => {
    const result = profile([
        'digraph {',
        '  graph [rankdir="TB"];',
        '  node [shape=box];',
        '  subgraph cluster_input {',
        '    label = "Input";',
        '    read [label="ReadFromMergeTree\\n(default.events)"];',
        '    filter [label="FilterTransform × 8"];',
        '  }',
        '  resize [label="Resize 8 → 1"];',
        '  output [label="Output"];',
        '  read -> filter [label="× 8"];',
        '  filter -> resize [label="8 → 1"];',
        '  resize -> output;',
        '}',
    ]).pipeline;

    assert.equal(result.source, 'explain_pipeline');
    assert.deepEqual(
        result.nodes.map(node => node.label),
        ['ReadFromMergeTree (default.events)', 'FilterTransform × 8', 'Resize 8 → 1', 'Output'],
    );
    assert.deepEqual(
        result.nodes.map(node => node.kind),
        ['read', 'filter', 'resize', 'output'],
    );
    assert.equal(result.nodes[1].parallelism, 8);
    assert.equal(result.nodes[1].status, 'planned');
    assert.equal(result.nodes[0].rows, '1200');
    assert.deepEqual(
        result.edges.map(({ source, target, label }) => [source, target, label]),
        [
            ['read', 'filter', '× 8'],
            ['filter', 'resize', '8 → 1'],
            ['resize', 'output', undefined],
        ],
    );
    assert.match(result.notice, /Per-node runtime counters are not available/);
});

test('DOT edge chains and implicit nodes remain connected', () => {
    const result = profile([
        'digraph { a -> b -> c [label="lane"]; b [label="FilterTransform"]; }',
    ]).pipeline;
    assert.deepEqual(
        result.nodes.map(node => node.id),
        ['a', 'b', 'c'],
    );
    assert.deepEqual(
        result.nodes.map(node => node.label),
        ['a', 'FilterTransform', 'c'],
    );
    assert.deepEqual(
        result.edges.map(edge => [edge.source, edge.target, edge.label]),
        [
            ['a', 'b', 'lane'],
            ['b', 'c', 'lane'],
        ],
    );
});

test('legacy indented EXPLAIN PIPELINE output still builds a linear graph', () => {
    const result = profile([
        '(Fixture pipeline)',
        '  ReadFromFixture × 1',
        '    ExpressionTransform × 1',
        '      Output × 1',
    ]).pipeline;
    assert.deepEqual(
        result.nodes.map(node => node.label),
        ['(Fixture pipeline)', 'ReadFromFixture', 'ExpressionTransform', 'Output'],
    );
    assert.deepEqual(
        result.edges.map(edge => [edge.source, edge.target]),
        [
            ['pipeline-1', 'pipeline-2'],
            ['pipeline-2', 'pipeline-3'],
            ['pipeline-3', 'pipeline-4'],
        ],
    );
});

test('large native plans are explicitly bounded for the UI', () => {
    const lines = [
        'digraph {',
        ...Array.from(
            { length: 245 },
            (_, index) => `n${index} [label="ExpressionTransform ${index}"];`,
        ),
        '}',
    ];
    const result = profile(lines).pipeline;
    assert.equal(result.nodes.length, 240);
    assert.equal(result.truncated, true);
    assert.match(result.notice, /bounded to 240 operators/);
});

test('pipeline result graph parses processor topology without inventing run measurements', () => {
    const result = parsePipelineResult([
        'digraph {',
        '  n0[label="ReadFromMergeTree_0"];',
        '  n1[label="FilterTransform_1"];',
        '  n2[label="AggregatingTransform_2"];',
        '  n0 -> n1;',
        '  n1 -> n2;',
        '}',
    ]);
    assert.ok(result);
    assert.equal(result.source, 'explain_pipeline');
    assert.deepEqual(
        result.nodes.map(node => node.label),
        ['ReadFromMergeTree_0', 'FilterTransform_1', 'AggregatingTransform_2'],
    );
    assert.deepEqual(
        result.edges.map(({ source, target }) => [source, target]),
        [
            ['n0', 'n1'],
            ['n1', 'n2'],
        ],
    );
    assert.ok(result.nodes.every(node => node.status === 'planned'));
    assert.ok(
        result.nodes.every(
            node =>
                node.durationMs === undefined &&
                node.rows === undefined &&
                node.bytes === undefined,
        ),
    );
    assert.match(result.notice, /Per-node runtime counters are not available/);
});

test('pipeline result graph declines empty and unrelated output', () => {
    assert.equal(parsePipelineResult([]), undefined);
    assert.equal(parsePipelineResult(['EXPLAIN PIPELINE returned plain text']), undefined);
});
