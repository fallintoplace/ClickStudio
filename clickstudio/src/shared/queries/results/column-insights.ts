import type { Column, Json, Row } from '../../common/values.js';
import { isLargeCellReference } from './large-cells.js';
import { baseType, chartNumber, numericType } from './results.js';

export interface ColumnStats {
    total: number;
    nulls: number;
    detached: number;
    distinct: number;
    distinctCapped: boolean;
    numericCount: number;
    nonRepresentable: number;
    minimum?: number;
    maximum?: number;
    average?: number;
    histogram: number[];
    common: Array<{ label: string; count: number }>;
}
// The retained SQL result hard limit is 20,000 rows, so normal insights can be exact.
const MAX_DISTINCT = 20_000;
const HISTOGRAM_BUCKETS = 10;

function valueLabel(value: Json): string {
    if (typeof value === 'string') return value.slice(0, 120);
    if (Array.isArray(value)) return '[Array]';
    if (typeof value === 'object') return '[Object]';
    return String(value);
}

function bucketFor(value: number, minimum: number, maximum: number): number {
    if (minimum === maximum) return 0;
    return Math.min(
        HISTOGRAM_BUCKETS - 1,
        Math.floor(((value - minimum) / (maximum - minimum)) * HISTOGRAM_BUCKETS),
    );
}

/** Describes only the rows supplied by the caller, never an entire source table. */
export function columnStats(
    rows: readonly Row[],
    column: Column,
    index: number,
    token?: string,
): ColumnStats {
    const counts = new Map<string, { label: string; count: number }>();
    let nulls = 0;
    let detached = 0;
    let numericCount = 0;
    let nonRepresentable = 0;
    let minimum = Infinity;
    let maximum = -Infinity;
    let average = 0;
    let distinctCapped = false;
    const numbers: number[] = [];
    const numeric = numericType(column.type);
    for (const row of rows) {
        const value = row[index];
        if (value === undefined || value === null) {
            nulls++;
            continue;
        }
        if (isLargeCellReference(value, token)) {
            detached++;
            continue;
        }
        const key =
            typeof value === 'object'
                ? 'object:' + JSON.stringify(value)
                : typeof value + ':' + String(value);
        const existing = counts.get(key);
        if (existing) existing.count++;
        else if (counts.size < MAX_DISTINCT)
            counts.set(key, { label: valueLabel(value), count: 1 });
        else distinctCapped = true;
        if (!numeric) continue;
        const n = chartNumber(value);
        if (n === null) {
            nonRepresentable++;
            continue;
        }
        numbers.push(n);
        numericCount++;
        minimum = Math.min(minimum, n);
        maximum = Math.max(maximum, n);
        average += (n - average) / numericCount;
    }
    const histogram = Array<number>(HISTOGRAM_BUCKETS).fill(0);
    for (const n of numbers) {
        const bucket = bucketFor(n, minimum, maximum);
        histogram[bucket] = (histogram[bucket] ?? 0) + 1;
    }
    const common = distinctCapped ? [] : [...counts.values()];
    return {
        total: rows.length,
        nulls,
        detached,
        distinct: counts.size,
        distinctCapped,
        numericCount,
        nonRepresentable,
        ...(numericCount ? { minimum, maximum, average } : {}),
        histogram,
        common: common.sort((a, b) => b.count - a.count).slice(0, 5),
    };
}

function selectedCellText(value: Json | undefined, token?: string): string {
    if (value === null || value === undefined) return '';
    if (isLargeCellReference(value, token)) return value.preview;
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}
function quotedTsv(value: string): string {
    if (!/["\t\r\n]/.test(value)) return value;
    return '"' + value.replaceAll('"', '""') + '"';
}
/** Copy a bounded selection, preserving row boundaries and lossless scalar strings. */
export function selectedRowsTsv(
    rows: readonly Row[],
    columnIndexes: readonly number[],
    largeCellToken?: string,
): string {
    return rows
        .map(row =>
            columnIndexes
                .map(index => quotedTsv(selectedCellText(row[index], largeCellToken)))
                .join('\t'),
        )
        .join('\n');
}

function selectionNumericValue(value: Json | undefined, type: string): bigint | number | null {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    if (!numericType(type)) return null;
    if (/^U?Int\d+$/.test(baseType(type)) && /^[+-]?\d+$/.test(String(value))) {
        if (typeof value === 'number' && !Number.isSafeInteger(value)) return null;
        return BigInt(value);
    }
    return chartNumber(value);
}

function formatExactAverage(sum: bigint, count: number): string {
    const denominator = BigInt(count);
    const negative = sum < 0n;
    const absolute = negative ? -sum : sum;
    const rounded = (absolute * 10_000n + denominator / 2n) / denominator;
    const fraction = (rounded % 10_000n).toString().padStart(4, '0').replace(/0+$/, '');
    const whole = (rounded / 10_000n).toLocaleString();
    return (negative ? '-' : '') + whole + (fraction ? '.' + fraction : '');
}

/** Exact integer sums; floats and decimals are explicitly approximate. */
export function selectedNumericSummary(
    rows: readonly Row[],
    columnIndexes: readonly number[],
    columns: readonly Column[],
): { count: number; sum: string; average: string } {
    let count = 0;
    let exact = 0n;
    let floating = 0;
    let approximate = false;
    for (const row of rows) {
        for (const index of columnIndexes) {
            const value = selectionNumericValue(row[index], columns[index]?.type ?? '');
            if (value === null) continue;
            count++;
            if (typeof value === 'bigint') exact += value;
            else {
                floating += value;
                approximate = true;
            }
        }
    }
    if (!count) return { count, sum: '', average: '' };
    if (approximate) {
        const total = Number(exact) + floating;
        const format = (value: number) =>
            '≈' + value.toLocaleString(undefined, { maximumFractionDigits: 4 });
        return { count, sum: format(total), average: format(total / count) };
    }
    return {
        count,
        sum: exact.toLocaleString(),
        average: formatExactAverage(exact, count),
    };
}
