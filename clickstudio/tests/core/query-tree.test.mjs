import assert from 'node:assert/strict';
import test from 'node:test';

const { parseQueryTree } = await import('../../.core-build/shared/query-tree.js');

test('query tree parser preserves ClickHouse semantic nodes and resolved fields', () => {
    const tree = parseQueryTree([
        'QUERY id: 0',
        '  PROJECTION COLUMNS',
        '    id UInt64',
        '    value String',
        '  PROJECTION',
        '    LIST id: 1, nodes: 2',
        '      COLUMN id: 2, column_name: id, result_type: UInt64, source_id: 3',
        '      FUNCTION id: 4, function_name: lower, function_type: ordinary, result_type: String',
        '        ARGUMENTS',
        '          LIST id: 5, nodes: 1',
        '            COLUMN id: 6, column_name: value, result_type: String, source_id: 3',
        '  JOIN TREE',
        '    TABLE id: 3, table_name: default.test_table',
    ]);
    assert.equal(tree.root?.type, 'QUERY');
    assert.equal(tree.nodeCount, 13);
    const projection = tree.root?.children.find(node => node.type === 'PROJECTION');
    assert.equal(projection?.children[0]?.type, 'LIST');
    assert.equal(projection?.children[0]?.children[0]?.summary, 'id · UInt64');
    assert.equal(projection?.children[0]?.children[1]?.summary, 'lower() · String');
    const join = tree.root?.children.find(node => node.type === 'JOIN TREE');
    assert.equal(join?.children[0]?.summary, 'default.test_table');
    assert.deepEqual(join?.children[0]?.properties, [
        { name: 'id', value: '3' },
        { name: 'table_name', value: 'default.test_table' },
    ]);
});

test('query tree parser keeps nested comma types intact', () => {
    const tree = parseQueryTree([
        'QUERY id: 0',
        '  PROJECTION',
        '    COLUMN id: 1, column_name: payload, result_type: Tuple(String, Array(UInt64)), source_id: 2',
    ]);
    const column = tree.root?.children[0]?.children[0];
    assert.equal(column?.summary, 'payload · Tuple(String, Array(UInt64))');
    assert.equal(
        column?.properties.find(item => item.name === 'result_type')?.value,
        'Tuple(String, Array(UInt64))',
    );
});

test('query tree parser bounds oversized analyzer output', () => {
    const tree = parseQueryTree(
        [
            'QUERY id: 0',
            ...Array.from(
                { length: 20 },
                (_, index) =>
                    '  COLUMN id: ' +
                    (index + 1) +
                    ', column_name: c' +
                    index +
                    ', result_type: UInt64',
            ),
        ],
        { maxNodes: 5 },
    );
    assert.equal(tree.nodeCount, 5);
    assert.equal(tree.truncated, true);
    assert.equal(tree.root?.children.length, 4);
});
