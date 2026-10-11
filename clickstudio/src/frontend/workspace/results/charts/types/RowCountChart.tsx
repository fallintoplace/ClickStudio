import type { CSSProperties } from 'react';
import {
    type RowCountSeries,
    countRowsByCategory,
    countRowsOverTime,
    MAX_CHART_RENDER_POINTS,
    numericType,
    recommendChart,
    temporalType,
} from '../../../../../shared/queries/results/results';
import type { Result } from '../../../../../shared/queries/results/types';
import type { Draft } from '../../../editor/drafts/workspace-state';
import type { Copy, Locale } from '../../../../common/translations/i18n';
import { ScrollEdgeFrame } from '../../../../common/components/ScrollEdgeShadows';
import { ChartToolbar } from '../ChartToolbar';
import { categoryAxisLayout, chartText, formatCount, seriesColor } from '../chart-helpers';
import { useChartPlotWidth } from '../useChartPlotWidth';

export function RowCountChart({
    result,
    chart,
    suggestion,
    onChart,
    copy,
    locale,
}: {
    result: Result;
    chart: Draft['chart'];
    suggestion: ReturnType<typeof recommendChart>;
    onChart: (chart: Draft['chart']) => void;
    copy: Copy['chart'];
    locale: Locale;
}) {
    const { width: categoryViewportWidth, onViewport: onCategoryViewport } = useChartPlotWidth();
    const dimensions = result.columns.flatMap((column, index) =>
        numericType(column.type) ? [] : [index],
    );
    if (!dimensions.length) return <div className="chart-empty">{copy.noDimensions}</div>;
    const usesSuggestion = chart.kind === 'table' || !dimensions.includes(chart.x);
    const xIndex = usesSuggestion ? suggestion.config.x : chart.x;
    const timeAxis = temporalType(result.columns[xIndex]?.type ?? '');
    const breakdowns = dimensions.filter(
        index => index !== xIndex && !temporalType(result.columns[index]?.type ?? ''),
    );
    const defaultGroupBy = usesSuggestion ? suggestion.config.groupBy : chart.groupBy;
    const groupByIndex =
        timeAxis && defaultGroupBy !== undefined && breakdowns.includes(defaultGroupBy)
            ? defaultGroupBy
            : undefined;
    const countData = timeAxis ? countRowsOverTime(result.rows, xIndex, groupByIndex) : undefined;
    const categoryData = !timeAxis ? countRowsByCategory(result.rows, xIndex) : undefined;
    const series = countData?.series ?? [];
    const allTimePoints = series
        .flatMap(item => item.points)
        .sort((left, right) => left.timestamp - right.timestamp);
    const timeTicks = [...new Map(allTimePoints.map(point => [point.timestamp, point])).values()];
    const counts = timeAxis
        ? allTimePoints.map(point => point.count)
        : (categoryData?.map(group => group.count) ?? []);
    const max = Math.max(0, ...counts);
    const min = 0;
    const range = max || 1;
    const bars = categoryData ?? [];
    const categoryLayout = timeAxis
        ? undefined
        : categoryAxisLayout(
              bars.map(group => group.label),
              Math.max(652, categoryViewportWidth),
          );
    const plotLeft = timeAxis ? 80 : 0,
        plotRight = categoryLayout?.width ?? 732,
        plotWidth = plotRight - plotLeft;
    const plotTop = 40,
        plotMiddle = 115,
        plotBottom = 190,
        plotHeight = plotBottom - plotTop;
    const y = (value: number) => plotBottom - (value / range) * plotHeight;
    const timeMin = allTimePoints[0]?.timestamp ?? 0;
    const timeMax = allTimePoints.at(-1)?.timestamp ?? timeMin;
    const xTime = (timestamp: number) =>
        plotLeft +
        (timeMax === timeMin ? 0.5 : (timestamp - timeMin) / (timeMax - timeMin)) * plotWidth;
    const xCategory = (index: number, length: number) =>
        categoryLayout?.positions[index] ??
        plotLeft + (length <= 1 ? 0.5 : index / (length - 1)) * plotWidth;
    const axisValueCount = timeAxis ? timeTicks.length : bars.length;
    let labelIndexes;

    if (axisValueCount <= 3) {
        labelIndexes = Array.from({ length: axisValueCount }, (_value, index) => index);
    } else if (timeAxis) {
        labelIndexes = [0, Math.floor((axisValueCount - 1) / 2), axisValueCount - 1];
    } else {
        labelIndexes = Array.from({ length: axisValueCount }, (_value, index) => index);
    }
    const axisLabels = timeAxis
        ? labelIndexes.map(index => timeTicks[index]?.label ?? '')
        : labelIndexes.map(index => categoryData?.[index]?.label ?? '');
    const axisLabelPositions = labelIndexes.map(index =>
        timeAxis ? xTime(timeTicks[index]?.timestamp ?? timeMin) : xCategory(index, bars.length),
    );
    const valueFormatter = new Intl.NumberFormat(locale, {
        notation: 'compact',
        maximumFractionDigits: 1,
    });
    const barStep = categoryLayout?.minimumSlotWidth ?? plotWidth / Math.max(1, bars.length);
    const barWidth = Math.max(4, Math.min(32, barStep * 0.64));
    const hasRows = result.rows.length > 0;
    const noTimeValues = timeAxis && !series.length;
    const dimensionName = result.columns[xIndex]?.name ?? '';
    const groupName = groupByIndex === undefined ? '' : (result.columns[groupByIndex]?.name ?? '');
    const describeRowCountChart = () => {
        let generatedTitle: string;

        if (timeAxis) {
            if (groupByIndex === undefined) {
                generatedTitle = 'Rows over time';
            } else {
                generatedTitle = `Rows over time by ${groupName}`;
            }
        } else {
            generatedTitle = `Rows by ${dimensionName}`;
        }
        const customTitle =
            chart.title.trim() &&
            !['Query result', generatedTitle, suggestion.config.title].includes(chart.title)
                ? chart.title
                : undefined;
        const getSuggestionReason = () => {
            if (timeAxis) {
                if (groupByIndex === undefined) {
                    return copy.rowsOverTime;
                }

                return chartText(copy.rowsOverTimeBy, { dimension: groupName });
            }

            return chartText(copy.rowsBy, { dimension: dimensionName });
        };
        const title = customTitle ?? getSuggestionReason();
        let timeUnit: string;

        switch (countData?.unit) {
            case 'minute':
                timeUnit = copy.minutes;
                break;
            case 'hour':
                timeUnit = copy.hours;
                break;
            case 'day':
                timeUnit = copy.days;
                break;
            case 'week':
                timeUnit = copy.weeks;
                break;
            case 'month':
                timeUnit = copy.months;
                break;
            default:
                timeUnit = '';
                break;
        }
        let chartAriaLabel: string;

        if (timeAxis) {
            if (groupByIndex === undefined) {
                chartAriaLabel = copy.rowsOverTime;
            } else {
                chartAriaLabel = chartText(copy.rowsOverTimeBy, { dimension: groupName });
            }
        } else {
            chartAriaLabel = chartText(copy.rowsBy, { dimension: dimensionName });
        }
        return { title, customTitle, timeUnit, chartAriaLabel };
    };
    const { title, customTitle, timeUnit, chartAriaLabel } = describeRowCountChart();
    const renderChartSvg = createRowCountSvgRenderer({
        plotRight,
        chartAriaLabel,
        plotTop,
        plotMiddle,
        plotBottom,
        plotLeft,
        max,
        min,
        valueFormatter,
        timeAxis,
        series,
        xTime,
        y,
        copy,
        locale,
        bars,
        xCategory,
        barWidth,
        axisLabels,
        axisLabelPositions,
    });

    return (
        <ScrollEdgeFrame<HTMLDivElement> className="chart-workspace-frame">
            {ref => {
                const renderChartContent = () => {
                    if (!hasRows) {
                        return <div className="chart-empty">{copy.noRetainedRows}</div>;
                    }

                    if (noTimeValues) {
                        return <div className="chart-empty">{copy.noValidTimeValues}</div>;
                    }

                    return (
                        <div
                            className={`chart-canvas${timeAxis ? '' : ' chart-canvas--categorical'}`}
                        >
                            {!timeAxis && (
                                <svg
                                    className="chart-category-y-axis"
                                    viewBox="0 0 80 230"
                                    preserveAspectRatio="none"
                                    aria-hidden="true"
                                >
                                    {[
                                        { value: max, position: plotTop },
                                        { value: max / 2, position: plotMiddle },
                                        { value: min, position: plotBottom },
                                    ].map(tick => (
                                        <text
                                            key={`${tick.position}-${tick.value}`}
                                            className="chart-y-tick-label"
                                            x="72"
                                            y={tick.position}
                                            textAnchor="end"
                                            dominantBaseline="middle"
                                        >
                                            {valueFormatter.format(tick.value)}
                                        </text>
                                    ))}
                                </svg>
                            )}
                            {timeAxis ? (
                                renderChartSvg(false)
                            ) : (
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
                            )}
                        </div>
                    );
                };
                return (
                    <div ref={ref} className="chart-workspace animate-enter">
                        <ChartToolbar
                            title={title}
                            description={
                                timeAxis
                                    ? chartText(copy.timeCountDescription, {
                                          unit: timeUnit || copy.days,
                                      })
                                    : chartText(copy.categoryCountDescription, {
                                          dimension: dimensionName,
                                      })
                            }
                            copy={copy}
                        >
                            <label>
                                {copy.xAxis}
                                <select
                                    aria-label={copy.xAxis}
                                    value={xIndex}
                                    onChange={event => {
                                        const nextX = Number(event.target.value);
                                        const nextTime = temporalType(
                                            result.columns[nextX]?.type ?? '',
                                        );
                                        const nextGroupBy = nextTime
                                            ? (groupByIndex ??
                                              dimensions.find(
                                                  index =>
                                                      index !== nextX &&
                                                      !temporalType(
                                                          result.columns[index]?.type ?? '',
                                                      ),
                                              ))
                                            : undefined;
                                        let nextTitle: string;

                                        if (nextTime) {
                                            if (nextGroupBy === undefined) {
                                                nextTitle = 'Rows over time';
                                            } else {
                                                nextTitle = `Rows over time by ${result.columns[nextGroupBy]?.name}`;
                                            }
                                        } else {
                                            nextTitle = `Rows by ${result.columns[nextX]?.name}`;
                                        }
                                        onChart({
                                            ...chart,
                                            kind: nextTime ? 'line' : 'bar',
                                            x: nextX,
                                            groupBy: nextGroupBy,
                                            ys: [],
                                            title: customTitle ?? nextTitle,
                                        });
                                    }}
                                >
                                    {dimensions.map(index => (
                                        <option key={index} value={index}>
                                            {result.columns[index]?.name}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            {timeAxis && breakdowns.length > 0 && (
                                <label>
                                    {copy.breakdownBy}
                                    <select
                                        aria-label={copy.breakdownBy}
                                        value={groupByIndex ?? ''}
                                        onChange={event => {
                                            const nextGroupBy =
                                                event.target.value === ''
                                                    ? undefined
                                                    : Number(event.target.value);
                                            onChart({
                                                ...chart,
                                                kind: 'line',
                                                x: xIndex,
                                                groupBy: nextGroupBy,
                                                ys: [],
                                                title:
                                                    customTitle ??
                                                    (nextGroupBy === undefined
                                                        ? 'Rows over time'
                                                        : `Rows over time by ${result.columns[nextGroupBy]?.name}`),
                                            });
                                        }}
                                    >
                                        <option value="">{copy.allRows}</option>
                                        {breakdowns.map(index => (
                                            <option key={index} value={index}>
                                                {result.columns[index]?.name}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            )}
                            <span className="chart-row-count-type">
                                <span className="chart-legend-dot" />
                                {copy.rowsLabel}
                            </span>
                        </ChartToolbar>
                        {renderChartContent()}
                        <div className="chart-footer">
                            <span className="chart-legend">
                                {(timeAxis ? series : [{ key: 'rows', label: copy.rowsLabel }]).map(
                                    (item, index) => (
                                        <span key={item.key}>
                                            <span
                                                className="chart-legend-dot"
                                                style={{
                                                    backgroundColor: seriesColor(index),
                                                    color: seriesColor(index),
                                                }}
                                            />
                                            {item.label}
                                        </span>
                                    ),
                                )}
                            </span>
                            <span>
                                {timeAxis
                                    ? `${chartText(copy.timeSummary, { buckets: formatCount(timeTicks.length, locale), unit: timeUnit, rows: formatCount(result.rows.length, locale) })}${countData?.excludedRows ? ` · ${chartText(copy.invalidDatesSkipped, { count: formatCount(countData.excludedRows, locale) })}` : ''}`
                                    : chartText(copy.categorySummary, {
                                          categories: formatCount(bars.length, locale),
                                          rows: formatCount(result.rows.length, locale),
                                      })}
                                <i>·</i>{' '}
                                {result.completeness === 'truncated'
                                    ? copy.retainedPrefixOnly
                                    : copy.completeQueryResult}
                            </span>
                        </div>
                    </div>
                );
            }}
        </ScrollEdgeFrame>
    );
}

function createRowCountSvgRenderer({
    plotRight,
    chartAriaLabel,
    plotTop,
    plotMiddle,
    plotBottom,
    plotLeft,
    max,
    min,
    valueFormatter,
    timeAxis,
    series,
    xTime,
    y,
    copy,
    locale,
    bars,
    xCategory,
    barWidth,
    axisLabels,
    axisLabelPositions,
}: {
    plotRight: number;
    chartAriaLabel: string;
    plotTop: number;
    plotMiddle: number;
    plotBottom: number;
    plotLeft: 0 | 80;
    max: number;
    min: number;
    valueFormatter: Intl.NumberFormat;
    timeAxis: boolean;
    series: RowCountSeries[];
    xTime: (timestamp: number) => number;
    y: (value: number) => number;
    copy: Copy['chart'];
    locale: Locale;
    bars: { key: string; label: string; count: number }[];
    xCategory: (index: number, length: number) => number;
    barWidth: number;
    axisLabels: string[];
    axisLabelPositions: number[];
}) {
    return (categoryAxisIsScrollable: boolean) => (
        <svg
            className={categoryAxisIsScrollable ? 'chart-category-plot' : undefined}
            viewBox={categoryAxisIsScrollable ? `0 0 ${plotRight} 230` : '0 0 760 230'}
            preserveAspectRatio={categoryAxisIsScrollable ? 'none' : undefined}
            style={
                categoryAxisIsScrollable
                    ? ({ '--chart-plot-width': `${plotRight}px` } as CSSProperties)
                    : undefined
            }
            role="img"
            aria-label={chartAriaLabel}
        >
            {[plotTop, plotMiddle, plotBottom].map(value => (
                <line
                    key={value}
                    x1={plotLeft}
                    x2={plotRight}
                    y1={value}
                    y2={value}
                    className="chart-gridline"
                />
            ))}
            {!categoryAxisIsScrollable &&
                [
                    { value: max, position: plotTop },
                    { value: max / 2, position: plotMiddle },
                    { value: min, position: plotBottom },
                ].map(tick => (
                    <text
                        key={`${tick.position}-${tick.value}`}
                        className="chart-y-tick-label"
                        x={plotLeft - 24}
                        y={tick.position}
                        textAnchor="end"
                        dominantBaseline="middle"
                    >
                        {valueFormatter.format(tick.value)}
                    </text>
                ))}
            <line
                x1={plotLeft}
                x2={plotRight}
                y1={plotBottom}
                y2={plotBottom}
                className="chart-zero-line"
            />
            {timeAxis
                ? series.map((item, seriesIndex) => (
                      <g
                          key={item.key}
                          style={{ '--series-color': seriesColor(seriesIndex) } as CSSProperties}
                      >
                          {item.points.length > 1 && (
                              <polyline
                                  points={item.points
                                      .map(point => `${xTime(point.timestamp)},${y(point.count)}`)
                                      .join(' ')}
                                  pathLength={1}
                                  className="chart-line"
                              />
                          )}
                          {item.points.map(point => (
                              <circle
                                  key={`${item.key}-${point.timestamp}`}
                                  cx={xTime(point.timestamp)}
                                  cy={y(point.count)}
                                  r="3.5"
                                  className="chart-point"
                              >
                                  <title>
                                      {chartText(copy.timePointTooltip, {
                                          bucket: point.label,
                                          series: item.label,
                                          count: formatCount(point.count, locale),
                                      })}
                                  </title>
                              </circle>
                          ))}
                      </g>
                  ))
                : bars.map((group, index) => {
                      const valueY = y(group.count),
                          top = Math.min(plotBottom, valueY),
                          height = Math.max(1, plotBottom - valueY);
                      const disableBarAnimation = bars.length > MAX_CHART_RENDER_POINTS;
                      return (
                          <rect
                              key={group.key}
                              x={xCategory(index, bars.length) - barWidth / 2}
                              y={top}
                              width={barWidth}
                              height={height}
                              rx="3"
                              className={`chart-bar${disableBarAnimation ? ' chart-bar--static' : ''}`}
                              style={
                                  {
                                      '--series-color': seriesColor(0),
                                      ...(disableBarAnimation
                                          ? {}
                                          : { animationDelay: `${index * 25}ms` }),
                                  } as CSSProperties
                              }
                          >
                              <title>
                                  {chartText(copy.categoryBarTooltip, {
                                      category: group.label,
                                      count: formatCount(group.count, locale),
                                  })}
                              </title>
                          </rect>
                      );
                  })}
            <g className="chart-x-labels">
                {axisLabels.map((label, index) => {
                    const getTickAnchor = (): 'middle' | 'start' | 'end' => {
                        if (categoryAxisIsScrollable) {
                            return 'middle';
                        }

                        if (axisLabels.length === 1) {
                            return 'middle';
                        }

                        if (index === 0) {
                            return 'start';
                        }

                        if (index === axisLabels.length - 1) {
                            return 'end';
                        }

                        return 'middle';
                    };
                    return (
                        <text
                            key={`${label}-${index}`}
                            x={axisLabelPositions[index]}
                            y="218"
                            textAnchor={getTickAnchor()}
                        >
                            {label}
                        </text>
                    );
                })}
            </g>
        </svg>
    );
}
