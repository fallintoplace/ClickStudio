import type { ChartKind } from '../../../../../shared/queries/results/chart-types.js';
import type { Result } from '../../../../../shared/queries/results/types.js';
import type { Row } from '../../../../../shared/common/values.js';
import type { Locale } from '../../../../common/translations/i18n.js';
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
