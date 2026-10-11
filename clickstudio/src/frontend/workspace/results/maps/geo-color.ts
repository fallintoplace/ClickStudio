export function geoHueForValue(
    value: number | null | undefined,
    minimum: number,
    maximum: number,
): number {
    if (
        value === null ||
        value === undefined ||
        !Number.isFinite(value) ||
        !Number.isFinite(minimum) ||
        !Number.isFinite(maximum) ||
        maximum <= minimum
    )
        return 188;
    const position = Math.max(0, Math.min(1, (value - minimum) / (maximum - minimum)));
    return Math.round(278 - position * 242);
}
