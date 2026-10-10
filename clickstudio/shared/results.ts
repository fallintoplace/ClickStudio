import type { CandlestickConfig, ChartConfig, Column, Json, Result, Row } from './types.js';
export const MAX_CHART_SERIES = 20;
export const MAX_CHART_POINTS = 5000;
export const MAX_CHART_RENDER_POINTS = 240;
export function sampleChartRows(rows: Row[], maxPoints = MAX_CHART_POINTS): Row[] {
    if (maxPoints <= 0)
        return [];
    if (rows.length <= maxPoints)
        return rows;
    if (maxPoints === 1)
        return [rows[0]!];
    const sampled = new Array<Row>(maxPoints);
    for (let index = 0; index < maxPoints; index++) {
        const sourceIndex = Math.round(index * (rows.length - 1) / (maxPoints - 1));
        sampled[index] = rows[sourceIndex]!;
    }
    return sampled;
}
export function displayValue(value: Json | undefined): string {
    if (value === null || value === undefined)
        return 'NULL';
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
}
export function baseType(type: string): string {
    while (/^(Nullable|LowCardinality)\(/.test(type))
        type = type.slice(type.indexOf('(') + 1, -1);
    return type;
}
export function numericType(type: string) { return /^(U?Int\d+|Float\d+|Decimal)/.test(baseType(type)); }
export function temporalType(type: string) { return /^Date/.test(baseType(type)); }
export function chartNumber(value: Json | undefined): number | null {
    if (value === null || value === undefined || typeof value === 'object' || typeof value === 'boolean' || value === '')
        return null;
    const n = Number(value);
    if (!Number.isFinite(n) || (Number.isInteger(n) && !Number.isSafeInteger(n)))
        return null;
    return n;
}
export const MAX_HEATMAP_CELLS = 1200;
export type HeatmapPreparation = {
    xLabels: string[];
    yLabels: string[];
    cells: Map<string, number>;
    present: Set<string>;
    maximum: number;
    tooLarge: boolean;
    combinedRows: number;
};
export function heatmapCellKey(xLabel: string, yLabel: string): string {
    return JSON.stringify([yLabel, xLabel]);
}
export function prepareHeatmap(rows: Row[], xIndex: number, yIndex: number, measureIndex: number, maxCells = MAX_HEATMAP_CELLS): HeatmapPreparation {
    const xLabels = new Set<string>(), yLabels = new Set<string>(), cells = new Map<string, number>(), present = new Set<string>();
    let maximum = 0, combinedRows = 0;
    for (const row of rows) {
        const xLabel = displayValue(row[xIndex]), yLabel = displayValue(row[yIndex]);
        xLabels.add(xLabel);
        yLabels.add(yLabel);
        if (xLabels.size * yLabels.size > maxCells)
            return { xLabels: [...xLabels], yLabels: [...yLabels], cells, present, maximum, tooLarge: true, combinedRows };
        const key = heatmapCellKey(xLabel, yLabel);
        if (present.has(key)) combinedRows++;
        present.add(key);
        const value = chartNumber(row[measureIndex]);
        if (value === null) continue;
        const combined = (cells.get(key) ?? 0) + value;
        cells.set(key, combined);
        maximum = Math.max(maximum, combined);
    }
    return { xLabels: [...xLabels], yLabels: [...yLabels], cells, present, maximum, tooLarge: false, combinedRows };
}
export type TimeBucketUnit = 'minute' | 'hour' | 'day' | 'week' | 'month';
export interface RowCountPoint {
    timestamp: number;
    label: string;
    count: number;
}
export interface RowCountSeries {
    key: string;
    label: string;
    points: RowCountPoint[];
}

export function chartTimestamp(value: Json | undefined): number | null {
    if (typeof value === 'number') {
        const timestamp = Math.abs(value) >= 1e12 ? value : value * 1000;
        return Number.isFinite(timestamp) ? timestamp : null;
    }
    if (typeof value !== 'string') return null;
    const raw = value.trim();
    const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
    const normalized = /^\d{4}-\d{2}-\d{2}$/.test(raw)
        ? `${raw}T00:00:00Z`
        : `${raw.includes('T') ? raw : raw.replace(' ', 'T')}${zoned ? '' : 'Z'}`;
    const timestamp = Date.parse(normalized);
    return Number.isFinite(timestamp) ? timestamp : null;
}

export function recommendCandlestickConfig(columns: Column[]): { x: number; candlestick: CandlestickConfig } | undefined {
    const numeric = (index: number) => index >= 0 && numericType(columns[index]?.type ?? '');
    const namedIndex = (names: RegExp) => columns.findIndex(column => names.test(column.name.toLowerCase()));
    const candle = {
        open: namedIndex(/^open(?:_price)?$/),
        high: namedIndex(/^high(?:_price)?$/),
        low: namedIndex(/^low(?:_price)?$/),
        close: namedIndex(/^close(?:_price)?$/),
    };
    const x = columns.findIndex(column => temporalType(column.type) || /^(?:time|timestamp|datetime|date)$/i.test(column.name));
    if (x < 0 || !Object.values(candle).every(numeric)) return undefined;
    const bid = namedIndex(/^(?:best_)?bid(?:_price)?$/);
    const ask = namedIndex(/^(?:best_)?ask(?:_price)?$/);
    const spread = namedIndex(/^spread(?:_bps)?$/);
    const quoteActivity = namedIndex(/^(?:quote_updates|quote_activity|updates)$/);
    return {
        x,
        candlestick: {
            ...candle,
            ...(numeric(bid) ? { bid } : {}),
            ...(numeric(ask) ? { ask } : {}),
            ...(numeric(spread) ? { spread } : {}),
            ...(numeric(quoteActivity) ? { quoteActivity } : {}),
        },
    };
}

function selectTimeBucket(spanMs: number): TimeBucketUnit {
    const hour = 60 * 60 * 1000;
    const day = 24 * hour;
    if (spanMs <= 2 * hour) return 'minute';
    if (spanMs <= 3 * day) return 'hour';
    if (spanMs <= 180 * day) return 'day';
    if (spanMs <= 3 * 365 * day) return 'week';
    return 'month';
}

function bucketStart(timestamp: number, unit: TimeBucketUnit): number {
    const date = new Date(timestamp);
    if (unit === 'minute') date.setUTCSeconds(0, 0);
    else if (unit === 'hour') date.setUTCMinutes(0, 0, 0);
    else if (unit === 'day') date.setUTCHours(0, 0, 0, 0);
    else if (unit === 'week') {
        date.setUTCHours(0, 0, 0, 0);
        date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    } else {
        date.setUTCDate(1);
        date.setUTCHours(0, 0, 0, 0);
    }
    return date.getTime();
}

function bucketLabel(timestamp: number, unit: TimeBucketUnit): string {
    const iso = new Date(timestamp).toISOString();
    if (unit === 'minute') return iso.slice(0, 16).replace('T', ' ');
    if (unit === 'hour') return `${iso.slice(0, 13).replace('T', ' ')}:00`;
    if (unit === 'month') return iso.slice(0, 7);
    return iso.slice(0, 10);
}

function valueKey(value: Json | undefined): string {
    return value === null || value === undefined ? 'null' : JSON.stringify(value);
}

export function countRowsByCategory(rows: Row[], columnIndex: number): Array<{ key: string; label: string; count: number }> {
    const counts = new Map<string, { label: string; count: number }>();
    for (const row of rows) {
        const value = row[columnIndex];
        const key = valueKey(value);
        const group = counts.get(key) ?? { label: displayValue(value), count: 0 };
        group.count++;
        counts.set(key, group);
    }
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    const sorted = [...counts].map(([key, group]) => ({ key, ...group }))
        .sort((left, right) => right.count - left.count || collator.compare(left.label, right.label));
    return sorted;
}

export function countRowsOverTime(rows: Row[], timeIndex: number, groupByIndex?: number, maxSeries = 5): { unit: TimeBucketUnit; excludedRows: number; series: RowCountSeries[] } {
    const validRows = rows.flatMap(row => {
        const timestamp = chartTimestamp(row[timeIndex]);
        return timestamp === null ? [] : [{ row, timestamp }];
    });
    if (!validRows.length) return { unit: 'day', excludedRows: rows.length, series: [] };
    const timestamps = validRows.map(({ timestamp }) => timestamp);
    const unit = selectTimeBucket(Math.max(...timestamps) - Math.min(...timestamps));
    const categoryCounts = new Map<string, { label: string; count: number }>();
    if (groupByIndex !== undefined) {
        for (const { row } of validRows) {
            const value = row[groupByIndex];
            const key = valueKey(value);
            const group = categoryCounts.get(key) ?? { label: displayValue(value), count: 0 };
            group.count++;
            categoryCounts.set(key, group);
        }
    }
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    const rankedCategories = [...categoryCounts].map(([key, group]) => ({ key, ...group }))
        .sort((left, right) => right.count - left.count || collator.compare(left.label, right.label));
    const visibleCategories = rankedCategories.slice(0, maxSeries);
    const visibleKeys = new Set(visibleCategories.map(group => group.key));
    const includeOther = rankedCategories.length > maxSeries;
    const seriesByKey = new Map<string, { label: string; buckets: Map<number, number> }>();
    if (groupByIndex === undefined) seriesByKey.set('__rows__', { label: 'Rows', buckets: new Map() });
    else {
        for (const group of visibleCategories) seriesByKey.set(group.key, { label: group.label, buckets: new Map() });
        if (includeOther) seriesByKey.set('__other__', { label: `Other (${rankedCategories.length - maxSeries})`, buckets: new Map() });
    }
    for (const { row, timestamp } of validRows) {
        const bucket = bucketStart(timestamp, unit);
        const categoryKey = groupByIndex === undefined ? '__rows__' : valueKey(row[groupByIndex]);
        const key = groupByIndex === undefined || visibleKeys.has(categoryKey) ? categoryKey : '__other__';
        const series = seriesByKey.get(key);
        if (series) series.buckets.set(bucket, (series.buckets.get(bucket) ?? 0) + 1);
    }
    const series = [...seriesByKey].map(([key, group]) => ({
        key,
        label: group.label,
        points: [...group.buckets].sort(([left], [right]) => left - right)
            .map(([timestamp, count]) => ({ timestamp, label: bucketLabel(timestamp, unit), count })),
    }));
    return { unit, excludedRows: rows.length - validRows.length, series };
}

export function recommendChart(columns: Column[], rows: Row[]): {
    config: ChartConfig;
    reason: string;
} {
    const numeric = columns.flatMap((c, i) => numericType(c.type) ? [i] : []);
    const candlestick = recommendCandlestickConfig(columns);
    if (rows.length && candlestick) {
        return { config: { kind: 'candlestick', x: candlestick.x, ys: [], title: 'Candlestick chart', candlestick: candlestick.candlestick }, reason: 'The result has a time column and open, high, low, and close measures.' };
    }
    if (!numeric.length && rows.length) {
        const temporal = columns.findIndex(column => temporalType(column.type));
        if (temporal >= 0) {
            const groupBy = columns.findIndex((_column, index) => index !== temporal && !temporalType(columns[index]!.type));
            const title = groupBy < 0 ? 'Rows over time' : `Rows over time by ${columns[groupBy]!.name}`;
            return { config: { kind: 'line', x: temporal, ...(groupBy < 0 ? {} : { groupBy }), ys: [], title }, reason: 'Rows are counted in time buckets from the retained result; no aggregate query is sent.' };
        }
        if (columns.length)
            return { config: { kind: 'bar', x: 0, ys: [], title: `Rows by ${columns[0]!.name}` }, reason: 'Rows are counted by category from the retained result; no aggregate query is sent.' };
    }
    if (!numeric.length)
        return { config: { kind: 'table', x: 0, ys: [], title: 'Query result' }, reason: 'No numeric measure; preserve the typed table.' };
    if (rows.length === 1)
        return { config: { kind: 'number', x: 0, ys: [numeric[0]!], title: columns[numeric[0]!]!.name }, reason: 'One row with a numeric measure.' };
    const time = columns.findIndex(c => /^Date/.test(baseType(c.type)));
    const category = columns.findIndex((_, i) => !numeric.includes(i));
    const x = time >= 0 ? time : category >= 0 ? category : 0;
    const ys = numeric.filter(i => i !== x).slice(0, 4);
    if (!ys.length)
        ys.push(numeric[0]!);
    return { config: { kind: time >= 0 ? 'line' : 'bar', x, ys, title: 'Query result' },
        reason: time >= 0 ? 'A date/time dimension with numeric measures.' : 'A dimension with numeric measures; no hidden aggregation is performed.' };
}
export function filterRows(rows: Row[], term: string, searchableRows?: string[]): Row[] {
    const needle = term.toLocaleLowerCase();
    return needle ? rows.filter((r, index) => (searchableRows?.[index] ?? r.map(v => displayValue(v).toLocaleLowerCase()).join('\u0001')).includes(needle)) : rows;
}
export function csvCell(value: Json | undefined, type?: string): string {
    let cell = value === null || value === undefined ? '' : displayValue(value);
    // Formula-prefix escaping is for textual spreadsheet cells. Numeric ClickHouse
    // values such as -42 stay numeric in CSV; JSON remains the exact typed export.
    if (!type || !numericType(type)) {
        if (/^[\t\r\n ]*[=+\-@]/.test(cell))
            cell = "'" + cell;
    }
    return /[",\r\n]/.test(cell) ? '"' + cell.replace(/"/g, '""') + '"' : cell;
}
export function exportCsv(result: Pick<Result, 'columns' | 'rows'>): string {
    return [result.columns.map(c => csvCell(c.name)).join(','), ...result.rows.map(r => r.map((value, index) => csvCell(value, result.columns[index]?.type)).join(','))].join('\r\n');
}
