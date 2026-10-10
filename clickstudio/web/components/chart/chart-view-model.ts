import {
    chartNumber,
    displayValue,
    MAX_CHART_RENDER_POINTS,
    MAX_CHART_SERIES,
    numericType,
    prepareHeatmap,
    sampleChartRows,
    temporalType,
} from '../../../shared/results.js';
import type { Result } from '../../../shared/types.js';
import type { Draft } from '../../workspace-state.js';
import type { Copy, Locale } from '../../i18n.js';
import {
    categoryAxisLayout,
    chartText,
    chartTypeLabel,
    formatCount,
    seriesColor,
} from '../chart-helpers.js';
import type { prepareChartSelection } from './chart-selection.js';
import type { ChartSvgModel } from './chart-svg-model.js';
import { prepareScatterAxes } from './chart-scatter-axes.js';

export function prepareChartView({
    result,
    chart,
    chartCopy,
    locale,
    categoryViewportWidth,
    selection,
}: {
    result: Result;
    chart: Draft['chart'];
    chartCopy: Copy['chart'];
    locale: Locale;
    categoryViewportWidth: number;
    selection: ReturnType<typeof prepareChartSelection>;
}) {
    const { suggestion, numericIndexes, inferredCandle, canChooseCandlestick, candleX } = selection;
    const chartKind =
        chart.kind === 'table'
            ? suggestion.config.kind === 'table'
                ? 'bar'
                : suggestion.config.kind
            : chart.kind;
    const configuredMeasures = [
        ...new Set(chart.ys.filter(index => numericIndexes.includes(index))),
    ].slice(0, MAX_CHART_SERIES);
    const suggestedMeasure =
        suggestion.config.ys.find(index => numericIndexes.includes(index)) ?? numericIndexes[0];
    const initialMeasure = configuredMeasures[0] ?? suggestedMeasure ?? 0;
    const validChartIndex = (index: number | undefined) =>
        Number.isSafeInteger(index) && index! >= 0 && index! < result.columns.length;
    const initialGroupBy =
        chart.groupBy !== undefined &&
        validChartIndex(chart.groupBy) &&
        chart.groupBy !== chart.x &&
        chart.groupBy !== initialMeasure
            ? chart.groupBy
            : result.columns.findIndex(
                  (_column, index) => index !== chart.x && index !== initialMeasure,
              );
    const allowedX = (index: number) =>
        chartKind === 'scatter'
            ? numericIndexes.includes(index) && index !== initialMeasure
            : chartKind === 'heatmap'
              ? index !== initialMeasure && index !== initialGroupBy
              : index !== initialMeasure;
    const fallbackX = result.columns.findIndex((_column, index) => allowedX(index));
    const xIndex =
        validChartIndex(chart.x) && allowedX(chart.x) ? chart.x : fallbackX >= 0 ? fallbackX : 0;
    const candidateGroupBy =
        chartKind === 'heatmap'
            ? chart.groupBy !== undefined &&
              validChartIndex(chart.groupBy) &&
              chart.groupBy !== xIndex &&
              chart.groupBy !== initialMeasure
                ? chart.groupBy
                : result.columns.findIndex(
                      (_column, index) => index !== xIndex && index !== initialMeasure,
                  )
            : -1;
    const groupByIndex = candidateGroupBy >= 0 ? candidateGroupBy : undefined;
    const availableMeasures = numericIndexes.filter(
        index => index !== xIndex && index !== groupByIndex,
    );
    const usableConfiguredMeasures = configuredMeasures.filter(index =>
        availableMeasures.includes(index),
    );
    const defaultMeasure = availableMeasures.includes(suggestedMeasure ?? -1)
        ? suggestedMeasure!
        : (availableMeasures[0] ?? 0);
    const selectedMeasures = usableConfiguredMeasures.length
        ? usableConfiguredMeasures
        : [defaultMeasure];
    const measureIndexes =
        chartKind === 'line' || chartKind === 'bar'
            ? selectedMeasures
            : selectedMeasures.slice(0, 1);
    const yIndex = measureIndexes[0] ?? 0;
    const xType = result.columns[xIndex]?.type ?? '';
    const categoricalAxis =
        chartKind === 'bar' ||
        (chartKind === 'line' && !numericType(xType) && !temporalType(xType));
    const chartRows =
        chartKind === 'heatmap'
            ? []
            : categoricalAxis
              ? result.rows
              : sampleChartRows(result.rows, MAX_CHART_RENDER_POINTS);
    const plotSeries = measureIndexes.map((columnIndex, seriesIndex) => ({
        columnIndex,
        color: seriesColor(seriesIndex),
        points: chartRows.map((row, index) => ({
            label: displayValue(row[xIndex]),
            value: chartNumber(row[columnIndex]),
            index,
        })),
    }));
    const categoryLayout = categoricalAxis
        ? categoryAxisLayout(
              plotSeries[0]?.points.map(point => point.label) ?? [],
              Math.max(652, categoryViewportWidth),
          )
        : undefined;
    const values = plotSeries.flatMap(series =>
        series.points.flatMap(point => (point.value === null ? [] : [point.value])),
    );
    const min = Math.min(0, ...values),
        max = Math.max(0, ...values),
        range = max - min || 1;
    const plotLeft = categoricalAxis ? 0 : 80,
        plotRight = categoryLayout?.width ?? 732,
        plotWidth = plotRight - plotLeft;
    const plotTop = 40,
        plotMiddle = 115,
        plotBottom = 190,
        plotHeight = plotBottom - plotTop;
    const zeroY = plotBottom - ((0 - min) / range) * plotHeight;
    const y = (value: number) => plotBottom - ((value - min) / range) * plotHeight;
    const x = (index: number) =>
        categoryLayout?.positions[index] ??
        (chartRows.length <= 1
            ? (plotLeft + plotRight) / 2
            : plotLeft + index * (plotWidth / (chartRows.length - 1)));
    const rowSummary =
        chartRows.length < result.rows.length
            ? chartText(chartCopy.sampledRowsSummary, {
                  sampled: formatCount(chartRows.length, locale),
                  rows: formatCount(result.rows.length, locale),
              })
            : chartText(
                  measureIndexes.length === 1
                      ? chartCopy.retainedRowsAcrossOneMeasure
                      : chartCopy.retainedRowsAcrossManyMeasures,
                  {
                      rows: formatCount(chartRows.length, locale),
                      measures: formatCount(measureIndexes.length, locale),
                  },
              );
    const categoryStep =
        categoryLayout?.minimumSlotWidth ?? plotWidth / Math.max(1, chartRows.length);
    const barWidth = Math.max(1, Math.min(28, (categoryStep * 0.68) / measureIndexes.length));
    const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
    const heatmap =
        chartKind === 'heatmap' && groupByIndex !== undefined
            ? prepareHeatmap(result.rows, xIndex, groupByIndex, yIndex)
            : undefined;
    const heatmapXLabels = heatmap?.tooLarge
        ? []
        : [...(heatmap?.xLabels ?? [])].sort(collator.compare);
    const heatmapYLabels = heatmap?.tooLarge
        ? []
        : [...(heatmap?.yLabels ?? [])].sort(collator.compare);
    const heatmapMaximum = heatmap?.maximum ?? 0;
    const heatmapTooLarge = heatmap?.tooLarge ?? false;
    const compactNumber = new Intl.NumberFormat(locale, {
        notation: 'compact',
        maximumFractionDigits: 1,
    });
    const { chartYTicks, scatterPoints, scatterX, scatterY, chartXTicks, scatterSummary } =
        prepareScatterAxes({
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
        });

    const suggestionReason =
        chartKind === 'heatmap'
            ? chartCopy.heatmapReturnedRows
            : result.rows.length === 1
              ? chartCopy.reasonSingleNumber
              : temporalType(result.columns[suggestion.config.x]?.type ?? '')
                ? chartCopy.reasonTimeMeasure
                : chartCopy.reasonDimensionMeasure;
    const chartTitle = chart.title && chart.title !== 'Query result' ? chart.title : undefined;
    const chartAriaLabel = chartText(chartCopy.chartComparing, {
        type: chartTypeLabel(chartKind, chartCopy).toLocaleLowerCase(locale),
        x: result.columns[xIndex]?.name ?? '',
        y: result.columns[yIndex]?.name ?? '',
    });

    const svg: ChartSvgModel = {
        plotRight,
        chartAriaLabel,
        plotTop,
        plotMiddle,
        plotBottom,
        plotLeft,
        chartYTicks,
        compactNumber,
        chartKind,
        zeroY,
        scatterPoints,
        scatterX,
        scatterY,
        result,
        xIndex,
        locale,
        yIndex,
        plotSeries,
        x,
        y,
        barWidth,
        chartRows,
        chartXTicks,
    };
    return {
        chartTitle,
        suggestionReason,
        chartKind,
        chartRows,
        result,
        chartCopy,
        canChooseCandlestick,
        chart,
        candleX,
        inferredCandle,
        groupByIndex,
        xIndex,
        yIndex,
        measureIndexes,
        numericIndexes,
        availableMeasures,
        heatmapTooLarge,
        heatmap,
        heatmapXLabels,
        heatmapYLabels,
        locale,
        heatmapMaximum,
        compactNumber,
        values,
        categoricalAxis,
        chartYTicks,
        scatterSummary,
        rowSummary,
        svg,
    };
}
