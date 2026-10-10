import assert from 'node:assert/strict';
import test from 'node:test';
import { getCopy } from '../../.workspace-build/web/i18n.js';
import { prepareChartSelection } from '../../.workspace-build/web/components/chart/chart-selection.js';
import { prepareChartView } from '../../.workspace-build/web/components/chart/chart-view-model.js';
import {
    heatmapCellKey,
    MAX_CHART_RENDER_POINTS,
    MAX_CHART_SERIES,
} from '../../.workspace-build/shared/results.js';

function result(columns, rows) {
    return {
        columns: columns.map(([name, type]) => ({ name, type })),
        rows,
        completeness: 'complete',
        totalRows: rows.length,
    };
}

function prepare(data, overrides = {}, width = 652, locale = 'en') {
    const chart = { kind: 'line', x: 0, ys: [1], title: 'Query result', ...overrides };
    return prepareChartView({
        result: data,
        chart,
        chartCopy: getCopy(locale).chart,
        locale,
        categoryViewportWidth: width,
        selection: prepareChartSelection(data, chart),
    });
}

test('Chart preparation keeps valid saved measures and repairs unavailable axes', () => {
    const data = result(
        [
            ['name', 'String'],
            ['first', 'Float64'],
            ['second', 'Float64'],
        ],
        [['a', 10, 20]],
    );
    const view = prepare(data, { x: 999, ys: [2, 2, 99, 0] });
    assert.equal(view.xIndex, 0);
    assert.deepEqual(view.measureIndexes, [2]);
    assert.deepEqual(view.availableMeasures, [1, 2]);
});

test('Saved multi-series charts respect the rendering limit and reuse series colors', () => {
    const measures = Array.from({ length: MAX_CHART_SERIES + 5 }, (_, index) => index + 1);
    const data = result(
        [['name', 'String'], ...measures.map(index => [`value_${index}`, 'Float64'])],
        [['a', ...measures]],
    );
    const view = prepare(data, { ys: measures });
    assert.equal(view.measureIndexes.length, MAX_CHART_SERIES);
    assert.equal(view.svg.plotSeries[0].color, view.svg.plotSeries[5].color);
});

test('Scatter charts use one measure and select another numeric column for X', () => {
    const data = result(
        [
            ['label', 'String'],
            ['x', 'Float64'],
            ['y', 'Float64'],
        ],
        [['a', 10, 20]],
    );
    const view = prepare(data, { kind: 'scatter', x: 0, ys: [2, 1] });
    assert.equal(view.xIndex, 1);
    assert.deepEqual(view.measureIndexes, [2]);
});

test('Positive and negative measures share the same zero baseline', () => {
    const view = prepare(
        result(
            [
                ['x', 'UInt64'],
                ['y', 'Float64'],
            ],
            [
                [1, -10],
                [2, 10],
            ],
        ),
    );
    assert.deepEqual(
        view.chartYTicks.map(tick => tick.value),
        [10, 0, -10],
    );
    assert.equal(view.svg.zeroY, 115);
    assert.equal(view.svg.y(-10), 190);
    assert.equal(view.svg.y(10), 40);
});

test('NULL and invalid measures keep their gaps without contributing to the value range', () => {
    const view = prepare(
        result(
            [
                ['x', 'UInt64'],
                ['y', 'Nullable(Float64)'],
            ],
            [
                [1, null],
                [2, 'bad'],
                [3, 5],
            ],
        ),
    );
    assert.deepEqual(view.values, [5]);
    assert.deepEqual(
        view.svg.plotSeries[0].points.map(point => point.value),
        [null, null, 5],
    );
});

for (const rows of [[], [[0, 0]], [[0, null]]]) {
    test(`Empty or flat chart data keeps finite geometry with ${JSON.stringify(rows)}`, () => {
        const view = prepare(
            result(
                [
                    ['x', 'UInt64'],
                    ['y', 'Nullable(Float64)'],
                ],
                rows,
            ),
        );
        assert.equal(view.svg.zeroY, 190);
        assert.ok(view.chartYTicks.every(tick => Number.isFinite(tick.position)));
        assert.ok(Number.isFinite(view.svg.x(0)));
        assert.ok(Number.isFinite(view.svg.y(0)));
    });
}

test('Scatter plots exclude points with an invalid coordinate', () => {
    const view = prepare(
        result(
            [
                ['x', 'Nullable(Float64)'],
                ['y', 'Nullable(Float64)'],
            ],
            [
                [1, 2],
                [null, 3],
                [4, null],
                ['bad', 5],
                [6, 'bad'],
            ],
        ),
        { kind: 'scatter' },
    );
    assert.deepEqual(view.svg.scatterPoints, [{ x: 1, y: 2, label: '1' }]);
    assert.equal(view.scatterSummary, '1 plotted points');
});

test('A zero-only scatter plot centers its point and collapses duplicate ticks', () => {
    const view = prepare(
        result(
            [
                ['x', 'Float64'],
                ['y', 'Float64'],
            ],
            [[0, 0]],
        ),
        {
            kind: 'scatter',
        },
    );
    assert.equal(view.svg.scatterX(0), 406);
    assert.equal(view.svg.scatterY(0), 115);
    assert.deepEqual(view.chartYTicks, [{ value: 0, position: 115 }]);
    assert.deepEqual(view.svg.chartXTicks, [{ label: '0', position: 406 }]);
});

test('Continuous charts sample large results while retaining both endpoints', () => {
    const rows = Array.from({ length: 600 }, (_, index) => [index, index * 2]);
    const view = prepare(
        result(
            [
                ['x', 'UInt64'],
                ['y', 'UInt64'],
            ],
            rows,
        ),
    );
    assert.equal(view.chartRows.length, MAX_CHART_RENDER_POINTS);
    assert.deepEqual(view.chartRows[0], rows[0]);
    assert.deepEqual(view.chartRows.at(-1), rows.at(-1));
    assert.match(view.rowSummary, /240.*600/);
});

test('Categorical charts retain every category and make room for long labels', () => {
    const rows = Array.from({ length: 300 }, (_, index) => [`long category label ${index}`, index]);
    const view = prepare(
        result(
            [
                ['name', 'String'],
                ['value', 'UInt64'],
            ],
            rows,
        ),
    );
    assert.equal(view.chartRows, rows);
    assert.equal(view.svg.chartXTicks.length, rows.length);
    assert.ok(view.svg.plotRight > 300 * 72);
});

test('Categorical viewport changes update geometry without changing measures or rows', () => {
    const data = result(
        [
            ['name', 'String'],
            ['value', 'UInt64'],
        ],
        [
            ['a', 1],
            ['b', 2],
        ],
    );
    const narrow = prepare(data);
    const wide = prepare(data, {}, 1200);
    assert.equal(wide.svg.plotRight, 1200);
    assert.ok(wide.svg.x(1) > narrow.svg.x(1));
    assert.deepEqual(wide.measureIndexes, narrow.measureIndexes);
    assert.equal(wide.chartRows, narrow.chartRows);
});

test('Heatmap axes avoid the measure and recover a conflicting breakdown', () => {
    const data = result(
        [
            ['day', 'String'],
            ['hour', 'String'],
            ['value', 'Float64'],
        ],
        [['Mon', '10', 3]],
    );
    const view = prepare(data, { kind: 'heatmap', ys: [2], groupBy: 0 });
    assert.equal(view.xIndex, 0);
    assert.equal(view.groupByIndex, 1);
    assert.equal(view.yIndex, 2);
});

test('Heatmaps combine repeated cells and sort dimension labels naturally', () => {
    const view = prepare(
        result(
            [
                ['day', 'String'],
                ['hour', 'String'],
                ['value', 'Float64'],
            ],
            [
                ['day10', 'hour2', 3],
                ['day2', 'hour2', 4],
                ['day2', 'hour2', 5],
            ],
        ),
        { kind: 'heatmap', ys: [2], groupBy: 1 },
    );
    assert.deepEqual(view.heatmapXLabels, ['day2', 'day10']);
    assert.equal(view.heatmap.cells.get(heatmapCellKey('day2', 'hour2')), 9);
    assert.equal(view.heatmapMaximum, 9);
});

test('Heatmaps keep returned NULL cells distinct from missing combinations', () => {
    const view = prepare(
        result(
            [
                ['day', 'String'],
                ['hour', 'String'],
                ['value', 'Nullable(Float64)'],
            ],
            [
                ['Mon', '10', null],
                ['Tue', '11', 3],
            ],
        ),
        { kind: 'heatmap', ys: [2], groupBy: 1 },
    );
    const key = heatmapCellKey('Mon', '10');
    assert.equal(view.heatmap.present.has(key), true);
    assert.equal(view.heatmap.cells.has(key), false);
    assert.equal(view.heatmap.present.has(heatmapCellKey('Mon', '11')), false);
});

test('Heatmaps stop preparing labels when their cell budget is exceeded', () => {
    const rows = Array.from({ length: 1000 }, (_, index) => [`x${index}`, `y${index}`, index]);
    const view = prepare(
        result(
            [
                ['x', 'String'],
                ['y', 'String'],
                ['value', 'Float64'],
            ],
            rows,
        ),
        {
            kind: 'heatmap',
            ys: [2],
            groupBy: 1,
        },
    );
    assert.equal(view.heatmapTooLarge, true);
    assert.deepEqual(view.heatmapXLabels, []);
    assert.deepEqual(view.heatmapYLabels, []);
});

test('Chart summaries follow the selected locale and preserve custom titles', () => {
    const data = result(
        [
            ['x', 'UInt64'],
            ['y', 'UInt64'],
        ],
        [[1, 2]],
    );
    assert.equal(prepare(data).chartTitle, undefined);
    assert.equal(prepare(data, { title: 'Revenue' }).chartTitle, 'Revenue');
    assert.notEqual(prepare(data, {}, 652, 'zh').rowSummary, prepare(data).rowSummary);
});

test('Candlestick selection finds the time axis and rejects overlapping or invalid mappings', () => {
    const data = result(
        [
            ['time', 'DateTime'],
            ['open', 'Float64'],
            ['high', 'Float64'],
            ['low', 'Float64'],
            ['close', 'Float64'],
        ],
        [['2026-01-01', 10, 12, 9, 11]],
    );
    const valid = {
        kind: 'candlestick',
        x: 99,
        ys: [],
        candlestick: { open: 1, high: 2, low: 3, close: 4 },
    };
    assert.equal(prepareChartSelection(data, valid).candleX, 0);
    assert.equal(prepareChartSelection(data, valid).activeCandleValid, true);
    for (const close of [1, -1, 99, 1.5, undefined]) {
        const chart = { ...valid, candlestick: { ...valid.candlestick, close } };
        assert.equal(prepareChartSelection(data, chart).activeCandleValid, false);
    }
});

test('Preparing a chart preserves frozen result data and saved configuration', () => {
    const data = result(
        [
            ['x', 'UInt64'],
            ['y', 'Float64'],
        ],
        [[1, 2]],
    );
    Object.freeze(data.rows[0]);
    Object.freeze(data.rows);
    data.columns.forEach(Object.freeze);
    Object.freeze(data.columns);
    Object.freeze(data);
    const ys = Object.freeze([1]);
    const view = prepare(data, { ys });
    assert.equal(view.chart.ys, ys);
    assert.equal(view.result, data);
});
