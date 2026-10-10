import type { CSSProperties } from 'react';
import { chartNumber, displayValue, heatmapCellKey, MAX_CHART_RENDER_POINTS, numericType, prepareHeatmap, recommendChart, sampleChartRows, temporalType } from '../../shared/results';
import type { CandlestickConfig, Result } from '../../shared/types';
import type { Draft } from '../workspace-state';
import type { Copy, Locale } from '../i18n';
import { CandlestickChart } from './CandlestickChart';
import { RowCountChart } from './RowCountChart';
import { ScrollEdgeFrame } from './ScrollEdgeShadows';
import { categoryAxisLayout, chartKindOptions, chartText, chartTypeLabel, formatCount, seriesColor, splitChartSegments } from './chart-helpers';

export function ChartView({ result, loading, chart, onChart, copy, locale }: { result?: Result; loading: boolean; chart: Draft['chart']; onChart: (chart: Draft['chart']) => void; copy: Copy; locale: Locale }) {
    const chartCopy = copy.chart;
    if (loading || !result) return <div className="result-loading"><span className="loading-orbit"/><span>{chartCopy.preparing}</span></div>;
    if (!result.columns.length) return <div className="chart-empty">{chartCopy.noColumns}</div>;
    const suggestion = recommendChart(result.columns, result.rows);
    const numericIndexes = result.columns.flatMap((column, index) => numericType(column.type) ? [index] : []);
    const inferredCandle = suggestion.config.candlestick;
    const canChooseCandlestick = numericIndexes.length >= 4;
    const validCandleIndex = (index: number | undefined): index is number => typeof index === 'number' && Number.isSafeInteger(index) && index >= 0 && index < result.columns.length && numericType(result.columns[index]?.type ?? '');
    const namedTime = result.columns.findIndex(column => /^(?:time|timestamp|datetime|date)$/i.test(column.name));
    const fallbackTime = result.columns.findIndex((column, index) => temporalType(column.type) || (!numericIndexes.includes(index) && !['open', 'high', 'low', 'close'].includes(column.name.toLowerCase())));
    const chartXIsTime = chart.x >= 0 && chart.x < result.columns.length && (temporalType(result.columns[chart.x]?.type ?? '') || /^(?:time|timestamp|datetime|date)$/i.test(result.columns[chart.x]?.name ?? ''));
    const candleX = chartXIsTime ? chart.x : suggestion.config.kind === 'candlestick' ? suggestion.config.x : namedTime >= 0 ? namedTime : fallbackTime >= 0 ? fallbackTime : suggestion.config.x;
    const activeCandle = chart.candlestick ?? inferredCandle;
    const activeCandleValid = Boolean(activeCandle && [activeCandle.open, activeCandle.high, activeCandle.low, activeCandle.close].every(validCandleIndex) && new Set([activeCandle.open, activeCandle.high, activeCandle.low, activeCandle.close]).size === 4);
    if (chart.kind === 'candlestick' || (chart.kind === 'table' && suggestion.config.kind === 'candlestick')) {
        const candle = activeCandle ?? {};
        const patchCandle = (field: 'open' | 'high' | 'low' | 'close' | 'bid' | 'ask' | 'spread' | 'quoteActivity', value: string) => {
            const next = value === '' ? undefined : Number(value);
            const candlestick: CandlestickConfig = { ...candle };
            if (next === undefined) delete candlestick[field];
            else candlestick[field] = next;
            onChart({ ...chart, kind: 'candlestick', x: candleX, ys: [], candlestick });
        };
        const updateKind = (value: string) => {
            const option = chartKindOptions.find(candidate => candidate.value === value);
            if (!option) return;
            if (option.value === 'candlestick' && !canChooseCandlestick) return;
            onChart({ ...chart, kind: option.value, ...(option.value === 'candlestick' ? { x: candleX, ys: [], candlestick: inferredCandle ?? {} } : { ys: numericIndexes.slice(0, 1) }) });
        };
        const candleColumns = (selected: number | undefined) => <><option value="">—</option>{numericIndexes.map(index => <option value={index} key={index} disabled={index !== selected && [candle.open, candle.high, candle.low, candle.close].includes(index)}>{result.columns[index]?.name}</option>)}</>;
        const optionalColumns = (selected: number | undefined) => <><option value="">—</option>{numericIndexes.map(index => <option value={index} key={index} disabled={index !== selected && [candle.open, candle.high, candle.low, candle.close].includes(index)}>{result.columns[index]?.name}</option>)}</>;
        return <ScrollEdgeFrame<HTMLDivElement> className="chart-workspace-frame">{ref => <div ref={ref} className="chart-workspace animate-enter">
            <div className="chart-title-row"><div><span className="eyebrow">{chartCopy.visualExploration}</span><h3>{chart.title === 'Query result' ? chartCopy.candlestickType : chart.title}</h3><p>{chartCopy.returnedData}. {chartCopy.candlestickDisplayNote}</p></div><div className="chart-controls">
                <label>{chartCopy.type}<select value="candlestick" onChange={event => updateKind(event.target.value)}>{chartKindOptions.map(option => <option key={option.value} value={option.value} disabled={option.value === 'candlestick' && !canChooseCandlestick}>{chartTypeLabel(option.value, chartCopy)}</option>)}</select></label>
                <label>{chartCopy.xAxis}<select value={candleX} onChange={event => onChart({ ...chart, kind: 'candlestick', x: Number(event.target.value), ys: [], candlestick: { ...candle } })}>{result.columns.map((column, index) => <option value={index} key={index}>{column.name}</option>)}</select></label>
                {(['open', 'high', 'low', 'close'] as const).map(field => <label key={field}>{chartCopy[`${field}Label`]}<select value={candle[field] ?? ''} onChange={event => patchCandle(field, event.target.value)}>{candleColumns(candle[field])}</select></label>)}
                {(['bid', 'ask', 'spread', 'quoteActivity'] as const).map(field => <label key={field}>{field === 'bid' || field === 'ask' ? field.toUpperCase() : field === 'spread' ? chartCopy.spreadBps : chartCopy.quoteActivity}<select value={candle[field] ?? ''} onChange={event => patchCandle(field, event.target.value)}>{optionalColumns(candle[field])}</select></label>)}
            </div></div>
            {!activeCandleValid ? <div className="chart-empty" role="status">{chartCopy.noValidCandles}</div> : <CandlestickChart result={result} config={candle} x={candleX} copy={chartCopy} locale={locale}/>}
        </div>}</ScrollEdgeFrame>;
    }
    if (!numericIndexes.length) return <RowCountChart result={result} chart={chart} suggestion={suggestion} onChart={onChart} copy={chartCopy} locale={locale}/>;
    const chartKind = chart.kind === 'table'
        ? (suggestion.config.kind === 'table' ? 'bar' : suggestion.config.kind)
        : chart.kind;
    const configuredMeasures = [...new Set(chart.ys.filter(index => numericIndexes.includes(index)))];
    const suggestedMeasure = suggestion.config.ys.find(index => numericIndexes.includes(index)) ?? numericIndexes[0];
    const initialMeasure = configuredMeasures[0] ?? suggestedMeasure ?? 0;
    const validChartIndex = (index: number | undefined) => Number.isSafeInteger(index) && index! >= 0 && index! < result.columns.length;
    const initialGroupBy = chart.groupBy !== undefined && validChartIndex(chart.groupBy) && chart.groupBy !== chart.x && chart.groupBy !== initialMeasure
        ? chart.groupBy
        : result.columns.findIndex((_column, index) => index !== chart.x && index !== initialMeasure);
    const allowedX = (index: number) => chartKind === 'scatter'
        ? numericIndexes.includes(index) && index !== initialMeasure
        : chartKind === 'heatmap'
            ? index !== initialMeasure && index !== initialGroupBy
            : index !== initialMeasure;
    const fallbackX = result.columns.findIndex((_column, index) => allowedX(index));
    const xIndex = validChartIndex(chart.x) && allowedX(chart.x)
        ? chart.x
        : fallbackX >= 0 ? fallbackX : 0;
    const candidateGroupBy = chartKind === 'heatmap'
        ? chart.groupBy !== undefined && validChartIndex(chart.groupBy) && chart.groupBy !== xIndex && chart.groupBy !== initialMeasure
            ? chart.groupBy
            : result.columns.findIndex((_column, index) => index !== xIndex && index !== initialMeasure)
        : -1;
    const groupByIndex = candidateGroupBy >= 0 ? candidateGroupBy : undefined;
    const availableMeasures = numericIndexes.filter(index => index !== xIndex && index !== groupByIndex);
    const usableConfiguredMeasures = configuredMeasures.filter(index => availableMeasures.includes(index));
    const defaultMeasure = availableMeasures.includes(suggestedMeasure ?? -1) ? suggestedMeasure! : availableMeasures[0] ?? 0;
    const selectedMeasures = usableConfiguredMeasures.length ? usableConfiguredMeasures : [defaultMeasure];
    const measureIndexes = chartKind === 'line' || chartKind === 'bar' ? selectedMeasures : selectedMeasures.slice(0, 1);
    const yIndex = measureIndexes[0] ?? 0;
    const xType = result.columns[xIndex]?.type ?? '';
    const categoricalAxis = chartKind === 'bar' || (chartKind === 'line' && !numericType(xType) && !temporalType(xType));
    const chartRows = chartKind === 'heatmap' ? [] : categoricalAxis ? result.rows : sampleChartRows(result.rows, MAX_CHART_RENDER_POINTS);
    const plotSeries = measureIndexes.map((columnIndex, seriesIndex) => ({
        columnIndex,
        color: seriesColor(seriesIndex),
        points: chartRows.map((row, index) => ({ label: displayValue(row[xIndex]), value: chartNumber(row[columnIndex]), index })),
    }));
    const categoryLayout = categoricalAxis ? categoryAxisLayout(plotSeries[0]?.points.map(point => point.label) ?? []) : undefined;
    const values = plotSeries.flatMap(series => series.points.flatMap(point => point.value === null ? [] : [point.value]));
    const min = Math.min(0, ...values), max = Math.max(0, ...values), range = max - min || 1;
    const plotLeft = categoricalAxis ? 0 : 80, plotRight = categoryLayout?.width ?? 732, plotWidth = plotRight - plotLeft;
    const plotTop = 40, plotMiddle = 115, plotBottom = 190, plotHeight = plotBottom - plotTop;
    const zeroY = plotBottom - ((0 - min) / range) * plotHeight;
    const y = (value: number) => plotBottom - ((value - min) / range) * plotHeight;
    const x = (index: number) => categoryLayout?.positions[index] ?? (chartRows.length <= 1 ? (plotLeft + plotRight) / 2 : plotLeft + index * (plotWidth / (chartRows.length - 1)));
    const rowSummary = chartRows.length < result.rows.length
        ? chartText(chartCopy.sampledRowsSummary, { sampled: formatCount(chartRows.length, locale), rows: formatCount(result.rows.length, locale) })
        : chartText(measureIndexes.length === 1 ? chartCopy.retainedRowsAcrossOneMeasure : chartCopy.retainedRowsAcrossManyMeasures, { rows: formatCount(chartRows.length, locale), measures: formatCount(measureIndexes.length, locale) });
    const categoryStep = categoryLayout?.minimumSlotWidth ?? plotWidth / Math.max(1, chartRows.length);
    const barWidth = Math.max(1, Math.min(28, (categoryStep * .68) / measureIndexes.length));
    const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
    const heatmap = chartKind === 'heatmap' && groupByIndex !== undefined
        ? prepareHeatmap(result.rows, xIndex, groupByIndex, yIndex)
        : undefined;
    const heatmapXLabels = heatmap?.tooLarge ? [] : [...(heatmap?.xLabels ?? [])].sort(collator.compare);
    const heatmapYLabels = heatmap?.tooLarge ? [] : [...(heatmap?.yLabels ?? [])].sort(collator.compare);
    const heatmapMaximum = heatmap?.maximum ?? 0;
    const heatmapTooLarge = heatmap?.tooLarge ?? false;
    const compactNumber = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 });
    const scatterPoints = chartRows.map(row => ({ x: chartNumber(row[xIndex]), y: chartNumber(row[yIndex]), label: displayValue(row[xIndex]) }))
        .filter((point): point is { x: number; y: number; label: string } => point.x !== null && point.y !== null);
    const scatterMinX = Math.min(...scatterPoints.map(point => point.x), 0);
    const scatterMaxX = Math.max(...scatterPoints.map(point => point.x), 0);
    const scatterMinY = Math.min(...scatterPoints.map(point => point.y), 0);
    const scatterMaxY = Math.max(...scatterPoints.map(point => point.y), 0);
    const scatterRangeX = scatterMaxX - scatterMinX || 1;
    const scatterRangeY = scatterMaxY - scatterMinY || 1;
    const scatterX = (value: number) => scatterMinX === scatterMaxX ? (plotLeft + plotRight) / 2 : plotLeft + ((value - scatterMinX) / scatterRangeX) * plotWidth;
    const scatterY = (value: number) => scatterMinY === scatterMaxY ? plotMiddle : plotBottom - ((value - scatterMinY) / scatterRangeY) * plotHeight;
    const chartYTicks = chartKind === 'scatter'
        ? scatterMinY === scatterMaxY
            ? [{ value: scatterMinY, position: plotMiddle }]
            : [{ value: scatterMaxY, position: plotTop }, { value: (scatterMinY + scatterMaxY) / 2, position: plotMiddle }, { value: scatterMinY, position: plotBottom }]
        : min === max
            ? [{ value: min, position: plotBottom }]
            : [{ value: max, position: plotTop }, { value: (min + max) / 2, position: plotMiddle }, { value: min, position: plotBottom }];
    const chartXTicks = chartKind === 'scatter'
        ? scatterMinX === scatterMaxX
            ? [{ label: compactNumber.format(scatterMinX), position: (plotLeft + plotRight) / 2 }]
            : [{ label: compactNumber.format(scatterMinX), position: plotLeft }, { label: compactNumber.format((scatterMinX + scatterMaxX) / 2), position: (plotLeft + plotRight) / 2 }, { label: compactNumber.format(scatterMaxX), position: plotRight }]
        : categoricalAxis
            ? plotSeries[0]?.points.map((point, index) => ({ label: point.label, position: x(index) })) ?? []
            : [...new Set([0, Math.floor((chartRows.length - 1) / 2), chartRows.length - 1])].map(index => ({ label: plotSeries[0]?.points[index]?.label ?? '', position: x(index) }));
    const suggestionReason = chartKind === 'heatmap'
        ? chartCopy.heatmapReturnedRows
        : result.rows.length === 1
            ? chartCopy.reasonSingleNumber
            : temporalType(result.columns[suggestion.config.x]?.type ?? '')
                ? chartCopy.reasonTimeMeasure
                : chartCopy.reasonDimensionMeasure;
    const chartTitle = chart.title === 'Query result' ? chartCopy.queryResult : chart.title || result.columns[yIndex]?.name || chartCopy.queryResult;
    const chartAriaLabel = chartText(chartCopy.chartComparing, { type: chartTypeLabel(chartKind, chartCopy).toLocaleLowerCase(locale), x: result.columns[xIndex]?.name ?? '', y: result.columns[yIndex]?.name ?? '' });
    const renderChartSvg = (categoryAxisIsScrollable: boolean) => <svg
        className={categoryAxisIsScrollable ? 'chart-category-plot' : undefined}
        viewBox={categoryAxisIsScrollable ? `0 0 ${plotRight} 230` : '0 0 760 230'}
        preserveAspectRatio={categoryAxisIsScrollable ? 'none' : undefined}
        style={categoryAxisIsScrollable ? { '--chart-plot-width': `${plotRight}px` } as CSSProperties : undefined}
        role="img"
        aria-label={chartAriaLabel}>
        {[plotTop, plotMiddle, plotBottom].map(value => <line key={value} x1={plotLeft} x2={plotRight} y1={value} y2={value} className="chart-gridline"/>)}
        {!categoryAxisIsScrollable && chartYTicks.map(tick => <text key={`${tick.position}-${tick.value}`} className="chart-y-tick-label" x={plotLeft - 24} y={tick.position} textAnchor="end" dominantBaseline="middle">{compactNumber.format(tick.value)}</text>)}
        {chartKind !== 'scatter' && <line x1={plotLeft} x2={plotRight} y1={zeroY} y2={zeroY} className="chart-zero-line"/>}
        {chartKind === 'scatter' ? scatterPoints.map((point, index) => <circle key={index} cx={scatterX(point.x)} cy={scatterY(point.y)} r="3.5" className="chart-point" style={{ fill: seriesColor(0), stroke: seriesColor(0) }}><title>{`${result.columns[xIndex]?.name}: ${formatCount(point.x, locale)} · ${result.columns[yIndex]?.name}: ${formatCount(point.y, locale)}`}</title></circle>)
            : chartKind === 'line' ? plotSeries.map(series => {
                const segments = splitChartSegments(series.points);
                return <g key={series.columnIndex} style={{ '--series-color': series.color } as CSSProperties}>
                    {segments.filter(points => points.length > 1).map((points, index) => <polygon key={`area-${index}`} points={`${x(points[0]!.index)},${zeroY} ${points.map(point => `${x(point.index)},${y(point.value!)}`).join(' ')} ${x(points.at(-1)!.index)},${zeroY}`} className="chart-area-fill"/>)}
                    {segments.map((points, index) => <polyline key={`line-${index}`} points={points.map(point => `${x(point.index)},${y(point.value!)}`).join(' ')} className="chart-line"/>)}
                    {series.points.filter(point => point.value !== null).map(point => <circle key={point.index} cx={x(point.index)} cy={y(point.value!)} r="3.5" className="chart-point"/>)}
                </g>;
            }) : plotSeries.flatMap((series, seriesIndex) => series.points.flatMap(point => {
                if (point.value === null) return [];
                const valueY = y(point.value), top = Math.min(zeroY, valueY), height = Math.max(1, Math.abs(valueY - zeroY));
                const groupOffset = (seriesIndex - (plotSeries.length - 1) / 2) * barWidth;
                const disableBarAnimation = categoryAxisIsScrollable && chartRows.length > MAX_CHART_RENDER_POINTS;
                return [<rect key={`${series.columnIndex}-${point.index}`} x={x(point.index) + groupOffset - barWidth / 2} y={top} width={barWidth} height={height} rx="3" className={`chart-bar${disableBarAnimation ? ' chart-bar--static' : ''}`} style={{ '--series-color': series.color, ...(disableBarAnimation ? {} : { animationDelay: `${point.index * 20}ms` }) } as CSSProperties}/>];
            }))}
        <g className="chart-x-labels">{chartXTicks.map((tick, index) => <text key={`${tick.position}-${categoryAxisIsScrollable ? index : tick.label}`} x={tick.position} y="218" textAnchor={categoryAxisIsScrollable ? 'middle' : chartXTicks.length === 1 ? 'middle' : index === 0 ? 'start' : index === chartXTicks.length - 1 ? 'end' : 'middle'}>{tick.label}</text>)}</g>
    </svg>;
    return <ScrollEdgeFrame<HTMLDivElement> className="chart-workspace-frame">{ref => <div ref={ref} className="chart-workspace animate-enter">
        <div className="chart-title-row"><div><span className="eyebrow">{chartCopy.visualExploration}</span><h3>{chartTitle}</h3><p>{suggestionReason}{chartKind !== 'heatmap' && chartRows.length < result.rows.length ? ` ${chartCopy.sampledForDisplay}` : ''}</p></div><div className="chart-controls">
            {chartKind !== 'number' && <label>{chartKind === 'scatter' ? chartCopy.xAxisMeasure : chartCopy.xAxis}<select value={xIndex} onChange={event => {
                const nextX = Number(event.target.value);
                const nextGroupCandidate = chartKind === 'heatmap' && nextX === groupByIndex ? result.columns.findIndex((_column, index) => index !== nextX && index !== yIndex) : groupByIndex;
                const nextGroupBy = nextGroupCandidate !== undefined && nextGroupCandidate >= 0 ? nextGroupCandidate : undefined;
                onChart({ ...chart, x: nextX, groupBy: nextGroupBy, ys: measureIndexes.filter(index => index !== nextX && index !== nextGroupBy) });
            }}>{result.columns.map((column, index) => <option value={index} key={index} disabled={chartKind === 'scatter' ? !numericIndexes.includes(index) || index === yIndex : index === yIndex || index === groupByIndex}>{column.name}</option>)}</select></label>}
            {chartKind === 'heatmap' && <label>{chartCopy.yAxis}<select value={groupByIndex ?? -1} onChange={event => onChart({ ...chart, groupBy: Number(event.target.value) })}>{result.columns.map((column, index) => <option value={index} key={index} disabled={index === xIndex || index === yIndex}>{column.name}</option>)}</select></label>}
            {chartKind === 'line' || chartKind === 'bar'
                ? <fieldset className="chart-measures"><legend>{chartCopy.measures}</legend>{availableMeasures.map(index => <label key={index}><input type="checkbox" checked={measureIndexes.includes(index)} disabled={measureIndexes.length === 1 && measureIndexes.includes(index)} onChange={event => {
                    const next = event.target.checked ? [...measureIndexes, index] : measureIndexes.filter(value => value !== index);
                    onChart({ ...chart, ys: next.slice(0, 5) });
                }}/><span style={{ '--series-color': seriesColor(Math.max(0, measureIndexes.indexOf(index))) } as CSSProperties}/>{result.columns[index]?.name}</label>)}</fieldset>
                : <label>{chartCopy.measure}<select value={yIndex} onChange={event => onChart({ ...chart, ys: [Number(event.target.value)] })}>{numericIndexes.map(index => <option value={index} key={index} disabled={index === xIndex || index === groupByIndex}>{result.columns[index]?.name}</option>)}</select></label>}
            <label>{chartCopy.type}<select value={chartKind} onChange={event => {
                const option = chartKindOptions.find(candidate => candidate.value === event.target.value);
                if (!option) return;
                if (option.value === 'candlestick') {
                    if (!canChooseCandlestick) return;
                    onChart({ ...chart, kind: 'candlestick', x: candleX, ys: [], candlestick: inferredCandle ?? {} });
                    return;
                }
                const nextGroupBy = option.value === 'heatmap' ? groupByIndex ?? result.columns.findIndex((_column, index) => index !== xIndex && index !== yIndex) : undefined;
                onChart({ ...chart, kind: option.value, groupBy: nextGroupBy !== undefined && nextGroupBy >= 0 ? nextGroupBy : undefined, ys: option.value === 'line' || option.value === 'bar' ? measureIndexes : [yIndex] });
            }}>{chartKindOptions.map(option => <option key={option.value} value={option.value} disabled={option.value === 'candlestick' && !canChooseCandlestick}>{chartTypeLabel(option.value, chartCopy)}</option>)}</select></label>
        </div></div>
        {chartKind === 'number' ? result.rows.length !== 1 ? <div className="chart-empty">{chartCopy.numberNeedsOneRow}</div> : !numericType(result.columns[yIndex]?.type ?? '') ? <div className="chart-empty">{chartCopy.chooseNumericColumn}</div> : <div className="chart-number-card"><span className="eyebrow">{chartCopy.singleValue}</span><strong>{displayValue(result.rows[0]?.[yIndex])}</strong><span>{result.columns[yIndex]?.name}</span><small>{chartCopy.exactResultValue}</small></div>
            : chartKind === 'heatmap'
                ? heatmapTooLarge ? <div className="chart-empty">{chartCopy.tooManyHeatmapLabels}</div>
                    : !heatmap || groupByIndex === undefined || heatmap.present.size === 0 ? <div className="chart-empty">{chartCopy.heatmapNeedsDimensions}</div>
                        : <ScrollEdgeFrame<HTMLDivElement> className="heatmap-scroll-frame">{ref => <div ref={ref} className="heatmap-scroll"><table className="heatmap-grid" aria-label={chartText(chartCopy.heatmapTableAria, { measure: result.columns[yIndex]?.name ?? '', groupBy: result.columns[groupByIndex]?.name ?? '', xAxis: result.columns[xIndex]?.name ?? '' })}>
                            <thead><tr><th className="heatmap-corner" scope="col">{result.columns[groupByIndex]?.name} / {result.columns[xIndex]?.name}</th>
                            {heatmapXLabels.map(label => <th className="heatmap-axis-label" scope="col" key={`x-${label}`}>{label}</th>)}</tr></thead>
                            <tbody>{heatmapYLabels.map(yLabel => <tr key={`y-${yLabel}`}><th className="heatmap-axis-label heatmap-row-label" scope="row" title={yLabel}>{yLabel}</th>{heatmapXLabels.map(xLabel => {
                                const key = heatmapCellKey(xLabel, yLabel);
                                const value = heatmap.cells.get(key);
                                const hasRow = heatmap.present.has(key);
                                const missing = !hasRow;
                                const cellDescription = missing ? result.completeness === 'truncated' ? chartCopy.heatmapNotRetained : chartCopy.heatmapNoReturnedRow : value === undefined ? chartCopy.heatmapNullMeasure : formatCount(value, locale);
                                const plotted = value ?? 0;
                                const intensity = heatmapMaximum > 0 ? plotted / heatmapMaximum : 0;
                                const displayNumber = value === undefined ? '·' : compactNumber.format(value);
                                return <td className="heatmap-cell" key={`${yLabel}-${xLabel}`} title={`${result.columns[groupByIndex]?.name}: ${yLabel} · ${result.columns[xIndex]?.name}: ${xLabel} · ${result.columns[yIndex]?.name}: ${cellDescription}`} aria-label={`${yLabel}, ${xLabel}: ${cellDescription}`} style={{ backgroundColor: missing || value === undefined ? 'var(--panel)' : `color-mix(in srgb, var(--accent) calc(${Math.round(intensity * 78)}% * var(--heatmap-strength, 1)), var(--panel-raised))`, color: `var(--heatmap-text, ${intensity > .55 ? 'var(--accent-ink)' : 'var(--text-soft)'})` }}>{missing ? '·' : displayNumber}</td>;
                            })}</tr>)}</tbody>
                        </table><div className="heatmap-caption">{chartText(chartCopy.heatmapCaption, { measure: result.columns[yIndex]?.name ?? '', rows: formatCount(heatmapYLabels.length, locale), columns: formatCount(heatmapXLabels.length, locale), note: result.completeness === 'truncated' ? chartCopy.heatmapTruncatedNote : chartCopy.heatmapCompleteNote })}</div></div>}</ScrollEdgeFrame>
                : chartKind === 'scatter' && (xIndex === yIndex || !numericIndexes.includes(xIndex) || !numericIndexes.includes(yIndex)) ? <div className="chart-empty">{chartCopy.scatterNeedsTwoNumeric}</div>
                    : !values.length ? <div className="chart-empty">{chartCopy.chooseNumericMeasure}</div>
                    : <div className={`chart-canvas${categoricalAxis ? ' chart-canvas--categorical' : ''}`}>
                        {categoricalAxis && <svg className="chart-category-y-axis" viewBox="0 0 80 230" preserveAspectRatio="none" aria-hidden="true">
                            {chartYTicks.map(tick => <text key={`${tick.position}-${tick.value}`} className="chart-y-tick-label" x="72" y={tick.position} textAnchor="end" dominantBaseline="middle">{compactNumber.format(tick.value)}</text>)}
                        </svg>}
                        {categoricalAxis
                            ? <ScrollEdgeFrame<HTMLDivElement> className="chart-category-scroll-frame">{ref => <div ref={ref} className="chart-category-scroll" tabIndex={0}>{renderChartSvg(true)}</div>}</ScrollEdgeFrame>
                            : renderChartSvg(false)}
                    </div>}
        <div className="chart-footer"><span className="chart-legend">{chartKind === 'heatmap'
            ? <><span className="chart-legend-dot"/>{result.columns[yIndex]?.name}</>
            : chartKind === 'line' || chartKind === 'bar'
                ? measureIndexes.map((index, seriesIndex) => <span key={index}><span className="chart-legend-dot" style={{ backgroundColor: seriesColor(seriesIndex), color: seriesColor(seriesIndex) }}/>{result.columns[index]?.name}</span>)
                : <><span className="chart-legend-dot" style={{ backgroundColor: seriesColor(0), color: seriesColor(0) }}/>{result.columns[yIndex]?.name}</>}</span><span>{chartKind === 'number' ? result.rows.length === 1 ? chartCopy.oneValue : chartText(chartCopy.retainedRows, { rows: formatCount(result.rows.length, locale) }) : chartKind === 'heatmap' ? chartText(chartCopy.populatedCells, { cells: formatCount(heatmap?.cells.size ?? 0, locale), rows: formatCount(result.rows.length, locale) }) : chartKind === 'scatter' ? chartText(chartCopy.plottedPoints, { points: formatCount(scatterPoints.length, locale) }) : rowSummary} <i>·</i> {result.completeness === 'truncated' ? chartCopy.retainedPrefixOnly : chartCopy.completeQueryResult}</span></div>
    </div>}</ScrollEdgeFrame>;
}
