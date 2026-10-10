import type { Column, Json, Row } from './types.js';
import { baseType, chartNumber, displayValue, numericType } from './results.js';

export const MAX_GEO_RENDER_FEATURES = 2000;
export const NATIVE_GEO_TYPES = ['Point', 'Ring', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon', 'Geometry'] as const;
export type NativeGeoType = typeof NATIVE_GEO_TYPES[number];
export type GeoPosition = [number, number];
export type GeoGeometry =
    | { type: 'Point'; coordinates: GeoPosition }
    | { type: 'LineString'; coordinates: GeoPosition[] }
    | { type: 'MultiLineString'; coordinates: GeoPosition[][] }
    | { type: 'Polygon'; coordinates: GeoPosition[][] }
    | { type: 'MultiPolygon'; coordinates: GeoPosition[][][] };
export type GeoSource =
    | { mode: 'geometry'; column: number }
    | { mode: 'coordinates'; longitude: number; latitude: number };
export interface GeoRecommendation {
    source: GeoSource;
    label?: number;
    measure?: number;
    swapCoordinates: boolean;
    reason: string;
}
export interface GeoFeature {
    geometry: GeoGeometry;
    rowIndex: number;
    label: string;
    measure: number | null;
    row: Row;
}
export interface PreparedGeoFeatures {
    features: GeoFeature[];
    totalFeatures: number;
    invalidRows: number;
    sampled: boolean;
}

const GEO_TYPES = new Set<NativeGeoType>(NATIVE_GEO_TYPES);
const MAX_GEO_LITERAL_LENGTH = 1_000_000;
const MAX_GEO_LITERAL_VALUES = 200_000;
const MAX_GEO_LITERAL_DEPTH = 8;
const geoNumberPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;

function parseGeoLiteral(input: string): Json | undefined {
    if (!input.length || input.length > MAX_GEO_LITERAL_LENGTH) return undefined;
    let index = 0, values = 0;
    const whitespace = () => { while (index < input.length && /\s/.test(input[index]!)) index++; };
    const parseNumber = (): number | undefined => {
        const match = input.slice(index).match(geoNumberPattern);
        if (!match) return undefined;
        const number = Number(match[0]);
        if (!Number.isFinite(number)) return undefined;
        index += match[0].length;
        return ++values <= MAX_GEO_LITERAL_VALUES ? number : undefined;
    };
    const parseValue = (depth: number): Json | undefined => {
        if (depth > MAX_GEO_LITERAL_DEPTH) return undefined;
        whitespace();
        const open = input[index];
        if (open !== '(' && open !== '[') return parseNumber();
        const close = open === '(' ? ')' : ']';
        index++;
        whitespace();
        const items: Json[] = [];
        if (input[index] === close) { index++; return items; }
        while (index < input.length) {
            const item = parseValue(depth + 1);
            if (item === undefined) return undefined;
            items.push(item);
            whitespace();
            if (input[index] === close) { index++; return items; }
            if (input[index] !== ',') return undefined;
            index++;
        }
        return undefined;
    };
    const parsed = parseValue(0);
    whitespace();
    return parsed !== undefined && index === input.length ? parsed : undefined;
}
const coordinateToken = (name: string, role: 'longitude' | 'latitude') => {
    const pattern = role === 'longitude' ? /(^|_)(longitude|lon|lng)($|_)/i : /(^|_)(latitude|lat)($|_)/i;
    const match = name.match(pattern);
    if (!match) return undefined;
    return name.toLowerCase().replace(pattern, '$1$3').replace(/^_+|_+$/g, '').replace(/_+/g, '_');
};
const namedMeasure = /(^|_)(count|trips?|value|measure|total|revenue|amount|score|weight|density|intensity|requests?|events?|users?)($|_)/i;
const identifierLike = /(^|_)(id|key|index|cell|h3)($|_)/i;
const namedLabel = /(^|_)(name|label|city|country|region|place|route|title)($|_)/i;

export function nativeGeoType(type: string): NativeGeoType | undefined {
    const typeName = baseType(type) as NativeGeoType;
    return GEO_TYPES.has(typeName) ? typeName : undefined;
}

export function nativeGeoColumns(columns: Column[]): number[] {
    return columns.flatMap((column, index) => nativeGeoType(column.type) ? [index] : []);
}

function coordinatePair(columns: Column[]): { longitude: number; latitude: number } | undefined {
    const longitude = columns.flatMap((column, index) => numericType(column.type) && coordinateToken(column.name, 'longitude') !== undefined
        ? [{ index, prefix: coordinateToken(column.name, 'longitude')! }] : []);
    const latitude = columns.flatMap((column, index) => numericType(column.type) && coordinateToken(column.name, 'latitude') !== undefined
        ? [{ index, prefix: coordinateToken(column.name, 'latitude')! }] : []);
    for (const lon of longitude) {
        const matching = latitude.find(lat => lat.prefix === lon.prefix);
        if (matching) return { longitude: lon.index, latitude: matching.index };
    }
    return longitude.length && latitude.length ? { longitude: longitude[0]!.index, latitude: latitude[0]!.index } : undefined;
}

function inferredLabel(columns: Column[], excluded: Set<number>): number | undefined {
    const eligible = columns.flatMap((column, index) => !excluded.has(index) && !nativeGeoType(column.type) && !numericType(column.type) ? [index] : []);
    return eligible.find(index => namedLabel.test(columns[index]!.name)) ?? eligible[0];
}

function inferredMeasure(columns: Column[], excluded: Set<number>): number | undefined {
    const eligible = columns.flatMap((column, index) => !excluded.has(index) && numericType(column.type)
        && coordinateToken(column.name, 'longitude') === undefined && coordinateToken(column.name, 'latitude') === undefined ? [index] : []);
    return eligible.find(index => namedMeasure.test(columns[index]!.name))
        ?? eligible.find(index => !identifierLike.test(columns[index]!.name));
}

export function recommendGeo(columns: Column[]): GeoRecommendation | undefined {
    const geometry = nativeGeoColumns(columns)[0];
    if (geometry !== undefined) {
        const excluded = new Set([geometry]);
        return {
            source: { mode: 'geometry', column: geometry },
            label: inferredLabel(columns, excluded),
            measure: inferredMeasure(columns, excluded),
            swapCoordinates: /h3/i.test(columns[geometry]!.name),
            reason: `Native ClickHouse ${nativeGeoType(columns[geometry]!.type)} column`,
        };
    }
    const coordinates = coordinatePair(columns);
    if (!coordinates) return undefined;
    const excluded = new Set([coordinates.longitude, coordinates.latitude]);
    return {
        source: { mode: 'coordinates', ...coordinates },
        label: inferredLabel(columns, excluded),
        measure: inferredMeasure(columns, excluded),
        swapCoordinates: false,
        reason: 'Longitude and latitude columns',
    };
}

function position(value: Json | undefined, swapCoordinates: boolean): GeoPosition | undefined {
    if (!Array.isArray(value) || value.length !== 2) return undefined;
    const first = chartNumber(value[0]), second = chartNumber(value[1]);
    if (first === null || second === null) return undefined;
    const longitude = swapCoordinates ? second : first;
    const latitude = swapCoordinates ? first : second;
    if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) return undefined;
    return [longitude, latitude];
}

function line(value: Json | undefined, swapCoordinates: boolean): GeoPosition[] | undefined {
    if (!Array.isArray(value) || value.length < 2) return undefined;
    const coordinates: GeoPosition[] = [];
    for (const item of value) {
        const coordinate = position(item, swapCoordinates);
        if (!coordinate) return undefined;
        coordinates.push(coordinate);
    }
    return coordinates;
}

function lines(value: Json | undefined, swapCoordinates: boolean): GeoPosition[][] | undefined {
    if (!Array.isArray(value) || !value.length) return undefined;
    const result: GeoPosition[][] = [];
    for (const item of value) {
        const coordinates = line(item, swapCoordinates);
        if (!coordinates) return undefined;
        result.push(coordinates);
    }
    return result;
}

function polygons(value: Json | undefined, swapCoordinates: boolean): GeoPosition[][][] | undefined {
    if (!Array.isArray(value) || !value.length) return undefined;
    const result: GeoPosition[][][] = [];
    for (const item of value) {
        const polygon = lines(item, swapCoordinates);
        if (!polygon) return undefined;
        result.push(polygon);
    }
    return result;
}

function closed(coordinates: GeoPosition[]): boolean {
    const first = coordinates[0], last = coordinates.at(-1);
    return Boolean(first && last && first[0] === last[0] && first[1] === last[1]);
}

function inferredGeometry(value: Json | undefined, swapCoordinates: boolean): GeoGeometry | undefined {
    const point = position(value, swapCoordinates);
    if (point) return { type: 'Point', coordinates: point };
    const oneLine = line(value, swapCoordinates);
    if (oneLine) return closed(oneLine)
        ? { type: 'Polygon', coordinates: [oneLine] }
        : { type: 'LineString', coordinates: oneLine };
    const manyLines = lines(value, swapCoordinates);
    if (manyLines) return manyLines.every(closed)
        ? { type: 'Polygon', coordinates: manyLines }
        : { type: 'MultiLineString', coordinates: manyLines };
    const manyPolygons = polygons(value, swapCoordinates);
    return manyPolygons ? { type: 'MultiPolygon', coordinates: manyPolygons } : undefined;
}

function normalizeStructuredGeoGeometry(value: Json | undefined, type: string, swapCoordinates = false): GeoGeometry | undefined {
    const native = nativeGeoType(type);
    if (!native) return undefined;
    if (native === 'Geometry') return inferredGeometry(value, swapCoordinates);
    if (native === 'Point') {
        const coordinates = position(value, swapCoordinates);
        return coordinates ? { type: 'Point', coordinates } : undefined;
    }
    if (native === 'Ring') {
        const coordinates = line(value, swapCoordinates);
        return coordinates ? { type: 'Polygon', coordinates: [coordinates] } : undefined;
    }
    if (native === 'LineString') {
        const coordinates = line(value, swapCoordinates);
        return coordinates ? { type: 'LineString', coordinates } : undefined;
    }
    if (native === 'MultiLineString') {
        const coordinates = lines(value, swapCoordinates);
        return coordinates ? { type: 'MultiLineString', coordinates } : undefined;
    }
    if (native === 'Polygon') {
        const coordinates = lines(value, swapCoordinates);
        return coordinates ? { type: 'Polygon', coordinates } : undefined;
    }
    const coordinates = polygons(value, swapCoordinates);
    return coordinates ? { type: 'MultiPolygon', coordinates } : undefined;
}

export function parseNativeGeoText(value: string, type: string): Json | undefined {
    if (!nativeGeoType(type)) return undefined;
    return parseGeoLiteral(value);
}

export function normalizeGeoGeometry(value: Json | undefined, type: string, swapCoordinates = false): GeoGeometry | undefined {
    const structured = typeof value === 'string' ? parseNativeGeoText(value, type) : value;
    return normalizeStructuredGeoGeometry(structured, type, swapCoordinates);
}

function coordinateGeometry(row: Row, source: Extract<GeoSource, { mode: 'coordinates' }>): GeoGeometry | undefined {
    const longitude = chartNumber(row[source.longitude]), latitude = chartNumber(row[source.latitude]);
    if (longitude === null || latitude === null || longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) return undefined;
    return { type: 'Point', coordinates: [longitude, latitude] };
}

function evenlySample<T>(values: T[], maximum: number): T[] {
    if (values.length <= maximum) return values;
    if (maximum <= 0) return [];
    if (maximum === 1) return [values[0]!];
    return Array.from({ length: maximum }, (_unused, index) => values[Math.round(index * (values.length - 1) / (maximum - 1))]!);
}

export function prepareGeoFeatures(rows: Row[], columns: Column[], config: GeoRecommendation, maximum = MAX_GEO_RENDER_FEATURES): PreparedGeoFeatures {
    const valid: GeoFeature[] = [];
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        const row = rows[rowIndex]!;
        const geometry = config.source.mode === 'geometry'
            ? normalizeGeoGeometry(row[config.source.column], columns[config.source.column]?.type ?? '', config.swapCoordinates)
            : coordinateGeometry(row, config.source);
        if (!geometry) continue;
        valid.push({
            geometry,
            rowIndex,
            label: config.label === undefined ? `Row ${rowIndex + 1}` : displayValue(row[config.label]),
            measure: config.measure === undefined ? null : chartNumber(row[config.measure]),
            row,
        });
    }
    return {
        features: evenlySample(valid, maximum),
        totalFeatures: valid.length,
        invalidRows: rows.length - valid.length,
        sampled: valid.length > maximum,
    };
}
