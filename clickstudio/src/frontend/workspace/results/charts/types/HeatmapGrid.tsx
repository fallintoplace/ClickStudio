import {
    type HeatmapPreparation,
    heatmapCellKey,
} from '../../../../../shared/queries/results/results';
import type { Result } from '../../../../../shared/queries/results/types';
import type { Copy, Locale } from '../../../../common/translations/i18n';
import { ScrollEdgeFrame } from '../../../../common/components/ScrollEdgeShadows';
import { chartText, formatCount } from '../chart-helpers';

export function HeatmapGrid({
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
}: {
    chartCopy: Copy['chart'];
    result: Result;
    yIndex: number;
    groupByIndex: number;
    xIndex: number;
    heatmapXLabels: string[];
    heatmapYLabels: string[];
    heatmap: HeatmapPreparation;
    locale: Locale;
    heatmapMaximum: number;
    compactNumber: Intl.NumberFormat;
}) {
    return (
        <ScrollEdgeFrame<HTMLDivElement> className="heatmap-scroll-frame">
            {ref => (
                <div ref={ref} className="heatmap-scroll">
                    <table
                        className="heatmap-grid"
                        aria-label={chartText(chartCopy.heatmapTableAria, {
                            measure: result.columns[yIndex]?.name ?? '',
                            groupBy: result.columns[groupByIndex]?.name ?? '',
                            xAxis: result.columns[xIndex]?.name ?? '',
                        })}
                    >
                        <thead>
                            <tr>
                                <th className="heatmap-corner" scope="col">
                                    {result.columns[groupByIndex]?.name} /{' '}
                                    {result.columns[xIndex]?.name}
                                </th>
                                {heatmapXLabels.map(label => (
                                    <th
                                        className="heatmap-axis-label"
                                        scope="col"
                                        key={`x-${label}`}
                                    >
                                        {label}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {heatmapYLabels.map(yLabel => (
                                <tr key={`y-${yLabel}`}>
                                    <th
                                        className="heatmap-axis-label heatmap-row-label"
                                        scope="row"
                                        title={yLabel}
                                    >
                                        {yLabel}
                                    </th>
                                    {heatmapXLabels.map(xLabel => {
                                        const key = heatmapCellKey(xLabel, yLabel);
                                        const value = heatmap.cells.get(key);
                                        const hasRow = heatmap.present.has(key);
                                        const missing = !hasRow;
                                        let cellDescription: string;

                                        if (missing) {
                                            if (result.completeness === 'truncated') {
                                                cellDescription = chartCopy.heatmapNotRetained;
                                            } else {
                                                cellDescription = chartCopy.heatmapNoReturnedRow;
                                            }
                                        } else if (value === undefined) {
                                            cellDescription = chartCopy.heatmapNullMeasure;
                                        } else {
                                            cellDescription = formatCount(value, locale);
                                        }
                                        const plotted = value ?? 0;
                                        const intensity =
                                            heatmapMaximum > 0 ? plotted / heatmapMaximum : 0;
                                        const displayNumber =
                                            value === undefined ? '·' : compactNumber.format(value);
                                        return (
                                            <td
                                                className="heatmap-cell"
                                                key={`${yLabel}-${xLabel}`}
                                                title={`${result.columns[groupByIndex]?.name}: ${yLabel} · ${result.columns[xIndex]?.name}: ${xLabel} · ${result.columns[yIndex]?.name}: ${cellDescription}`}
                                                aria-label={`${yLabel}, ${xLabel}: ${cellDescription}`}
                                                style={{
                                                    backgroundColor:
                                                        missing || value === undefined
                                                            ? 'var(--panel)'
                                                            : `color-mix(in srgb, var(--accent) calc(${Math.round(intensity * 78)}% * var(--heatmap-strength, 1)), var(--panel-raised))`,
                                                    color: `var(--heatmap-text, ${intensity > 0.55 ? 'var(--accent-ink)' : 'var(--text-soft)'})`,
                                                }}
                                            >
                                                {missing ? '·' : displayNumber}
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <div className="heatmap-caption">
                        {chartText(chartCopy.heatmapCaption, {
                            measure: result.columns[yIndex]?.name ?? '',
                            rows: formatCount(heatmapYLabels.length, locale),
                            columns: formatCount(heatmapXLabels.length, locale),
                            note:
                                result.completeness === 'truncated'
                                    ? chartCopy.heatmapTruncatedNote
                                    : chartCopy.heatmapCompleteNote,
                        })}
                    </div>
                </div>
            )}
        </ScrollEdgeFrame>
    );
}
