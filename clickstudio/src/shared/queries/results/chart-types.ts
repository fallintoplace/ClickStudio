export const CHART_KINDS = [
    'table',
    'number',
    'line',
    'bar',
    'scatter',
    'heatmap',
    'candlestick',
] as const;
export type ChartKind = (typeof CHART_KINDS)[number];
