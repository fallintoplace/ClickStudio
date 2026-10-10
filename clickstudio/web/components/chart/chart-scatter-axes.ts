import type { ChartKind } from '../../../shared/chart-types.js';
import { chartNumber, displayValue } from '../../../shared/results.js';
import type { Result, Row } from '../../../shared/types.js';
import type { Copy, Locale } from '../../i18n.js';
import { chartText, formatCount } from '../chart-helpers.js';

export function prepareScatterAxes({
    chartRows,
    xIndex,
    yIndex,
    chartCopy,
    locale,
    result,
    rowSummary,
    plotLeft,
    plotRight,
    plotWidth,
    plotMiddle,
    plotBottom,
    plotHeight,
    chartKind,
    plotTop,
    min,
    max,
    compactNumber,
    categoricalAxis,
    plotSeries,
    x,
}: {
    chartRows: Row[];
    xIndex: number;
    yIndex: number;
    chartCopy: Copy['chart'];
    locale: Locale;
    result: Result;
    rowSummary: string;
    plotLeft: number;
    plotRight: number;
    plotWidth: number;
    plotMiddle: number;
    plotBottom: number;
    plotHeight: number;
    chartKind: Exclude<ChartKind, 'table'>;
    plotTop: number;
    min: number;
    max: number;
    compactNumber: Intl.NumberFormat;
    categoricalAxis: boolean;
    plotSeries: {
        columnIndex: number;
        color: 'var(--accent)' | 'var(--green)' | 'var(--amber)' | 'var(--red)' | 'var(--violet)';
        points: { label: string; value: number | null; index: number }[];
    }[];
    x: (index: number) => number;
}) {
    const scatterPoints = chartRows
        .map(row => ({
            x: chartNumber(row[xIndex]),
            y: chartNumber(row[yIndex]),
            label: displayValue(row[xIndex]),
        }))
        .filter(
            (point): point is { x: number; y: number; label: string } =>
                point.x !== null && point.y !== null,
        );
    const scatterSummary = `${chartText(chartCopy.plottedPoints, { points: formatCount(scatterPoints.length, locale) })}${chartRows.length < result.rows.length ? ` · ${rowSummary}` : ''}`;
    const scatterMinX = Math.min(...scatterPoints.map(point => point.x), 0);
    const scatterMaxX = Math.max(...scatterPoints.map(point => point.x), 0);
    const scatterMinY = Math.min(...scatterPoints.map(point => point.y), 0);
    const scatterMaxY = Math.max(...scatterPoints.map(point => point.y), 0);
    const scatterRangeX = scatterMaxX - scatterMinX || 1;
    const scatterRangeY = scatterMaxY - scatterMinY || 1;
    const scatterX = (value: number) =>
        scatterMinX === scatterMaxX
            ? (plotLeft + plotRight) / 2
            : plotLeft + ((value - scatterMinX) / scatterRangeX) * plotWidth;
    const scatterY = (value: number) =>
        scatterMinY === scatterMaxY
            ? plotMiddle
            : plotBottom - ((value - scatterMinY) / scatterRangeY) * plotHeight;
    const chartYTicks =
        chartKind === 'scatter'
            ? scatterMinY === scatterMaxY
                ? [{ value: scatterMinY, position: plotMiddle }]
                : [
                      { value: scatterMaxY, position: plotTop },
                      { value: (scatterMinY + scatterMaxY) / 2, position: plotMiddle },
                      { value: scatterMinY, position: plotBottom },
                  ]
            : min === max
              ? [{ value: min, position: plotBottom }]
              : [
                    { value: max, position: plotTop },
                    { value: (min + max) / 2, position: plotMiddle },
                    { value: min, position: plotBottom },
                ];
    const chartXTicks =
        chartKind === 'scatter'
            ? scatterMinX === scatterMaxX
                ? [
                      {
                          label: compactNumber.format(scatterMinX),
                          position: (plotLeft + plotRight) / 2,
                      },
                  ]
                : [
                      { label: compactNumber.format(scatterMinX), position: plotLeft },
                      {
                          label: compactNumber.format((scatterMinX + scatterMaxX) / 2),
                          position: (plotLeft + plotRight) / 2,
                      },
                      { label: compactNumber.format(scatterMaxX), position: plotRight },
                  ]
            : categoricalAxis
              ? (plotSeries[0]?.points.map((point, index) => ({
                    label: point.label,
                    position: x(index),
                })) ?? [])
              : [...new Set([0, Math.floor((chartRows.length - 1) / 2), chartRows.length - 1])].map(
                    index => ({
                        label: plotSeries[0]?.points[index]?.label ?? '',
                        position: x(index),
                    }),
                );
    return { chartYTicks, scatterPoints, scatterX, scatterY, chartXTicks, scatterSummary };
}
