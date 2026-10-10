import type { RefCallback } from 'react';
import { displayValue, numericType } from '../../../shared/results';
import type { Draft } from '../../workspace-state';
import { ScrollEdgeFrame } from '../ScrollEdgeShadows';
import { chartText, formatCount, seriesColor } from '../chart-helpers';
import type { prepareChartView } from './chart-view-model';
import type { createChartSvgRenderer } from './chart-svg-renderer';
import { renderChartControls } from './chart-controls';
import { HeatmapGrid } from './HeatmapGrid';

export function renderChartWorkspace({
    chartTitle,
    suggestionReason,
    chartKind,
    chartRows,
    result,
    chartCopy,
    canChooseCandlestick,
    onChart,
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
    onCategoryViewport,
    chartYTicks,
    renderChartSvg,
    scatterSummary,
    rowSummary,
}: ReturnType<typeof prepareChartView> & {
    onChart: (chart: Draft['chart']) => void;
    onCategoryViewport: RefCallback<HTMLDivElement>;
    renderChartSvg: ReturnType<typeof createChartSvgRenderer>;
}) {
    return (
        <ScrollEdgeFrame<HTMLDivElement> className="chart-workspace-frame">
            {ref => (
                <div ref={ref} className="chart-workspace animate-enter">
                    {renderChartControls({
                        chartTitle,
                        suggestionReason,
                        chartKind,
                        chartRows,
                        result,
                        chartCopy,
                        canChooseCandlestick,
                        onChart,
                        chart,
                        candleX,
                        inferredCandle,
                        groupByIndex,
                        xIndex,
                        yIndex,
                        measureIndexes,
                        numericIndexes,
                        availableMeasures,
                    })}
                    {chartKind === 'number' ? (
                        result.rows.length !== 1 ? (
                            <div className="chart-empty">{chartCopy.numberNeedsOneRow}</div>
                        ) : !numericType(result.columns[yIndex]?.type ?? '') ? (
                            <div className="chart-empty">{chartCopy.chooseNumericColumn}</div>
                        ) : (
                            <div className="chart-number-card">
                                <span className="eyebrow">{chartCopy.singleValue}</span>
                                <strong>{displayValue(result.rows[0]?.[yIndex])}</strong>
                                <span>{result.columns[yIndex]?.name}</span>
                                <small>{chartCopy.exactResultValue}</small>
                            </div>
                        )
                    ) : chartKind === 'heatmap' ? (
                        heatmapTooLarge ? (
                            <div className="chart-empty">{chartCopy.tooManyHeatmapLabels}</div>
                        ) : !heatmap || groupByIndex === undefined || heatmap.present.size === 0 ? (
                            <div className="chart-empty">{chartCopy.heatmapNeedsDimensions}</div>
                        ) : (
                            <HeatmapGrid
                                {...{
                                    chartCopy,
                                    result,
                                    yIndex,
                                    groupByIndex,
                                    xIndex,
                                    heatmapXLabels,
                                    heatmapYLabels,
                                    heatmap,
                                    locale,
                                    heatmapMaximum,
                                    compactNumber,
                                }}
                            />
                        )
                    ) : chartKind === 'scatter' &&
                      (xIndex === yIndex ||
                          !numericIndexes.includes(xIndex) ||
                          !numericIndexes.includes(yIndex)) ? (
                        <div className="chart-empty">{chartCopy.scatterNeedsTwoNumeric}</div>
                    ) : !values.length ? (
                        <div className="chart-empty">{chartCopy.chooseNumericMeasure}</div>
                    ) : (
                        <div
                            className={`chart-canvas${categoricalAxis ? ' chart-canvas--categorical' : ''}`}
                        >
                            {categoricalAxis && (
                                <svg
                                    className="chart-category-y-axis"
                                    viewBox="0 0 80 230"
                                    preserveAspectRatio="none"
                                    aria-hidden="true"
                                >
                                    {chartYTicks.map(tick => (
                                        <text
                                            key={`${tick.position}-${tick.value}`}
                                            className="chart-y-tick-label"
                                            x="72"
                                            y={tick.position}
                                            textAnchor="end"
                                            dominantBaseline="middle"
                                        >
                                            {compactNumber.format(tick.value)}
                                        </text>
                                    ))}
                                </svg>
                            )}
                            {categoricalAxis ? (
                                <ScrollEdgeFrame<HTMLDivElement>
                                    className="chart-category-scroll-frame"
                                    onViewport={onCategoryViewport}
                                >
                                    {ref => (
                                        <div
                                            ref={ref}
                                            className="chart-category-scroll"
                                            tabIndex={0}
                                        >
                                            {renderChartSvg(true)}
                                        </div>
                                    )}
                                </ScrollEdgeFrame>
                            ) : (
                                renderChartSvg(false)
                            )}
                        </div>
                    )}
                    <div className="chart-footer">
                        <span className="chart-legend">
                            {chartKind === 'heatmap' ? (
                                <>
                                    <span className="chart-legend-dot" />
                                    {result.columns[yIndex]?.name}
                                </>
                            ) : chartKind === 'line' || chartKind === 'bar' ? (
                                measureIndexes.map((index, seriesIndex) => (
                                    <span key={index}>
                                        <span
                                            className="chart-legend-dot"
                                            style={{
                                                backgroundColor: seriesColor(seriesIndex),
                                                color: seriesColor(seriesIndex),
                                            }}
                                        />
                                        {result.columns[index]?.name}
                                    </span>
                                ))
                            ) : (
                                <>
                                    <span
                                        className="chart-legend-dot"
                                        style={{
                                            backgroundColor: seriesColor(0),
                                            color: seriesColor(0),
                                        }}
                                    />
                                    {result.columns[yIndex]?.name}
                                </>
                            )}
                        </span>
                        <span>
                            {chartKind === 'number'
                                ? result.rows.length === 1
                                    ? chartCopy.oneValue
                                    : chartText(chartCopy.retainedRows, {
                                          rows: formatCount(result.rows.length, locale),
                                      })
                                : chartKind === 'heatmap'
                                  ? chartText(chartCopy.populatedCells, {
                                        cells: formatCount(heatmap?.cells.size ?? 0, locale),
                                        rows: formatCount(result.rows.length, locale),
                                    })
                                  : chartKind === 'scatter'
                                    ? scatterSummary
                                    : rowSummary}{' '}
                            <i>·</i>{' '}
                            {result.completeness === 'truncated'
                                ? chartCopy.retainedPrefixOnly
                                : chartCopy.completeQueryResult}
                        </span>
                    </div>
                </div>
            )}
        </ScrollEdgeFrame>
    );
}
