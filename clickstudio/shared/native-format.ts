/** Exact UInt64 text at rest, deliberately rounded units only for presentation. */
export function nativeCount(value: string | undefined): string {
    if (value === undefined) return 'Unavailable';
    try {
        return BigInt(value).toLocaleString('en-US');
    } catch {
        return 'Unavailable';
    }
}
export function nativeBytes(value: string | undefined): string {
    if (value === undefined) return 'Unavailable';
    try {
        const bytes = BigInt(value),
            units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB'];
        let divisor = 1n,
            unit = 0;
        while (bytes >= divisor * 1024n && unit < units.length - 1) {
            divisor *= 1024n;
            unit++;
        }
        return unit
            ? `${bytes / divisor}.${((bytes % divisor) * 10n) / divisor} ${units[unit]}`
            : `${bytes} B`;
    } catch {
        return 'Unavailable';
    }
}
export const nativeTime = (value: string | undefined) =>
    value ? value.replace('T', ' ').replace('.000Z', ' UTC') : 'Unavailable';
