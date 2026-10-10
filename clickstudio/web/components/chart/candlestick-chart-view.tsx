import type { CandlestickConfig, Result } from '../../../shared/types';
import type { Draft } from '../../workspace-state';
import type { Copy, Locale } from '../../i18n';
import { CandlestickChart } from '../CandlestickChart';
import { ChartPopover, ChartToolbar } from '../ChartToolbar';
import { ScrollEdgeFrame } from '../ScrollEdgeShadows';
import { chartKindOptions, chartTypeLabel } from '../chart-helpers';
import type { prepareChartSelection } from './chart-selection';

export function renderCandlestickChart({
    result,
    chart,
    onChart,
    chartCopy,
    locale,
    selection,
}: {
    result: Result;
    chart: Draft['chart'];
    onChart: (chart: Draft['chart']) => void;
    chartCopy: Copy['chart'];
    locale: Locale;
    selection: ReturnType<typeof prepareChartSelection>;
}) {
    const {
        activeCandle,
        candleX,
        numericIndexes,
        inferredCandle,
        canChooseCandlestick,
        activeCandleValid,
    } = selection;
    const candle = activeCandle ?? {};
    const patchCandle = (
        field: 'open' | 'high' | 'low' | 'close' | 'bid' | 'ask' | 'spread' | 'quoteActivity',
        value: string,
    ) => {
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
        onChart({
            ...chart,
            kind: option.value,
            ...(option.value === 'candlestick'
                ? { x: candleX, ys: [], candlestick: inferredCandle ?? {} }
                : { ys: numericIndexes.slice(0, 1) }),
        });
    };
    const candleColumns = (selected: number | undefined) => (
        <>
            <option value="">—</option>
            {numericIndexes.map(index => (
                <option
                    value={index}
                    key={index}
                    disabled={
                        index !== selected &&
                        [candle.open, candle.high, candle.low, candle.close].includes(index)
                    }
                >
                    {result.columns[index]?.name}
                </option>
            ))}
        </>
    );
    const optionalColumns = (selected: number | undefined) => (
        <>
            <option value="">—</option>
            {numericIndexes.map(index => (
                <option
                    value={index}
                    key={index}
                    disabled={
                        index !== selected &&
                        [candle.open, candle.high, candle.low, candle.close].includes(index)
                    }
                >
                    {result.columns[index]?.name}
                </option>
            ))}
        </>
    );
    return renderCandlestickControls({
        chart,
        chartCopy,
        updateKind,
        canChooseCandlestick,
        candleX,
        onChart,
        candle,
        result,
        patchCandle,
        candleColumns,
        optionalColumns,
        activeCandleValid,
        locale,
    });
}

function renderCandlestickControls({
    chart,
    chartCopy,
    updateKind,
    canChooseCandlestick,
    candleX,
    onChart,
    candle,
    result,
    patchCandle,
    candleColumns,
    optionalColumns,
    activeCandleValid,
    locale,
}: {
    chart: Draft['chart'];
    chartCopy: Copy['chart'];
    updateKind: (value: string) => void;
    canChooseCandlestick: boolean;
    candleX: number;
    onChart: (chart: Draft['chart']) => void;
    candle: CandlestickConfig;
    result: Result;
    patchCandle: (
        field: 'open' | 'high' | 'low' | 'close' | 'bid' | 'ask' | 'spread' | 'quoteActivity',
        value: string,
    ) => void;
    candleColumns: (selected: number | undefined) => import('react').ReactElement;
    optionalColumns: (selected: number | undefined) => import('react').ReactElement;
    activeCandleValid: boolean;
    locale: Locale;
}) {
    return (
        <ScrollEdgeFrame<HTMLDivElement> className="chart-workspace-frame">
            {ref => (
                <div ref={ref} className="chart-workspace animate-enter">
                    <ChartToolbar
                        title={chart.title !== 'Query result' ? chart.title : undefined}
                        description={`${chartCopy.returnedData}. ${chartCopy.candlestickDisplayNote}`}
                        copy={chartCopy}
                    >
                        <label>
                            {chartCopy.type}
                            <select
                                value="candlestick"
                                onChange={event => updateKind(event.target.value)}
                            >
                                {chartKindOptions.map(option => (
                                    <option
                                        key={option.value}
                                        value={option.value}
                                        disabled={
                                            option.value === 'candlestick' && !canChooseCandlestick
                                        }
                                    >
                                        {chartTypeLabel(option.value, chartCopy)}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label>
                            {chartCopy.xAxis}
                            <select
                                value={candleX}
                                onChange={event =>
                                    onChart({
                                        ...chart,
                                        kind: 'candlestick',
                                        x: Number(event.target.value),
                                        ys: [],
                                        candlestick: { ...candle },
                                    })
                                }
                            >
                                {result.columns.map((column, index) => (
                                    <option value={index} key={index}>
                                        {column.name}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <ChartPopover
                            label={chartCopy.setup}
                            closeLabel={chartCopy.closeControls}
                            trigger={chartCopy.setup}
                        >
                            <div className="chart-setup-fields">
                                {(['open', 'high', 'low', 'close'] as const).map(field => (
                                    <label key={field}>
                                        {chartCopy[`${field}Label`]}
                                        <select
                                            value={candle[field] ?? ''}
                                            onChange={event =>
                                                patchCandle(field, event.target.value)
                                            }
                                        >
                                            {candleColumns(candle[field])}
                                        </select>
                                    </label>
                                ))}
                                {(['bid', 'ask', 'spread', 'quoteActivity'] as const).map(field => (
                                    <label key={field}>
                                        {field === 'bid' || field === 'ask'
                                            ? field.toUpperCase()
                                            : field === 'spread'
                                              ? chartCopy.spreadBps
                                              : chartCopy.quoteActivity}
                                        <select
                                            value={candle[field] ?? ''}
                                            onChange={event =>
                                                patchCandle(field, event.target.value)
                                            }
                                        >
                                            {optionalColumns(candle[field])}
                                        </select>
                                    </label>
                                ))}
                            </div>
                        </ChartPopover>
                    </ChartToolbar>
                    {!activeCandleValid ? (
                        <div className="chart-empty" role="status">
                            {chartCopy.noValidCandles}
                        </div>
                    ) : (
                        <CandlestickChart
                            result={result}
                            config={candle}
                            x={candleX}
                            copy={chartCopy}
                            locale={locale}
                        />
                    )}
                </div>
            )}
        </ScrollEdgeFrame>
    );
}
