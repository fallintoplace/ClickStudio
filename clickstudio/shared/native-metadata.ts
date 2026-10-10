/** Small, lossless boundary helpers for ClickHouse system-table metadata. */
export type MetadataRow = Readonly<Record<string, unknown>>;
export type MetadataReader = (
    sql: string,
    parameters: Record<string, string>,
) => Promise<MetadataRow[]>;

export function metadataText(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

export function metadataNumber(value: unknown): number | undefined {
    if (typeof value !== 'number' && !(typeof value === 'string' && value.trim())) return undefined;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : undefined;
}

export function metadataInteger(value: unknown): string | undefined {
    if (typeof value === 'number')
        return Number.isSafeInteger(value) && value >= 0 ? String(value) : undefined;
    return typeof value === 'string' && /^\d{1,80}$/.test(value)
        ? BigInt(value).toString()
        : undefined;
}

export function metadataFlag(value: unknown): boolean | undefined {
    if (value === true || value === 1 || value === '1') return true;
    if (value === false || value === 0 || value === '0') return false;
    return undefined;
}

export function metadataStrings(value: unknown, limit = 64): string[] {
    return Array.isArray(value)
        ? value.slice(0, limit).filter((item): item is string => typeof item === 'string')
        : [];
}

/** Queries explicitly serialize server timestamps in UTC before this boundary. */
export function metadataTime(value: unknown): string | undefined {
    if (typeof value !== 'string' || !value || value.startsWith('1970-01-01 00:00:00'))
        return undefined;
    const iso = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(?:\.\d+)?$/.test(value)
        ? `${value.replace(' ', 'T')}Z`
        : value;
    return Number.isFinite(Date.parse(iso)) ? new Date(iso).toISOString() : undefined;
}

export function metadataProgress(value: unknown): number | undefined {
    const number = metadataNumber(value);
    return number === undefined ? undefined : Math.min(1, number);
}

export interface MetadataSnapshot {
    database: string;
    observedAt: string;
    source: 'clickhouse' | 'fixture';
    /** This is a response from the connected server, not a cluster-wide aggregation. */
    notes: string[];
    truncated: boolean;
}
