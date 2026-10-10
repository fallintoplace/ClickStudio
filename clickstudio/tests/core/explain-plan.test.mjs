import test from 'node:test';
import assert from 'node:assert/strict';
import {
    explainPrefixLength,
    parseExplainPlan,
    sqlForRunKind,
} from '../../.core-build/shared/explain-plan.js';

const response = JSON.stringify([
    {
        Plan: {
            'Node Type': 'Expression',
            'Node Id': 'Expression_5',
            Description: 'Project names',
            'Read rows': 3,
            Indexes: { PrimaryKey: { Parts: 1, Granules: 1 } },
            Plans: [
                {
                    'Node Type': 'ReadFromMergeTree',
                    'Node Id': 'ReadFromMergeTree_0',
                    Description: 'default.events',
                },
            ],
        },
    },
]);

test('ClickHouse JSON plan keeps the root, nested steps, scalar facts, and structured details', () => {
    const plan = parseExplainPlan(response);
    assert.ok(plan);
    assert.equal(plan.nodeCount, 2);
    assert.equal(plan.root.type, 'Expression');
    assert.equal(plan.root.id, 'Expression_5');
    assert.equal(plan.root.description, 'Project names');
    assert.deepEqual(plan.root.properties, [
        { name: 'Read rows', value: 3 },
        { name: 'Indexes', value: { PrimaryKey: { Parts: 1, Granules: 1 } } },
    ]);
    assert.equal(plan.root.children[0].type, 'ReadFromMergeTree');
});

for (const value of [
    undefined,
    null,
    '',
    'not json',
    '{}',
    '[]',
    '[{}]',
    '[{"Plan": []}]',
    '[{"Plan": {"Node Type":"Expression"}},{"Plan":{}}]',
])
    test(`Unsupported explain-plan shape falls back safely: ${String(value).slice(0, 30)}`, () =>
        assert.equal(parseExplainPlan(value), undefined));

test('Plan parsing is bounded by node count and marks omitted operators', () => {
    const children = Array.from({ length: 520 }, (_, index) => ({
        'Node Type': 'Expression',
        'Node Id': `Expression_${index}`,
    }));
    const plan = parseExplainPlan(
        JSON.stringify([{ Plan: { 'Node Type': 'Union', Plans: children } }]),
    );
    assert.ok(plan);
    assert.equal(plan.nodeCount, 500);
    assert.equal(plan.root.children.length, 499);
    assert.equal(plan.truncated, true);
});

test('Plan parsing bounds deeply nested trees', () => {
    let root = { 'Node Type': 'Leaf' };
    for (let index = 0; index < 80; index++) root = { 'Node Type': `Step${index}`, Plans: [root] };
    const plan = parseExplainPlan(JSON.stringify([{ Plan: root }]));
    assert.ok(plan);
    assert.equal(plan.truncated, true);
    assert.ok(plan.nodeCount < 80);
});

test('Plan parser rejects oversized payloads before JSON parsing', () => {
    assert.equal(parseExplainPlan(' '.repeat(2_000_001)), undefined);
});

test('Run actions produce the appropriate server SQL while preserving normal SQL', () => {
    const statement = 'SELECT count() FROM events';
    assert.equal(sqlForRunKind(statement, 'query'), statement);
    assert.equal(sqlForRunKind(statement, 'explain'), `EXPLAIN indexes = 1\n${statement}`);
    assert.equal(
        sqlForRunKind(statement, 'plan'),
        `EXPLAIN PLAN json = 1, indexes = 1, description = 1\n${statement}`,
    );
    assert.equal(
        sqlForRunKind(statement, 'pipeline'),
        `EXPLAIN PIPELINE graph = 1, compact = 0\n${statement}`,
    );
    assert.equal(sqlForRunKind(statement, 'analyze'), `EXPLAIN ANALYZE\n${statement}`);
    assert.equal(
        explainPrefixLength('plan'),
        'EXPLAIN PLAN json = 1, indexes = 1, description = 1\n'.length,
    );
    assert.equal(explainPrefixLength('analyze'), 'EXPLAIN ANALYZE\n'.length);
});
