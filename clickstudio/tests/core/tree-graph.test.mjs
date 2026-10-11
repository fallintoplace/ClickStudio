import assert from 'node:assert/strict';
import test from 'node:test';
import {
    initialExpanded,
    indexTree,
    visibleTree,
} from '../../.core-build/src/frontend/common/components/tree-model.js';
import { buildNativeAstTree } from '../../.core-build/src/frontend/workspace/editor/parser/ast.js';
import { parseQueryTree } from '../../.core-build/src/frontend/workspace/queries/inspection/diagrams/query-tree.js';

function node(id, children = []) {
    return {
        id,
        path: id,
        field: id,
        type: 'QUERY',
        children,
        properties: [],
        propertyCount: 0,
        childCount: children.length,
    };
}

function visibleIds(root) {
    return root ? [root.source.id, ...root.children.flatMap(visibleIds)] : [];
}

test('tree graph expands three levels and indexes collapsed descendants in preorder', () => {
    const leaf = node('leaf');
    const third = node('third', [leaf]);
    const second = node('second', [third]);
    const first = node('first', [second]);
    const root = node('root', [first, node('sibling')]);
    const expanded = initialExpanded(root);
    assert.deepEqual([...expanded], ['root', 'first', 'second']);
    assert.deepEqual(
        [...indexTree(root).keys()],
        ['root', 'first', 'second', 'third', 'leaf', 'sibling'],
    );
    assert.deepEqual(visibleIds(visibleTree(root, expanded).root), [
        'root',
        'first',
        'second',
        'third',
        'sibling',
    ]);
    assert.deepEqual(visibleIds(visibleTree(root, new Set()).root), ['root']);
    assert.equal(visibleTree(root, new Set()).truncated, false);
});

for (const size of [1, 319, 320, 321, 1000]) {
    test(`tree graph preserves the 320-node visibility boundary for ${size} nodes`, () => {
        const children = Array.from({ length: size - 1 }, (_, index) => node(String(index)));
        const root = node('root', children);
        const visible = visibleTree(root, new Set(['root']));
        assert.equal(visibleIds(visible.root).length, Math.min(size, 320));
        assert.equal(visible.truncated, size > 320);
        assert.equal(root.children.length, size - 1);
        assert.equal(visible.root.source, root);
    });
}

test('tree graph keeps native and analyzer preprocessing counts unchanged', () => {
    const native = buildNativeAstTree({
        type: 'SelectQuery',
        children: Array.from({ length: 2100 }, () => ({ type: 'Identifier', name: 'id' })),
    });
    const analyzer = parseQueryTree([
        'QUERY id: 0',
        ...Array.from({ length: 2100 }, (_, index) => `  COLUMN id: ${index + 1}`),
    ]);
    assert.equal(native.nodeCount, 2000);
    assert.equal(native.root.childCount, 2100);
    assert.equal(analyzer.nodeCount, 1000);
    assert.equal(analyzer.root.childCount, 999);
    for (const model of [native, analyzer]) {
        const visible = visibleTree(model.root, initialExpanded(model.root));
        assert.equal(visible.root.source.childCount, model.root.childCount);
        assert.equal(visibleIds(visible.root).length, 320);
        assert.equal(visible.truncated, true);
        assert.equal(model.truncated, true);
    }
});
