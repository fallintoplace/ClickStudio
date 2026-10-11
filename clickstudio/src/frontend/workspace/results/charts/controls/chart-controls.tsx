import type { ChartKind } from '../../../../../shared/queries/results/chart-types';
import type { CSSProperties } from 'react';
import { MAX_CHART_SERIES } from '../../../../../shared/queries/results/results';
import type { CandlestickConfig } from '../../../../../shared/queries/results/chart-settings';
import type { Result } from '../../../../../shared/queries/results/types';
import type { Row } from '../../../../../shared/common/values';
import type { Draft } from '../../../editor/drafts/workspace-state';
import type { Copy } from '../../../../common/translations/i18n';
import { ChartPopover, ChartToolbar } from '../ChartToolbar';
import { chartKindOptions, chartText, chartTypeLabel, seriesColor } from '../chart-helpers';

export function renderChartControls({
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
}: {
    chartTitle: string | undefined;
    suggestionReason: string;
    chartKind: Exclude<ChartKind, 'table'>;
    chartRows: Row[];
    result: Result;
    chartCopy: Copy['chart'];
    canChooseCandlestick: boolean;
    onChart: (chart: Draft['chart']) => void;
    chart: Draft['chart'];
    candleX: number;
    inferredCandle: CandlestickConfig | undefined;
    groupByIndex: number | undefined;
    xIndex: number;
    yIndex: number;
    measureIndexes: number[];
    numericIndexes: number[];
    availableMeasures: number[];
}) {
    return (
        <ChartToolbar
            title={chartTitle}
            description={`${suggestionReason}${chartKind !== 'heatmap' && chartRows.length < result.rows.length ? ` ${chartCopy.sampledForDisplay}` : ''}`}
            copy={chartCopy}
        >
            <label>
                {chartCopy.type}
                <select
                    value={chartKind}
                    onChange={event => {
                        const option = chartKindOptions.find(
                            candidate => candidate.value === event.target.value,
                        );
                        if (!option) return;
                        if (option.value === 'candlestick') {
                            if (!canChooseCandlestick) return;
                            onChart({
                                ...chart,
                                kind: 'candlestick',
                                x: candleX,
                                ys: [],
                                candlestick: inferredCandle ?? {},
                            });
                            return;
                        }
                        const nextGroupBy =
                            option.value === 'heatmap'
                                ? (groupByIndex ??
                                  result.columns.findIndex(
                                      (_column, index) => index !== xIndex && index !== yIndex,
                                  ))
                                : undefined;
                        onChart({
                            ...chart,
                            kind: option.value,
                            groupBy:
                                nextGroupBy !== undefined && nextGroupBy >= 0
                                    ? nextGroupBy
                                    : undefined,
                            ys:
                                option.value === 'line' || option.value === 'bar'
                                    ? measureIndexes
                                    : [yIndex],
                        });
                    }}
                >
                    {chartKindOptions.map(option => (
                        <option
                            key={option.value}
                            value={option.value}
                            disabled={option.value === 'candlestick' && !canChooseCandlestick}
                        >
                            {chartTypeLabel(option.value, chartCopy)}
                        </option>
                    ))}
                </select>
            </label>
            {chartKind !== 'number' && (
                <label>
                    {chartKind === 'scatter' ? chartCopy.xAxisMeasure : chartCopy.xAxis}
                    <select
                        value={xIndex}
                        onChange={event => {
                            const nextX = Number(event.target.value);
                            const nextGroupCandidate =
                                chartKind === 'heatmap' && nextX === groupByIndex
                                    ? result.columns.findIndex(
                                          (_column, index) => index !== nextX && index !== yIndex,
                                      )
                                    : groupByIndex;
                            const nextGroupBy =
                                nextGroupCandidate !== undefined && nextGroupCandidate >= 0
                                    ? nextGroupCandidate
                                    : undefined;
                            onChart({
                                ...chart,
                                x: nextX,
                                groupBy: nextGroupBy,
                                ys: measureIndexes.filter(
                                    index => index !== nextX && index !== nextGroupBy,
                                ),
                            });
                        }}
                    >
                        {result.columns.map((column, index) => (
                            <option
                                value={index}
                                key={index}
                                disabled={
                                    chartKind === 'scatter'
                                        ? !numericIndexes.includes(index) || index === yIndex
                                        : index === yIndex || index === groupByIndex
                                }
                            >
                                {column.name}
                            </option>
                        ))}
                    </select>
                </label>
            )}
            {chartKind === 'heatmap' && (
                <label>
                    {chartCopy.yAxis}
                    <select
                        value={groupByIndex ?? -1}
                        onChange={event =>
                            onChart({ ...chart, groupBy: Number(event.target.value) })
                        }
                    >
                        {result.columns.map((column, index) => (
                            <option
                                value={index}
                                key={index}
                                disabled={index === xIndex || index === yIndex}
                            >
                                {column.name}
                            </option>
                        ))}
                    </select>
                </label>
            )}
            {chartKind === 'line' || chartKind === 'bar' ? (
                <ChartPopover
                    label={chartCopy.measures}
                    closeLabel={chartCopy.closeControls}
                    trigger={
                        <>
                            <span>{chartCopy.measures}</span>
                            <span
                                className="chart-legend-dot"
                                style={{
                                    backgroundColor: seriesColor(0),
                                    color: seriesColor(0),
                                }}
                            />
                            <span
                                className="chart-measure-summary"
                                title={measureIndexes
                                    .map(index => result.columns[index]?.name)
                                    .join(', ')}
                            >
                                {result.columns[yIndex]?.name}
                                {measureIndexes.length > 1 && ` +${measureIndexes.length - 1}`}
                            </span>
                        </>
                    }
                >
                    <fieldset className="chart-measures">
                        <legend>{chartCopy.measures}</legend>
                        {availableMeasures.map(index => (
                            <label key={index}>
                                <input
                                    type="checkbox"
                                    checked={measureIndexes.includes(index)}
                                    disabled={
                                        measureIndexes.includes(index)
                                            ? measureIndexes.length === 1
                                            : measureIndexes.length >= MAX_CHART_SERIES
                                    }
                                    onChange={event => {
                                        const next = event.target.checked
                                            ? [...measureIndexes, index]
                                            : measureIndexes.filter(value => value !== index);
                                        onChart({
                                            ...chart,
                                            ys: next.slice(0, MAX_CHART_SERIES),
                                        });
                                    }}
                                />
                                <span
                                    style={
                                        {
                                            '--series-color': seriesColor(
                                                Math.max(0, measureIndexes.indexOf(index)),
                                            ),
                                        } as CSSProperties
                                    }
                                />
                                {result.columns[index]?.name}
                            </label>
                        ))}
                    </fieldset>
                    <p>{chartText(chartCopy.measureLimit, { count: MAX_CHART_SERIES })}</p>
                </ChartPopover>
            ) : (
                <label>
                    {chartCopy.measure}
                    <select
                        value={yIndex}
                        onChange={event => onChart({ ...chart, ys: [Number(event.target.value)] })}
                    >
                        {numericIndexes.map(index => (
                            <option
                                value={index}
                                key={index}
                                disabled={index === xIndex || index === groupByIndex}
                            >
                                {result.columns[index]?.name}
                            </option>
                        ))}
                    </select>
                </label>
            )}
        </ChartToolbar>
    );
}
