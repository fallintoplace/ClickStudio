import { useEffect, useMemo, useRef, useState } from 'react';
import { area, axisBottom, axisLeft, bisector, brushX, curveMonotoneX, extent, line, max, pointer, scaleLinear, scaleUtc, select } from 'd3';
import { chartNumber, chartTimestamp, MAX_CHART_RENDER_POINTS } from '../../shared/results';
import type { CandlestickConfig, Column, Json, Result } from '../../shared/types';
import type { Copy, Locale } from '../i18n';
import { ScrollEdgeFrame } from './ScrollEdgeShadows';

interface Candle {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    bid?: number;
    ask?: number;
    spread?: number;
    quoteActivity?: number;
    sourceRows: number;
}

interface Props {
    result: Result;
    config: CandlestickConfig;
    x: number;
    copy: Copy['chart'];
    locale: Locale;
}

const WIDTH = 1280;
const HEIGHT = 720;
const LEFT = 74;
const RIGHT = 1252;
const PRICE_TOP = 42;
const PRICE_BOTTOM = 360;
const ACTIVITY_TOP = 421;
const ACTIVITY_BOTTOM = 492;
const SPREAD_TOP = 536;
const SPREAD_BOTTOM = 610;
const NAV_TOP = 658;
const NAV_BOTTOM = 696;

function indexValue(row: Json[], index: number | undefined) {
    return index === undefined ? null : chartNumber(row[index]);
}

function toCandles(result: Result, x: number, config: CandlestickConfig): Candle[] {
    return result.rows.flatMap(row => {
        const time = chartTimestamp(row[x]);
        const open = indexValue(row, config.open);
        const high = indexValue(row, config.high);
        const low = indexValue(row, config.low);
        const close = indexValue(row, config.close);
        if (time === null || open === null || high === null || low === null || close === null || high < Math.max(open, close) || low > Math.min(open, close)) return [];
        const bid = indexValue(row, config.bid);
        const ask = indexValue(row, config.ask);
        const spread = indexValue(row, config.spread);
        const quoteActivity = indexValue(row, config.quoteActivity);
        return [{ time, open, high, low, close, ...(bid === null ? {} : { bid }), ...(ask === null ? {} : { ask }), ...(spread === null ? {} : { spread }), ...(quoteActivity === null ? {} : { quoteActivity }), sourceRows: 1 }];
    }).sort((left, right) => left.time - right.time);
}

function aggregateForDisplay(input: Candle[], maximum = MAX_CHART_RENDER_POINTS * 3): Candle[] {
    if (input.length <= maximum) return input;
    const size = Math.ceil(input.length / maximum);
    const output: Candle[] = [];
    for (let start = 0; start < input.length; start += size) {
        const group = input.slice(start, start + size);
        const first = group[0]!;
        const last = group.at(-1)!;
        const activity = group.reduce((sum, candle) => sum + (candle.quoteActivity ?? 0), 0);
        const spreadWeight = group.reduce((sum, candle) => sum + (candle.spread === undefined ? 0 : candle.quoteActivity ?? 1), 0);
        const spread = spreadWeight
            ? group.reduce((sum, candle) => sum + (candle.spread ?? 0) * (candle.quoteActivity ?? 1), 0) / spreadWeight
            : undefined;
        output.push({
            time: first.time, open: first.open, high: Math.max(...group.map(candle => candle.high)), low: Math.min(...group.map(candle => candle.low)), close: last.close,
            ...(last.bid === undefined ? {} : { bid: last.bid }), ...(last.ask === undefined ? {} : { ask: last.ask }),
            ...(spread === undefined ? {} : { spread }), ...(group.some(candle => candle.quoteActivity !== undefined) ? { quoteActivity: activity } : {}), sourceRows: group.length,
        });
    }
    return output;
}

function labelFor(columns: Column[], index: number | undefined, fallback: string) {
    return index === undefined ? fallback : columns[index]?.name ?? fallback;
}

export function CandlestickChart({ result, config, x, copy, locale }: Props) {
    const svgRef = useRef<SVGSVGElement>(null);
    const candles = useMemo(() => aggregateForDisplay(toCandles(result, x, config)), [result, x, config]);
    const [windowRange, setWindowRange] = useState<[number, number] | undefined>();
    const [rangePreset, setRangePreset] = useState<'all' | '1d' | '3d' | 'custom'>('all');

    useEffect(() => {
        const svgElement = svgRef.current;
        if (!svgElement || !candles.length) return;
        const svg = select(svgElement);
        svg.selectAll('*').remove();
        const root = svg.append('g');
        const [domainStart, domainEnd] = extent(candles, candle => new Date(candle.time));
        if (!domainStart || !domainEnd) return;
        const fullDomain: [Date, Date] = [
            domainStart,
            +domainStart === +domainEnd ? new Date(+domainEnd + 60_000) : domainEnd,
        ];
        const clampedRange: [number, number] | undefined = windowRange?.every(Number.isFinite)
            ? [Math.max(+fullDomain[0], windowRange[0]), Math.min(+fullDomain[1], windowRange[1])]
            : undefined;
        const domain: [Date, Date] = clampedRange && clampedRange[0] < clampedRange[1]
            ? [new Date(clampedRange[0]), new Date(clampedRange[1])]
            : fullDomain;
        const visible = candles.filter(candle => candle.time >= +domain[0] && candle.time <= +domain[1]);
        const plotted = visible.length ? visible : candles;
        const upColor = 'var(--green)';
        const downColor = 'var(--red)';
        const bidAskColor = 'var(--accent)';
        const gridColor = 'var(--line-bright)';
        const textColor = 'var(--muted)';
        const mono = getComputedStyle(svgElement).getPropertyValue('--font-mono').trim() || 'monospace';
        const xScale = scaleUtc().domain(domain).range([LEFT, RIGHT]);
        const low = Math.min(...plotted.map(candle => candle.low), ...plotted.flatMap(candle => candle.bid === undefined ? [] : [candle.bid]));
        const high = Math.max(...plotted.map(candle => candle.high), ...plotted.flatMap(candle => candle.ask === undefined ? [] : [candle.ask]));
        const padding = (high - low || Math.abs(high) * .001 || 1) * .08;
        const price = scaleLinear().domain([low - padding, high + padding]).nice(6).range([PRICE_BOTTOM, PRICE_TOP]);
        const priceFormatter = new Intl.NumberFormat(locale, { useGrouping: false, maximumSignificantDigits: 8 });
        const spreadFormatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 });
        const priceTicks = axisLeft(price).ticks(6).tickSize(-(RIGHT - LEFT)).tickFormat(value => priceFormatter.format(Number(value)));
        const priceAxis = root.append('g').attr('class', 'market-axis').attr('transform', `translate(${LEFT},0)`).call(priceTicks);
        priceAxis.select('.domain').remove();
        priceAxis.selectAll('.tick line').attr('stroke', gridColor).attr('stroke-dasharray', '3 5').attr('opacity', .7);
        priceAxis.selectAll('.tick text').attr('fill', textColor).attr('font-family', mono).attr('font-size', 11).attr('dx', -7);
        const dateFormat = new Intl.DateTimeFormat(locale, { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
        const xAxis = root.append('g').attr('class', 'market-axis').attr('transform', `translate(0,${PRICE_BOTTOM})`).call(axisBottom(xScale).ticks(8).tickFormat(value => dateFormat.format(value as Date)).tickSize(0));
        xAxis.select('.domain').attr('stroke', gridColor);
        xAxis.selectAll('.tick text').attr('fill', textColor).attr('font-family', mono).attr('font-size', 10).attr('dy', 14);
        root.append('text').attr('class', 'market-pane-label').attr('x', LEFT).attr('y', 22).text(copy.priceLabel);

        const candleG = root.append('g').attr('class', 'market-candles');
        if (plotted.some(candle => candle.bid !== undefined && candle.ask !== undefined)) {
            const band = area<Candle>().defined(candle => candle.bid !== undefined && candle.ask !== undefined).x(candle => xScale(new Date(candle.time)).valueOf()).y0(candle => price(candle.bid!)).y1(candle => price(candle.ask!)).curve(curveMonotoneX);
            candleG.append('path').datum(plotted).attr('class', 'market-bid-ask-band').attr('d', band).attr('fill', bidAskColor).attr('opacity', .12);
            const bidLine = line<Candle>().defined(candle => candle.bid !== undefined).x(candle => xScale(new Date(candle.time)).valueOf()).y(candle => price(candle.bid!)).curve(curveMonotoneX);
            const askLine = line<Candle>().defined(candle => candle.ask !== undefined).x(candle => xScale(new Date(candle.time)).valueOf()).y(candle => price(candle.ask!)).curve(curveMonotoneX);
            candleG.append('path').datum(plotted).attr('class', 'market-bid-line').attr('d', bidLine).attr('fill', 'none').attr('stroke', bidAskColor).attr('stroke-width', 1.1).attr('opacity', .72);
            candleG.append('path').datum(plotted).attr('class', 'market-ask-line').attr('d', askLine).attr('fill', 'none').attr('stroke', bidAskColor).attr('stroke-width', 1.1).attr('stroke-dasharray', '4 3').attr('opacity', .72);
        }
        const candleSpacings = plotted.slice(1).map((candle, index) => xScale(new Date(candle.time)) - xScale(new Date(plotted[index]!.time))).filter(Number.isFinite).map(value => Math.max(1, value));
        const spacing = candleSpacings.length ? Math.min(...candleSpacings) : RIGHT - LEFT;
        const candleWidth = Math.max(1, Math.min(11, spacing * .72));
        const groups = candleG.selectAll<SVGGElement, Candle>('g.market-candle').data(plotted).join('g').attr('class', 'market-candle').attr('data-time', candle => candle.time);
        groups.append('line').attr('class', 'market-wick').attr('x1', candle => xScale(new Date(candle.time))).attr('x2', candle => xScale(new Date(candle.time))).attr('y1', candle => price(candle.high)).attr('y2', candle => price(candle.low)).attr('stroke', candle => candle.close >= candle.open ? upColor : downColor).attr('stroke-width', 1.25);
        groups.append('rect').attr('class', 'market-candle-body').attr('x', candle => xScale(new Date(candle.time)) - candleWidth / 2).attr('y', candle => price(Math.max(candle.open, candle.close))).attr('width', candleWidth).attr('height', candle => Math.max(1.5, Math.abs(price(candle.open) - price(candle.close)))).attr('rx', 1).attr('fill', candle => candle.close >= candle.open ? upColor : downColor).attr('stroke', candle => candle.close >= candle.open ? upColor : downColor);
        groups.append('title').text(candle => `${dateFormat.format(candle.time)} · O ${candle.open} · H ${candle.high} · L ${candle.low} · C ${candle.close}`);

        const activityValues = plotted.flatMap(candle => candle.quoteActivity === undefined ? [] : [candle.quoteActivity]);
        const activityScale = scaleLinear().domain([0, max(activityValues) || 1]).nice(3).range([ACTIVITY_BOTTOM, ACTIVITY_TOP]);
        root.append('text').attr('class', 'market-pane-label').attr('x', LEFT).attr('y', ACTIVITY_TOP - 10).text(copy.quoteActivity);
        root.append('line').attr('x1', LEFT).attr('x2', RIGHT).attr('y1', ACTIVITY_BOTTOM).attr('y2', ACTIVITY_BOTTOM).attr('stroke', gridColor);
        if (activityValues.length) root.append('g').selectAll('rect').data(plotted.filter(candle => candle.quoteActivity !== undefined)).join('rect').attr('class', 'market-activity-bar').attr('x', candle => xScale(new Date(candle.time)) - candleWidth / 2).attr('width', Math.max(1, candleWidth)).attr('y', candle => activityScale(candle.quoteActivity!)).attr('height', candle => Math.max(0, ACTIVITY_BOTTOM - activityScale(candle.quoteActivity!))).attr('fill', bidAskColor).attr('opacity', .58);
        else root.append('text').attr('class', 'market-pane-empty').attr('x', LEFT).attr('y', ACTIVITY_TOP + 34).text(copy.quoteActivityUnavailable);

        const spreadValues = plotted.flatMap(candle => candle.spread === undefined ? [] : [candle.spread]);
        const spreadExtent = extent(spreadValues) as [number, number];
        const spreadRange = spreadExtent[0] === undefined ? [0, 1] as [number, number] : spreadExtent[0] === spreadExtent[1] ? [spreadExtent[0] * .95, spreadExtent[1] * 1.05 || spreadExtent[0] + 1] as [number, number] : spreadExtent;
        const spreadScale = scaleLinear().domain(spreadRange).nice(3).range([SPREAD_BOTTOM, SPREAD_TOP]);
        root.append('text').attr('class', 'market-pane-label').attr('x', LEFT).attr('y', SPREAD_TOP - 10).text(copy.spreadBps);
        if (spreadValues.length) {
            const spreadAxis = root.append('g').attr('class', 'market-axis market-small-axis').attr('transform', `translate(${LEFT},0)`).call(axisLeft(spreadScale).ticks(3).tickSize(-(RIGHT - LEFT)).tickFormat(value => Number(value).toFixed(2)));
            spreadAxis.select('.domain').remove();
            spreadAxis.selectAll('.tick line').attr('stroke', gridColor).attr('stroke-dasharray', '3 5').attr('opacity', .55);
            spreadAxis.selectAll('.tick text').attr('fill', textColor).attr('font-family', mono).attr('font-size', 9).attr('dx', -7);
            const spreadLine = line<Candle>().defined(candle => candle.spread !== undefined).x(candle => xScale(new Date(candle.time)).valueOf()).y(candle => spreadScale(candle.spread!)).curve(curveMonotoneX);
            root.append('path').datum(plotted).attr('class', 'market-spread-line').attr('d', spreadLine).attr('fill', 'none').attr('stroke', 'var(--amber)').attr('stroke-width', 1.8);
        } else root.append('text').attr('class', 'market-pane-empty').attr('x', LEFT).attr('y', SPREAD_TOP + 34).text(copy.spreadUnavailable);

        const overview = scaleUtc().domain(fullDomain).range([LEFT, RIGHT]);
        const navigatorY = scaleLinear().domain(extent(candles, candle => candle.close) as [number, number]).nice().range([NAV_BOTTOM, NAV_TOP]);
        const navigatorLine = line<Candle>().x(candle => overview(new Date(candle.time))).y(candle => navigatorY(candle.close)).curve(curveMonotoneX);
        root.append('path').datum(candles).attr('class', 'market-navigator-line').attr('d', navigatorLine).attr('fill', 'none').attr('stroke', bidAskColor).attr('stroke-width', 1.5);
        const brush = brushX().extent([[LEFT, NAV_TOP - 5], [RIGHT, NAV_BOTTOM + 5]]).on('end', event => {
            if (!event.sourceEvent) return;
            if (!event.selection) { setWindowRange(undefined); setRangePreset('all'); return; }
            const selection = event.selection as [number, number];
            const next: [number, number] = [overview.invert(selection[0]).getTime(), overview.invert(selection[1]).getTime()];
            setWindowRange(next);
            setRangePreset('custom');
        });
        const brushGroup = root.append('g').attr('class', 'market-brush').call(brush);
        const initialSelection = domain.map(value => overview(value)) as [number, number];
        brushGroup.call(brush.move, initialSelection);
        brushGroup.selectAll('.selection').attr('fill', bidAskColor).attr('fill-opacity', .13).attr('stroke', bidAskColor);
        brushGroup.selectAll('.handle').attr('fill', bidAskColor).attr('stroke', bidAskColor);

        const interaction = root.append('rect').attr('class', 'market-interaction').attr('x', LEFT).attr('y', PRICE_TOP).attr('width', RIGHT - LEFT).attr('height', PRICE_BOTTOM - PRICE_TOP).attr('fill', 'transparent').style('pointer-events', 'all');
        const crosshair = root.append('g').attr('class', 'market-crosshair').style('display', 'none').attr('pointer-events', 'none');
        crosshair.append('line').attr('class', 'market-crosshair-line').attr('y1', PRICE_TOP).attr('y2', PRICE_BOTTOM).attr('stroke', textColor).attr('stroke-dasharray', '3 3');
        crosshair.append('circle').attr('r', 4).attr('fill', bidAskColor).attr('stroke', 'var(--panel)');
        const tooltip = crosshair.append('g').attr('class', 'market-tooltip');
        tooltip.append('rect').attr('width', 214).attr('height', 122).attr('rx', 8).attr('fill', 'var(--panel)').attr('stroke', 'var(--line-bright)').attr('opacity', .97);
        const bisect = bisector<Candle, number>(candle => candle.time).center;
        interaction.on('pointermove', event => {
            const [mouseX] = pointer(event, svgElement);
            const target = xScale.invert(mouseX).getTime();
            const candle = plotted[bisect(plotted, target)] ?? plotted[0]!;
            const cx = xScale(new Date(candle.time));
            crosshair.style('display', null).attr('transform', null);
            crosshair.select('line').attr('x1', cx).attr('x2', cx);
            crosshair.select('circle').attr('cx', cx).attr('cy', price(candle.close));
            const tooltipX = cx > RIGHT - 230 ? cx - 224 : cx + 10;
            const tooltipY = PRICE_TOP + 10;
            tooltip.attr('transform', `translate(${tooltipX},${tooltipY})`).selectAll('text').remove();
            const tipRows = [
                dateFormat.format(candle.time),
                `${copy.openLabel}: ${priceFormatter.format(candle.open)}`,
                `${copy.highLabel}: ${priceFormatter.format(candle.high)}`,
                `${copy.lowLabel}: ${priceFormatter.format(candle.low)}`,
                `${copy.closeLabel}: ${priceFormatter.format(candle.close)}`,
                ...(candle.bid === undefined || candle.ask === undefined ? [] : [`${copy.bidAskLabel}: ${priceFormatter.format(candle.bid)} / ${priceFormatter.format(candle.ask)}`]),
                ...(candle.spread === undefined ? [] : [`${copy.spreadBps}: ${spreadFormatter.format(candle.spread)}`]),
                ...(candle.quoteActivity === undefined ? [] : [`${copy.quoteActivity}: ${new Intl.NumberFormat(locale).format(candle.quoteActivity)}`]),
            ];
            tooltip.select('rect').attr('height', 16 + tipRows.length * 15);
            tooltip.selectAll<SVGTextElement, string>('text').data(tipRows).join('text').attr('x', 10).attr('y', (_row, index) => 20 + index * 15).attr('fill', (_row, index) => index === 0 ? 'var(--text)' : 'var(--text-soft)').attr('font-family', mono).attr('font-size', (_row, index) => index === 0 ? 10 : 9).text(row => row);
        }).on('pointerleave', () => crosshair.style('display', 'none'));
    }, [candles, copy, locale, windowRange]);

    const rawCount = result.rows.length;
    const start = candles[0]?.time;
    const end = candles.at(-1)?.time;
    const setPreset = (preset: 'all' | '1d' | '3d') => {
        setRangePreset(preset);
        if (start === undefined || end === undefined || preset === 'all') { setWindowRange(undefined); return; }
        const duration = preset === '1d' ? 24 * 60 * 60 * 1000 : 3 * 24 * 60 * 60 * 1000;
        setWindowRange([Math.max(start, end - duration), end]);
    };
    const tooltipLabel = `${labelFor(result.columns, config.open, copy.openLabel)} / ${labelFor(result.columns, config.high, copy.highLabel)} / ${labelFor(result.columns, config.low, copy.lowLabel)} / ${labelFor(result.columns, config.close, copy.closeLabel)}`;

    if (!candles.length) return <div className="chart-empty" role="status">{copy.noValidCandles}</div>;
    return <section className="market-chart" aria-label={`${copy.candlestickType}: ${tooltipLabel}`}>
        <div className="market-chart-toolbar">
            <div className="market-chart-badges"><span>{copy.returnedData}</span><span>{copy.midpointCandles}</span><span>{result.completeness === 'truncated' ? copy.retainedPrefixOnly : copy.completeQueryResult}</span></div>
            <div className="market-range-presets" role="group" aria-label={copy.chartRange}>
                {(['1d', '3d', 'all'] as const).map(preset => <button type="button" key={preset} aria-pressed={rangePreset === preset} onClick={() => setPreset(preset)}>{preset === '1d' ? copy.oneDayRange : preset === '3d' ? copy.threeDayRange : copy.allRange}</button>)}
            </div>
        </div>
        <ScrollEdgeFrame<HTMLDivElement> className="market-chart-canvas-frame">{ref => <div ref={ref} className="market-chart-canvas"><svg ref={svgRef} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`${copy.candlestickType} · ${candles.length} ${copy.candlesLabel}`}>
            <title>{copy.candlestickType}: {tooltipLabel}</title>
        </svg></div>}</ScrollEdgeFrame>
        <div className="market-chart-legend">
            <span><i className="market-legend-candle-up"/>{copy.priceLabel}</span>
            {config.bid !== undefined && config.ask !== undefined && <span><i className="market-legend-bidask"/>{copy.bidAskLabel}</span>}
            {config.quoteActivity !== undefined && <span><i className="market-legend-activity"/>{copy.quoteActivity}</span>}
            {config.spread !== undefined && <span><i className="market-legend-spread"/>{copy.spreadBps}</span>}
            <span className="market-chart-summary">{copy.candlestickSummary.replace('{candles}', new Intl.NumberFormat(locale).format(candles.length)).replace('{rows}', new Intl.NumberFormat(locale).format(rawCount))}</span>
        </div>
        <p className="market-chart-note">{copy.brushRangeHint}</p>
    </section>;
}
