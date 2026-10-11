import assert from 'node:assert/strict';
import test from 'node:test';

const { buildNativeAstTree, walkNativeAst } =
    await import('../../.core-build/src/frontend/workspace/editor/parser/ast.js');

const ast = {
    type: 'SelectWithUnionQuery',
    union_mode: 'UNION_DEFAULT',
    list_of_selects: {
        type: 'ExpressionList',
        children: [
            {
                type: 'SelectQuery',
                select: {
                    type: 'ExpressionList',
                    children: [
                        {
                            type: 'Function',
                            name: 'uniqExact',
                            arguments: {
                                type: 'ExpressionList',
                                children: [{ type: 'Identifier', name: 'user_id' }],
                            },
                        },
                        { type: 'Literal', value: { field_type: 'UInt64', value: 1 } },
                    ],
                },
                tables: {
                    type: 'TablesInSelectQuery',
                    children: [{ type: 'TableIdentifier', name_parts: ['analytics', 'events'] }],
                },
            },
        ],
    },
};

test('native AST walker keeps preorder, skips literal payloads, and respects its budget', () => {
    const types = [];
    const result = walkNativeAst(ast, node => {
        if (typeof node.type === 'string') types.push(node.type);
    });
    assert.equal(result.truncated, false);
    assert.deepEqual(types.slice(0, 5), [
        'SelectWithUnionQuery',
        'ExpressionList',
        'SelectQuery',
        'ExpressionList',
        'Function',
    ]);

    const literalObjects = [];
    walkNativeAst(
        { type: 'Literal', value: { field_type: 'Map', value: { nested: true } } },
        node => literalObjects.push(node),
    );
    assert.equal(literalObjects.length, 1);

    const capped = walkNativeAst(ast, () => undefined, { maxNodes: 3 });
    assert.deepEqual(capped, { visited: 3, truncated: true });
});

test('native AST tree keeps ClickHouse fields, stable paths, summaries, and truncation', () => {
    const tree = buildNativeAstTree(ast);
    assert.equal(tree.truncated, false);
    assert.equal(tree.root?.type, 'SelectWithUnionQuery');
    assert.equal(
        tree.root?.properties.find(property => property.name === 'union_mode')?.value,
        'UNION_DEFAULT',
    );

    const selectList = tree.root?.children[0];
    assert.equal(selectList?.path, '$.list_of_selects');
    const select = selectList?.children[0];
    assert.equal(select?.path, '$.list_of_selects.children[0]');
    const functionNode = select?.children
        .find(node => node.field === 'select')
        ?.children.find(node => node.type === 'Function');
    assert.equal(functionNode?.summary, 'uniqExact');
    const table = select?.children
        .find(node => node.field === 'tables')
        ?.children.find(node => node.type === 'TableIdentifier');
    assert.equal(table?.summary, 'analytics.events');

    const capped = buildNativeAstTree(ast, { maxNodes: 4 });
    assert.equal(capped.nodeCount, 4);
    assert.equal(capped.truncated, true);
});
