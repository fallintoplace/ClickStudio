import type { Column, Row } from '../../common/values.js';
import { isLargeCellReference } from './large-cells.js';
import { chartNumber, numericType } from './results.js';

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

const MAX_DISTINCT = 2000;
const HISTOGRAM_BUCKETS = 10;

/** Describes only the rows supplied by the caller, never an entire source table. */
export function columnStats(rows: readonly Row[], column: Column, index: number, token?: string): ColumnStats {
    const counts = new Map<string, number>();
    let nulls = 0;
    let detached = 0;
    let numericCount = 0;
    let nonRepresentable = 0;
    let minimum = Infinity;
    let maximum = -Infinity;
    let average = 0;
    let distinctCapped = false;
    const numbers: number[] = [];
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
        const label = typeof value === 'string'
            ? value.slice(0, 120)
            : typeof value === 'object'
                ? (Array.isArray(value) ? '[Array]' : '[Object]')
                : String(value);
        if (counts.has(label)) counts.set(label, counts.get(label)! + 1);
        else if (counts.size < MAX_DISTINCT) counts.set(label, 1);
        else distinctCapped = true;

        if (!numericType(column.type)) continue;
        const n = chartNumber(value);
        if (n === null || !Number.isFinite(n)) {
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
    if (numericCount) {
        for (const n of numbers) {
            const index = maximum === minimum
                ? 0
                : Math.min(HISTOGRAM_BUCKETS - 1, Math.floor((n - minimum) / (maximum - minimum) * HISTOGRAM_BUCKETS));
            histogram[index]!++;
        }
    }
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
        common: [...counts].sort((a, b) => b[1] - a[1]).slice(0, 5)
            .map(([label, count]) => ({ label, count })),
    };
}

/** Quote tabs and line breaks to keep copied grid selections rectangular. */
export function selectedRowsTsv(
    rows: readonly Row[],
    columnIndexes: readonly number[],
    largeCellToken?: string,
): string {
    return rows.map(row => columnIndexes.map(index => {
        const value = row[index];
        const text = value === null || value === undefined
            ? ''
            : isLargeCellReference(value, largeCellToken)
                ? value.preview
                : typeof value === 'object' ? JSON.stringify(value) : String(value);
        return /["\t\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
    }).join('\t')).join('\n');
}