import type { Schema, SchemaColumn, SchemaDictionary, SchemaProjection, SchemaSkipIndex, SchemaTable } from './types.js';

export type SchemaTableMetadata = Pick<SchemaTable,
    'orderBy' | 'primaryKey' | 'partitionKey' | 'samplingKey' | 'ttlConfigured' | 'materializedViewTarget'
    | 'rowEstimate' | 'sizeBytes' | 'uncompressedBytes' | 'parts' | 'activeParts' | 'skipIndexTypes'> & {
        database: string;
        name: string;
    };

export type SchemaTableProjection = SchemaProjection & { database: string; table: string };
export type SchemaTableSkipIndex = SchemaSkipIndex & { database: string; table: string };
export type PlaygroundMetadataKind = 'projection' | 'skip index' | 'dictionary';
export type OptionalSchemaMetadataWarning = { kind: PlaygroundMetadataKind; warning?: string; permissionDenied?: boolean };

export function formatPlaygroundMetadataWarning(unavailable: readonly PlaygroundMetadataKind[]): string | undefined {
    const unique = [...new Set(unavailable)];
    if (!unique.length)
        return undefined;
    const list = unique.length === 1 ? unique[0]
        : unique.length === 2 ? `${unique[0]} or ${unique[1]}`
            : `${unique.slice(0, -1).join(', ')}, or ${unique.at(-1)}`;
    return `The public Playground account cannot read ${list} metadata.`;
}

export function collectSchemaMetadataWarnings(
    generalWarnings: readonly (string | undefined)[],
    optionalWarnings: readonly OptionalSchemaMetadataWarning[],
    isPublicPlayground: boolean,
): string[] {
    const restrictedKinds = isPublicPlayground
        ? optionalWarnings.filter(item => item.permissionDenied).map(item => item.kind)
        : [];
    const playgroundWarning = formatPlaygroundMetadataWarning(restrictedKinds);
    return [
        ...generalWarnings,
        ...(playgroundWarning ? [playgroundWarning] : []),
        ...optionalWarnings.filter(item => !(isPublicPlayground && item.permissionDenied)).map(item => item.warning),
    ].filter((warning): warning is string => Boolean(warning));
}

export function enrichSchemaTables(
    tables: SchemaTable[],
    metadata: {
        tables?: SchemaTableMetadata[];
        projections?: SchemaTableProjection[];
        skipIndexes?: SchemaTableSkipIndex[];
    },
): SchemaTable[] {
    const key = (database: string, table: string) => `${database}\0${table}`;
    const tableDetails = new Map((metadata.tables ?? []).map(detail => [key(detail.database, detail.name), detail]));
    const projections = new Map<string, SchemaProjection[]>();
    const skipIndexes = new Map<string, SchemaSkipIndex[]>();

    for (const projection of metadata.projections ?? []) {
        const tableKey = key(projection.database, projection.table);
        const entries = projections.get(tableKey) ?? [];
        entries.push({ name: projection.name, type: projection.type, sortingKey: projection.sortingKey });
        projections.set(tableKey, entries);
    }
    for (const index of metadata.skipIndexes ?? []) {
        const tableKey = key(index.database, index.table);
        const entries = skipIndexes.get(tableKey) ?? [];
        entries.push({ name: index.name, type: index.type, expression: index.expression, granularity: index.granularity });
        skipIndexes.set(tableKey, entries);
    }

    return tables.map(table => {
        const detail = tableDetails.get(key(table.database, table.name));
        const enriched: SchemaTable = { ...table };
        if (detail) {
            const { database: _database, name: _name, ...fields } = detail;
            Object.assign(enriched, fields);
        }
        if (metadata.projections !== undefined)
            enriched.projections = projections.get(key(table.database, table.name)) ?? [];
        if (metadata.skipIndexes !== undefined)
            enriched.skipIndexes = skipIndexes.get(key(table.database, table.name)) ?? [];
        return enriched;
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isOptionalString(value: unknown): value is string | undefined {
    return value === undefined || typeof value === 'string';
}

function isOptionalNullableString(value: unknown): value is string | null | undefined {
    return value === undefined || value === null || typeof value === 'string';
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function isSchemaProjection(value: unknown): value is SchemaProjection {
    return isRecord(value)
        && typeof value.name === 'string'
        && typeof value.type === 'string'
        && typeof value.sortingKey === 'string';
}

function isSchemaSkipIndex(value: unknown): value is SchemaSkipIndex {
    return isRecord(value)
        && typeof value.name === 'string'
        && typeof value.type === 'string'
        && typeof value.expression === 'string'
        && typeof value.granularity === 'string';
}

function isSchemaColumn(value: unknown): value is SchemaColumn {
    return isRecord(value)
        && typeof value.database === 'string'
        && typeof value.table === 'string'
        && typeof value.name === 'string'
        && typeof value.type === 'string'
        && typeof value.defaultKind === 'string'
        && typeof value.comment === 'string';
}

function isSchemaTable(value: unknown): value is SchemaTable {
    return isRecord(value)
        && typeof value.database === 'string'
        && typeof value.name === 'string'
        && typeof value.engine === 'string'
        && isOptionalString(value.orderBy)
        && isOptionalString(value.primaryKey)
        && isOptionalString(value.partitionKey)
        && isOptionalString(value.samplingKey)
        && (value.ttlConfigured === undefined || typeof value.ttlConfigured === 'boolean')
        && isOptionalString(value.materializedViewTarget)
        && isOptionalNullableString(value.rowEstimate)
        && isOptionalNullableString(value.sizeBytes)
        && isOptionalNullableString(value.uncompressedBytes)
        && isOptionalNullableString(value.parts)
        && isOptionalNullableString(value.activeParts)
        && (value.skipIndexTypes === undefined || isStringArray(value.skipIndexTypes))
        && (value.projections === undefined || Array.isArray(value.projections) && value.projections.every(isSchemaProjection))
        && (value.skipIndexes === undefined || Array.isArray(value.skipIndexes) && value.skipIndexes.every(isSchemaSkipIndex));
}

function isSchemaDictionary(value: unknown): value is SchemaDictionary {
    return isRecord(value)
        && typeof value.database === 'string'
        && typeof value.name === 'string'
        && typeof value.status === 'string'
        && typeof value.type === 'string'
        && typeof value.keyColumns === 'string'
        && typeof value.attributeColumns === 'string'
        && typeof value.elementCount === 'string'
        && typeof value.memoryBytes === 'string'
        && typeof value.lastSuccessfulUpdate === 'string';
}

export function isSchema(value: unknown): value is Schema {
    return isRecord(value)
        && typeof value.connectionId === 'string'
        && typeof value.fetchedAt === 'string'
        && Array.isArray(value.columns)
        && value.columns.every(isSchemaColumn)
        && Array.isArray(value.tables)
        && value.tables.every(isSchemaTable)
        && (value.dictionaries === undefined || Array.isArray(value.dictionaries) && value.dictionaries.every(isSchemaDictionary))
        && isStringArray(value.warnings)
        && (value.metadataWarnings === undefined || isStringArray(value.metadataWarnings))
        && typeof value.truncated === 'boolean';
}
