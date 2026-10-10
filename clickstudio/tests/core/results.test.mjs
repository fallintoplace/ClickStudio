import assert from 'node:assert/strict';
import test from 'node:test';
import { heatmapCellKey, prepareHeatmap } from '../../.core-build/shared/results.js';

test('Heatmap sums duplicate X/Y cells from retained rows', () => {
    const prepared = prepareHeatmap(
        [
            ['Mon', '10:00', 5],
            ['Mon', '10:00', 7],
            ['Tue', '10:00', 3],
        ],
        1,
        0,
        2,
    );
    assert.equal(prepared.tooLarge, false);
    assert.equal(prepared.combinedRows, 1);
    assert.equal(prepared.cells.get(heatmapCellKey('10:00', 'Mon')), 12);
    assert.equal(prepared.cells.get(heatmapCellKey('10:00', 'Tue')), 3);
    assert.equal(prepared.maximum, 12);
});

test('Heatmap keeps returned NULL cells distinct from missing groups', () => {
    const prepared = prepareHeatmap([['Mon', '10:00', null]], 1, 0, 2);
    const key = heatmapCellKey('10:00', 'Mon');
    assert.equal(prepared.present.has(key), true);
    assert.equal(prepared.cells.has(key), false);
});

test('Heatmap cell keys cannot collide on separator-like data', () => {
    assert.notEqual(heatmapCellKey('a\u0000b', 'c'), heatmapCellKey('a', 'b\u0000c'));
});

test('Heatmap stops scanning once the rendered grid exceeds its cell budget', () => {
    const poison = [];
    Object.defineProperty(poison, 0, {
        get() {
            throw new Error('rows after the limit must not be inspected');
        },
    });
    const prepared = prepareHeatmap(
        [['x1', 'y1', 1], ['x2', 'y1', 1], ['x1', 'y2', 1], ['x3', 'y2', 1], poison],
        0,
        1,
        2,
        4,
    );
    assert.equal(prepared.tooLarge, true);
    assert.ok(prepared.xLabels.length * prepared.yLabels.length > 4);
});
