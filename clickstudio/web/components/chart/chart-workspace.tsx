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
            {ref => {
                const renderChartContent = () => {
                    switch (chartKind) {
                        case 'number':
                            if (result.rows.length !== 1) {
                                return (
                                    <div className="chart-empty">{chartCopy.numberNeedsOneRow}</div>
                                );
                            }

                            if (!numericType(result.columns[yIndex]?.type ?? '')) {
                                return (
                                    <div className="chart-empty">
                                        {chartCopy.chooseNumericColumn}
                                    </div>
                                );
                            }

                            return (
                                <div className="chart-number-card">
                                    <span className="eyebrow">{chartCopy.singleValue}</span>
                                    <strong>{displayValue(result.rows[0]?.[yIndex])}</strong>
                                    <span>{result.columns[yIndex]?.name}</span>
                                    <small>{chartCopy.exactResultValue}</small>
                                </div>
                            );

                        case 'heatmap':
                            if (heatmapTooLarge) {
                                return (
                                    <div className="chart-empty">
                                        {chartCopy.tooManyHeatmapLabels}
                                    </div>
                                );
                            }

                            if (
                                !heatmap ||
                                groupByIndex === undefined ||
                                heatmap.present.size === 0
                            ) {
                                return (
                                    <div className="chart-empty">
                                        {chartCopy.heatmapNeedsDimensions}
                                    </div>
                                );
                            }

                            return (
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
                            );
                        case 'scatter':
                            if (
                                xIndex === yIndex ||
                                !numericIndexes.includes(xIndex) ||
                                !numericIndexes.includes(yIndex)
                            ) {
                                return (
                                    <div className="chart-empty">
                                        {chartCopy.scatterNeedsTwoNumeric}
                                    </div>
                                );
                            }
                            break;
                    }

                    if (!values.length) {
                        return <div className="chart-empty">{chartCopy.chooseNumericMeasure}</div>;
                    }

                    return (
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
                    );
                };
                const renderLegend = () => {
                    switch (chartKind) {
                        case 'heatmap':
                            return (
                                <>
                                    <span className="chart-legend-dot" />
                                    {result.columns[yIndex]?.name}
                                </>
                            );

                        case 'line':
                        case 'bar':
                            return measureIndexes.map((index, seriesIndex) => (
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
                            ));

                        default:
                            return (
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
                            );
                    }
                };
                const getRowSummary = () => {
                    switch (chartKind) {
                        case 'number':
                            if (result.rows.length === 1) {
                                return chartCopy.oneValue;
                            }

                            return chartText(chartCopy.retainedRows, {
                                rows: formatCount(result.rows.length, locale),
                            });

                        case 'heatmap':
                            return chartText(chartCopy.populatedCells, {
                                cells: formatCount(heatmap?.cells.size ?? 0, locale),
                                rows: formatCount(result.rows.length, locale),
                            });

                        case 'scatter':
                            return scatterSummary;

                        default:
                            return rowSummary;
                    }
                };
                return (
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
                        {renderChartContent()}
                        <div className="chart-footer">
                            <span className="chart-legend">{renderLegend()}</span>
                            <span>
                                {getRowSummary()} <i>·</i>{' '}
                                {result.completeness === 'truncated'
                                    ? chartCopy.retainedPrefixOnly
                                    : chartCopy.completeQueryResult}
                            </span>
                        </div>
                    </div>
                );
            }}
        </ScrollEdgeFrame>
    );
}
