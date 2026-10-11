import type { Result } from '../../../../shared/queries/results/types';
import type { Draft } from '../../editor/drafts/workspace-state';
import type { Copy, Locale } from '../../../common/translations/i18n';
import { RowCountChart } from './types/RowCountChart';
import { useChartPlotWidth } from './useChartPlotWidth';
import { prepareChartSelection } from './controls/chart-selection';
import { prepareChartView } from './rendering/chart-view-model';
import { renderCandlestickChart } from './types/candlestick-chart-view';
import { createChartSvgRenderer } from './rendering/chart-svg-renderer';
import { Spinner } from '../../../common/components/ui';
import { renderChartWorkspace } from './controls/chart-workspace';

export function ChartView({
    result,
    loading,
    chart,
    onChart,
    copy,
    locale,
}: {
    result?: Result;
    loading: boolean;
    chart: Draft['chart'];
    onChart: (chart: Draft['chart']) => void;
    copy: Copy;
    locale: Locale;
}) {
    const { width: categoryViewportWidth, onViewport: onCategoryViewport } = useChartPlotWidth();
    const chartCopy = copy.chart;
    if (loading || !result)
        return (
            <div className="result-loading">
                <Spinner />
                <span>{chartCopy.preparing}</span>
            </div>
        );
    if (!result.columns.length) return <div className="chart-empty">{chartCopy.noColumns}</div>;

    const selection = prepareChartSelection(result, chart);
    const { suggestion, numericIndexes } = selection;
    if (
        chart.kind === 'candlestick' ||
        (chart.kind === 'table' && suggestion.config.kind === 'candlestick')
    )
        return renderCandlestickChart({ result, chart, onChart, chartCopy, locale, selection });
    if (!numericIndexes.length)
        return (
            <RowCountChart
                result={result}
                chart={chart}
                suggestion={suggestion}
                onChart={onChart}
                copy={chartCopy}
                locale={locale}
            />
        );
    const model = prepareChartView({
        result,
        chart,
        chartCopy,
        locale,
        categoryViewportWidth,
        selection,
    });
    const renderChartSvg = createChartSvgRenderer(model.svg);
    return renderChartWorkspace({ ...model, onChart, onCategoryViewport, renderChartSvg });
}
