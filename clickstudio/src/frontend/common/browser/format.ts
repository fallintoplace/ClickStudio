export function formatBytes(value?: string | number): string {
    if (value === undefined) return '—';
    const bytes = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(bytes)) return String(value);
    if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
    if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
    return `${bytes.toLocaleString()} B`;
}

export function formatCount(value: string | number): string {
    const number = Number(value);
    return Number.isFinite(number)
        ? new Intl.NumberFormat(undefined, {
              notation: 'compact',
              maximumFractionDigits: 1,
          }).format(number)
        : String(value);
}
