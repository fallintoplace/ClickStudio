import test from 'node:test';
import assert from 'node:assert/strict';
import {
    columnStats,
    selectedRowsTsv,
    selectedNumericSummary,
} from '../../.core-build/src/shared/queries/results/column-insights.js';

test('column insights respect nulls and only count safe numeric values', () => {
    const stats = columnStats(
        [['1'], [null], ['3'], ['18446744073709551615']],
        { name: 'id', type: 'UInt64' },
        0,
    );
    assert.equal(stats.total, 4);
    assert.equal(stats.nulls, 1);
    assert.equal(stats.numericCount, 2);
    assert.equal(stats.nonRepresentable, 1);
    assert.equal(stats.average, 2);
    assert.equal(
        stats.histogram.reduce((a, b) => a + b, 0),
        2,
    );
});
test('column insights exclude detached cells and do not expand nested objects', () => {
    const token = 'token';
    const cell = {
        __clickstudioLargeCell: token,
        id: '123e4567-e89b-12d3-a456-426614174000',
        bytes: 400000,
        serializedBytes: 400000,
        fingerprint: 'f'.repeat(64),
        preview: 'large',
        valueType: 'text',
    };
    const stats = columnStats(
        [[cell], [{ nested: 'hello' }], [null]],
        { name: 'v', type: 'String' },
        0,
        token,
    );
    assert.equal(stats.detached, 1);
    assert.equal(stats.nulls, 1);
    assert.deepEqual(stats.common, [{ label: '[Object]', count: 1 }]);
});
test('copy selected cells preserves TSV boundaries and large-number strings', () => {
    const tsv = selectedRowsTsv([['18446744073709551615', 'line\\nwith tab\tand "quote"']], [0, 1]);
    assert.equal(tsv, '18446744073709551615\t"line\\nwith tab\tand ""quote"""');
});

test('distinct counts do not collide on truncated labels or object previews', () => {
    const prefix = 'x'.repeat(130);
    const stats = columnStats(
        [[prefix + 'a'], [prefix + 'b'], [prefix + 'a']],
        { name: 'name', type: 'String' },
        0,
    );
    assert.equal(stats.distinct, 2);
    assert.deepEqual(
        stats.common.map(value => value.count),
        [2, 1],
    );
    const objects = columnStats([[{ x: 1 }], [{ x: 2 }]], { name: 'payload', type: 'JSON' }, 0);
    assert.equal(objects.distinct, 2);
});

test('late common values remain visible after 2,000 earlier unique values', () => {
    const values = Array.from({ length: 2000 }, (_, i) => ['early-' + i]);
    values.push(...Array.from({ length: 500 }, () => ['frequent']));
    const stats = columnStats(values, { name: 'label', type: 'String' }, 0);
    assert.equal(stats.distinct, 2001);
    assert.equal(stats.distinctCapped, false);
    assert.deepEqual(stats.common[0], { label: 'frequent', count: 500 });
});
test('insights suppress common values instead of providing inaccurate capped rankings', () => {
    const values = Array.from({ length: 20001 }, (_, i) => [String(i)]);
    const stats = columnStats(values, { name: 'label', type: 'String' }, 0);
    assert.equal(stats.distinct, 20000);
    assert.equal(stats.distinctCapped, true);
    assert.deepEqual(stats.common, []);
});
test('selected integer totals preserve precision above Number.MAX_SAFE_INTEGER', () => {
    const columns = [{ name: 'value', type: 'UInt64' }];
    const rows = Array.from({ length: 3 }, () => ['9007199254740991']);
    const summary = selectedNumericSummary(rows, [0], columns);
    assert.equal(summary.count, 3);
    assert.equal(summary.sum.replaceAll(',', ''), '27021597764222973');
    assert.equal(summary.average.replaceAll(',', ''), '9007199254740991');
    const wide = selectedNumericSummary([['18446744073709551615']], [0], columns);
    assert.equal(wide.sum.replaceAll(',', ''), '18446744073709551615');
});
test('selected floating-point totals are clearly labeled approximate', () => {
    const columns = [
        { name: 'f', type: 'Float64' },
        { name: 'n', type: 'UInt64' },
    ];
    const stats = selectedNumericSummary([[1.2, '18446744073709551615']], [0, 1], columns);
    assert.equal(stats.count, 2);
    assert.ok(stats.sum.startsWith('≈'));
    assert.ok(stats.average.startsWith('≈'));
});
