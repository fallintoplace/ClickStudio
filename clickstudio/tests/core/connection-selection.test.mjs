import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveConnectionSelection } from '../../.core-build/shared/connection-selection.js';

test('A fresh local workspace selects the public Playground', () => {
    assert.equal(resolveConnectionSelection([{ id: 'local' }, { id: 'playground' }], ''), 'playground');
});

test('An explicit connection selection stays active', () => {
    assert.equal(resolveConnectionSelection([{ id: 'local' }, { id: 'playground' }], 'local'), 'local');
});

test('A connection list without Playground falls back to its first connection', () => {
    assert.equal(resolveConnectionSelection([{ id: 'local' }, { id: 'cloud' }], 'missing'), 'local');
});

test('An empty connection list resolves to no selection', () => {
    assert.equal(resolveConnectionSelection([], 'missing'), '');
});
