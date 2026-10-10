import type { Column, Result } from './types.js';

/** Column identity is its position, never its possibly duplicated display name. */
export function visibleColumns(count: number, hidden: readonly number[]): number[] {
    const excluded = new Set(hidden);
    return Array.from({ length: count }, (_, index) => index).filter(index => !excluded.has(index));
}

export function toggleColumn(count: number, hidden: readonly number[], index: number): number[] {
    const next = hidden.filter(value => Number.isSafeInteger(value) && value >= 0 && value < count);
    if (!Number.isSafeInteger(index) || index < 0 || index >= count) return next;
    if (next.includes(index)) return next.filter(value => value !== index);
    if (visibleColumns(count, next).length <= 1) return next;
    return [...next, index];
}

export function matchingColumns(columns: readonly Column[], search: string): number[] {
    const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return columns.flatMap((column, index) => {
        const text = `${index + 1} ${column.name} ${column.type}`.toLowerCase();
        return terms.every(term => text.includes(term)) ? [index] : [];
    });
}

/** Projection for an explicit filtered export. Full result evidence is never modified. */
export function projectResultColumns(result: Pick<Result, 'columns' | 'rows'>, indexes: readonly number[]): Pick<Result, 'columns' | 'rows'> {
    if (!indexes.length || new Set(indexes).size !== indexes.length || indexes.some(index => !Number.isSafeInteger(index) || index < 0 || index >= result.columns.length))
        throw new Error('Choose at least one valid, distinct result column.');
    return { columns: indexes.map(index => result.columns[index]!), rows: result.rows.map(row => indexes.map(index => row[index]!)) };
}
