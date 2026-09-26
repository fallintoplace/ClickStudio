import type { CSSProperties } from 'react';
import { countRowsByCategory, countRowsOverTime, numericType, recommendChart, temporalType } from '../../shared/results';
import type { Result } from '../../shared/types';
import type { Draft } from '../workspace-state';
import type { Copy, Locale } from '../i18n';
import { chartText, formatCount, seriesColor } from './chart-helpers';

export function RowCountChart({ result, chart, suggestion, onChart, copy, locale }: {
    result: Result;
    chart: Draft['chart'];
    suggestion: ReturnType<typeof recommendChart>;
    onChart: (chart: Draft['chart']) => void;
    copy: Copy['chart'];
    locale: Locale;
}) {
    const dimensions = result.columns.flatMap((column, index) => numericType(column.type) ? [] : [index]);
    if (!dimensions.length) return <div className="chart-empty">{copy.noDimensions}</div>;
    const usesSuggestion = chart.kind === 'table' || !dimensions.includes(chart.x);
    const xIndex = usesSuggestion ? suggestion.config.x : chart.x;
    const timeAxis = temporalType(result.columns[xIndex]?.type ?? '');
    const breakdowns = dimensions.filter(index => index !== xIndex && !temporalType(result.columns[index]?.type ?? ''));
    const defaultGroupBy = usesSuggestion ? suggestion.config.groupBy : chart.groupBy;
    const groupByIndex = timeAxis && defaultGroupBy !== undefined && breakdowns.includes(defaultGroupBy)
        ? defaultGroupBy
        : undefined;
    const countData = timeAxis
        ? countRowsOverTime(result.rows, xIndex, groupByIndex)
        : undefined;
    const categoryData = !timeAxis ? countRowsByCategory(result.rows, xIndex) : undefined;
    const series = countData?.series ?? [];
    const allTimePoints = series.flatMap(item => item.points).sort((left, right) => left.timestamp - right.timestamp);
    const timeTicks = [...new Map(allTimePoints.map(point => [point.timestamp, point])).values()];
    const counts = timeAxis ? allTimePoints.map(point => point.count) : categoryData?.map(group => group.count) ?? [];
    const max = Math.max(0, ...counts);
    const min = 0;
    const range = max || 1;
    const plotLeft = 80, plotRight = 732, plotWidth = plotRight - plotLeft;
    const plotTop = 40, plotMiddle = 115, plotBottom = 190, plotHeight = plotBottom - plotTop;
    const y = (value: number) => plotBottom - (value / range) * plotHeight;
    const timeMin = allTimePoints[0]?.timestamp ?? 0;
    const timeMax = allTimePoints.at(-1)?.timestamp ?? timeMin;
    const xTime = (timestamp: number) => plotLeft + (timeMax === timeMin ? .5 : (timestamp - timeMin) / (timeMax - timeMin)) * plotWidth;
    const xCategory = (index: number, length: number) => plotLeft + (length <= 1 ? .5 : index / (length - 1)) * plotWidth;
    const bars = categoryData ?? [];
    const axisValueCount = timeAxis ? timeTicks.length : bars.length;
    const labelIndexes = axisValueCount <= 3
        ? Array.from({ length: axisValueCount }, (_value, index) => index)
        : [0, Math.floor((axisValueCount - 1) / 2), axisValueCount - 1];
    const axisLabels = timeAxis
        ? labelIndexes.map(index => timeTicks[index]?.label ?? '')
        : labelIndexes.map(index => categoryData?.[index]?.label ?? '');
    const axisLabelPositions = labelIndexes.map(index => timeAxis ? xTime(timeTicks[index]?.timestamp ?? timeMin) : xCategory(index, bars.length));
    const valueFormatter = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 });
    const barWidth = Math.max(4, Math.min(32, plotWidth / Math.max(1, bars.length) * .64));
    const hasRows = result.rows.length > 0;
    const noTimeValues = timeAxis && !series.length;
    const dimensionName = result.columns[xIndex]?.name ?? '';
    const groupName = groupByIndex === undefined ? '' : result.columns[groupByIndex]?.name ?? '';
    const title = timeAxis
        ? groupByIndex === undefined ? copy.rowsOverTime : chartText(copy.rowsOverTimeBy, { dimension: groupName })
        : chartText(copy.rowsBy, { dimension: dimensionName });
    const timeUnit = countData?.unit === 'minute' ? copy.minutes
        : countData?.unit === 'hour' ? copy.hours
            : countData?.unit === 'day' ? copy.days
                : countData?.unit === 'week' ? copy.weeks
                    : countData?.unit === 'month' ? copy.months : '';
    const chartAriaLabel = timeAxis
        ? groupByIndex === undefined ? copy.rowsOverTime : chartText(copy.rowsOverTimeBy, { dimension: groupName })
        : chartText(copy.rowsBy, { dimension: dimensionName });

    return <div className="chart-workspace animate-enter">
        <div className="chart-title-row">
            <div>
                <span className="eyebrow">{copy.visualExploration}</span>
                <h3>{title}</h3>
                <p>{timeAxis
                    ? chartText(copy.timeCountDescription, { unit: timeUnit || copy.days })
                    : chartText(copy.categoryCountDescription, { dimension: dimensionName })}</p>
            </div>
            <div className="chart-controls">
                <label>{copy.xAxis}<select aria-label={copy.xAxis} value={xIndex} onChange={event => {
                    const nextX = Number(event.target.value);
                    const nextTime = temporalType(result.columns[nextX]?.type ?? '');
                    const nextGroupBy = nextTime
                        ? groupByIndex ?? dimensions.find(index => index !== nextX && !temporalType(result.columns[index]?.type ?? ''))
                        : undefined;
                    const nextTitle = nextTime
                        ? nextGroupBy === undefined ? 'Rows over time' : `Rows over time by ${result.columns[nextGroupBy]?.name}`
                        : `Rows by ${result.columns[nextX]?.name}`;
                    onChart({ ...chart, kind: nextTime ? 'line' : 'bar', x: nextX, groupBy: nextGroupBy, ys: [], title: nextTitle });
                }}>{dimensions.map(index => <option key={index} value={index}>{result.columns[index]?.name}</option>)}</select></label>
                {timeAxis && breakdowns.length > 0 && <label>{copy.breakdownBy}<select aria-label={copy.breakdownBy} value={groupByIndex ?? ''} onChange={event => {
                    const nextGroupBy = event.target.value === '' ? undefined : Number(event.target.value);
                    onChart({ ...chart, kind: 'line', x: xIndex, groupBy: nextGroupBy, ys: [], title: nextGroupBy === undefined ? 'Rows over time' : `Rows over time by ${result.columns[nextGroupBy]?.name}` });
                }}><option value="">{copy.allRows}</option>{breakdowns.map(index => <option key={index} value={index}>{result.columns[index]?.name}</option>)}</select></label>}
                <span className="chart-row-count-type"><span className="chart-legend-dot"/>{copy.rowsLabel}</span>
            </div>
        </div>
        {!hasRows
            ? <div className="chart-empty">{copy.noRetainedRows}</div>
            : noTimeValues
                ? <div className="chart-empty">{copy.noValidTimeValues}</div>
                : <div className="chart-canvas">
                    <svg viewBox="0 0 760 230" role="img" aria-label={chartAriaLabel}>
                        {[plotTop, plotMiddle, plotBottom].map(value => <line key={value} x1={plotLeft} x2={plotRight} y1={value} y2={value} className="chart-gridline"/>)}
                        {[{ value: max, position: plotTop }, { value: max / 2, position: plotMiddle }, { value: min, position: plotBottom }].map(tick => <text key={`${tick.position}-${tick.value}`} className="chart-y-tick-label" x={plotLeft - 24} y={tick.position} textAnchor="end" dominantBaseline="middle">{valueFormatter.format(tick.value)}</text>)}
                        <line x1={plotLeft} x2={plotRight} y1={plotBottom} y2={plotBottom} className="chart-zero-line"/>
                        {timeAxis
                            ? series.map((item, seriesIndex) => <g key={item.key} style={{ '--series-color': seriesColor(seriesIndex) } as CSSProperties}>
                                {item.points.length > 1 && <polyline points={item.points.map(point => `${xTime(point.timestamp)},${y(point.count)}`).join(' ')} className="chart-line"/>}
                                {item.points.map(point => <circle key={`${item.key}-${point.timestamp}`} cx={xTime(point.timestamp)} cy={y(point.count)} r="3.5" className="chart-point"><title>{chartText(copy.timePointTooltip, { bucket: point.label, series: item.label, count: formatCount(point.count, locale) })}</title></circle>)}
                            </g>)
                            : bars.map((group, index) => {
                                const valueY = y(group.count), top = Math.min(plotBottom, valueY), height = Math.max(1, plotBottom - valueY);
                                return <rect key={group.key} x={xCategory(index, bars.length) - barWidth / 2} y={top} width={barWidth} height={height} rx="3" className="chart-bar" style={{ '--series-color': seriesColor(0), animationDelay: `${index * 25}ms` } as CSSProperties}><title>{chartText(copy.categoryBarTooltip, { category: group.label, count: formatCount(group.count, locale) })}</title></rect>;
                            })}
                        <g className="chart-x-labels">{axisLabels.map((label, index) => <text key={`${label}-${index}`} x={axisLabelPositions[index]} y="218" textAnchor={axisLabels.length === 1 ? 'middle' : index === 0 ? 'start' : index === axisLabels.length - 1 ? 'end' : 'middle'}>{label}</text>)}</g>
                    </svg>
                </div>}
        <div className="chart-footer">
            <span className="chart-legend">{(timeAxis ? series : [{ key: 'rows', label: copy.rowsLabel }]).map((item, index) => <span key={item.key}><span className="chart-legend-dot" style={{ backgroundColor: seriesColor(index) }}/>{item.label}</span>)}</span>
            <span>{timeAxis
                ? `${chartText(copy.timeSummary, { buckets: formatCount(timeTicks.length, locale), unit: timeUnit, rows: formatCount(result.rows.length, locale) })}${countData?.excludedRows ? ` · ${chartText(copy.invalidDatesSkipped, { count: formatCount(countData.excludedRows, locale) })}` : ''}`
                : chartText(copy.categorySummary, { categories: formatCount(bars.length, locale), rows: formatCount(result.rows.length, locale) })}
                <i>·</i> {result.completeness === 'truncated' ? copy.retainedPrefixOnly : copy.completeQueryResult}</span>
        </div>
    </div>;
}
