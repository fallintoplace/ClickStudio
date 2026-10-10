import type { ChartKind } from '../../../shared/chart-types.js';
import type { Result, Row } from '../../../shared/types.js';
import type { Locale } from '../../i18n.js';
import { chartText } from '../chart-helpers.js';

export type ChartSvgModel = {
    plotRight: number;
    chartAriaLabel: ReturnType<typeof chartText>;
    plotTop: number;
    plotMiddle: number;
    plotBottom: number;
    plotLeft: 0 | 80;
    chartYTicks: { value: number; position: number }[];
    compactNumber: Intl.NumberFormat;
    chartKind: Exclude<ChartKind, 'table'>;
    zeroY: number;
    scatterPoints: { x: number; y: number; label: string }[];
    scatterX: (value: number) => number;
    scatterY: (value: number) => number;
    result: Result;
    xIndex: number;
    locale: Locale;
    yIndex: number;
    plotSeries: {
        columnIndex: number;
        color: 'var(--accent)' | 'var(--green)' | 'var(--amber)' | 'var(--red)' | 'var(--violet)';
        points: { label: string; value: number | null; index: number }[];
    }[];
    x: (index: number) => number;
    y: (value: number) => number;
    barWidth: number;
    chartRows: Row[];
    chartXTicks: { label: string; position: number }[];
};
