import { CHART_KINDS } from '../../../../shared/queries/results/chart-types.js';
import type { Draft } from '../../editor/drafts/workspace-state.js';
import type { Copy, Locale } from '../../../common/translations/i18n.js';

export const chartKindOptions = CHART_KINDS.filter(kind => kind !== 'table').map(value => ({
    value,
}));

const chartColors = [
    'var(--accent)',
    'var(--green)',
    'var(--amber)',
    'var(--red)',
    'var(--violet)',
] as const;
export const seriesColor = (index: number) => chartColors[index % chartColors.length]!;
export type ChartPoint = { label: string; value: number | null; index: number };

export function chartText(template: string, values: Record<string, string | number> = {}) {
    return template.replace(/\{(\w+)\}/g, (_match, key: string) => String(values[key] ?? ''));
}

export function chartTypeLabel(kind: Draft['chart']['kind'], copy: Copy['chart']) {
    return {
        number: copy.numberType,
        line: copy.lineType,
        bar: copy.barType,
        scatter: copy.scatterType,
        heatmap: copy.heatmapType,
        candlestick: copy.candlestickType,
        table: copy.queryResult,
    }[kind];
}

export function formatCount(value: number, locale: Locale) {
    return new Intl.NumberFormat(locale).format(value);
}

export function categoryAxisLayout(labels: readonly string[], minimumWidth = 652) {
    const slotWidths = labels.map(label => Math.max(72, Array.from(label).length * 6 + 16));
    const contentWidth = slotWidths.reduce((total, width) => total + width, 0);
    const extraSpace = labels.length ? Math.max(0, minimumWidth - contentWidth) / labels.length : 0;
    const positions: number[] = [];
    let offset = 0;
    let minimumSlotWidth = Number.POSITIVE_INFINITY;
    for (const width of slotWidths) {
        const expandedWidth = width + extraSpace;
        positions.push(offset + expandedWidth / 2);
        offset += expandedWidth;
        minimumSlotWidth = Math.min(minimumSlotWidth, expandedWidth);
    }
    return {
        width: Math.max(minimumWidth, contentWidth),
        positions,
        minimumSlotWidth: Number.isFinite(minimumSlotWidth) ? minimumSlotWidth : 72,
    };
}

export function splitChartSegments(points: ChartPoint[]) {
    const segments: ChartPoint[][] = [];
    let current: ChartPoint[] = [];
    for (const point of points) {
        if (point.value === null) {
            if (current.length) segments.push(current);
            current = [];
        } else current.push(point);
    }
    if (current.length) segments.push(current);
    return segments;
}
