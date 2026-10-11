import test from 'node:test';
import assert from 'node:assert/strict';
import { parseExplainIndexAnalysis } from '../../.core-build/src/frontend/workspace/queries/inspection/plans/explain-indexes.js';

const output = [
    'ReadFromMergeTree (default.uk_price_paid)',
    '  Indexes:',
    '    PrimaryKey',
    '      Keys:',
    '        postcode1',
    "      Condition: (postcode1 in ['CR', 'CS'))",
    '      Parts: 36/36',
    '      Granules: 235/29751',
    '    Skip',
    '      Name: postcode_bloom',
    '      Description: Bloom filter for postcode',
    '      Parts: 11/36',
    '      Granules: 72/235',
];

test('ClickHouse EXPLAIN INDEXES output becomes an index path with reported pruning counts', () => {
    const analysis = parseExplainIndexAnalysis(output.map(line => [line]));
    assert.ok(analysis);
    assert.equal(analysis.indexCount, 2);
    assert.deepEqual(
        analysis.pipeline.nodes.map(node => node.label),
        [
            'ReadFromMergeTree (default.uk_price_paid)',
            'PrimaryKey',
            'postcode_bloom',
            'Read selected granules',
        ],
    );
    assert.deepEqual(analysis.pipeline.edges, [
        { source: 'index-read-0', target: 'index-0-0' },
        { source: 'index-0-0', target: 'index-0-1' },
        { source: 'index-0-1', target: 'index-output-0' },
    ]);
    assert.deepEqual(analysis.steps.get('index-0-0')?.properties, [
        { name: 'Keys', value: 'postcode1' },
        { name: 'Condition', value: "(postcode1 in ['CR', 'CS'))" },
        { name: 'Parts', value: '36/36' },
        { name: 'Granules', value: '235/29751' },
    ]);
    assert.deepEqual(analysis.steps.get('index-0-0')?.granules, {
        selected: '235',
        total: '29751',
        percent: 0.8,
    });
    assert.deepEqual(analysis.steps.get('index-0-1')?.granules, {
        selected: '72',
        total: '235',
        percent: 30.6,
    });
    assert.equal(analysis.pipeline.nodes[1]?.detail, '0.8% remain');
    assert.equal(analysis.truncated, false);
});

test('EXPLAIN INDEXES output can arrive as one multiline cell', () => {
    const analysis = parseExplainIndexAnalysis([[output.join('\n')]]);
    assert.ok(analysis);
    assert.equal(analysis.indexCount, 2);
    assert.equal(analysis.steps.get('index-0-1')?.name, 'postcode_bloom');
});

test('Multiple MergeTree reads are kept as separate index paths', () => {
    const analysis = parseExplainIndexAnalysis([
        ['ReadFromMergeTree (db.first)'],
        ['  Indexes:'],
        ['    PrimaryKey'],
        ['      Granules: 1/10'],
        ['ReadFromMergeTree (db.second)'],
        ['  Indexes:'],
        ['    MinMax'],
        ['      Granules: 2/20'],
    ]);
    assert.ok(analysis);
    assert.equal(analysis.indexCount, 2);
    assert.deepEqual(
        analysis.pipeline.nodes.filter(node => node.kind === 'read').map(node => node.label),
        ['ReadFromMergeTree (db.first)', 'ReadFromMergeTree (db.second)'],
    );
    assert.equal(analysis.pipeline.edges[0]?.source, 'index-read-0');
    assert.equal(analysis.pipeline.edges[2]?.source, 'index-read-1');
});

test('Malformed, empty, and non-index explain output falls back safely', () => {
    for (const rows of [[], [['']], [['ReadFromMergeTree (db.table)']], [['Indexes:']]])
        assert.equal(parseExplainIndexAnalysis(rows), undefined);
});

test('Index analysis bounds large payloads and graph nodes', () => {
    const largePayload = parseExplainIndexAnalysis([
        [
            'ReadFromMergeTree (db.table)\n  Indexes:\n    PrimaryKey\n      Granules: 1/2\n' +
                'x'.repeat(1_000_000),
        ],
    ]);
    assert.ok(largePayload);
    assert.equal(largePayload.truncated, true);

    const manyIndexes = [
        'ReadFromMergeTree (db.table)',
        '  Indexes:',
        ...Array.from({ length: 400 }, (_, index) => `    Index${index}\n      Granules: 1/2`),
    ].join('\n');
    const bounded = parseExplainIndexAnalysis([[manyIndexes]]);
    assert.ok(bounded);
    assert.equal(bounded.truncated, true);
    assert.ok(bounded.pipeline.nodes.length <= 120);
});
