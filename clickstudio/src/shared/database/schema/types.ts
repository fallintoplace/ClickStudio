import type { Column } from '../../common/values.js';

export interface SchemaColumn extends Column {
    database: string;
    table: string;
    defaultKind: string;
    comment: string;
}

export interface SchemaProjection {
    name: string;
    type: string;
    sortingKey: string;
}

export interface SchemaSkipIndex {
    name: string;
    type: string;
    expression: string;
    granularity: string;
}

export interface SchemaTable {
    database: string;
    name: string;
    engine: string;
    orderBy?: string;
    primaryKey?: string;
    partitionKey?: string;
    samplingKey?: string;
    ttlConfigured?: boolean;
    materializedViewTarget?: string;
    rowEstimate?: string | null;
    sizeBytes?: string | null;
    uncompressedBytes?: string | null;
    parts?: string | null;
    activeParts?: string | null;
    skipIndexTypes?: string[];
    projections?: SchemaProjection[];
    skipIndexes?: SchemaSkipIndex[];
}

export interface SchemaDictionary {
    database: string;
    name: string;
    status: string;
    type: string;
    keyColumns: string;
    attributeColumns: string;
    elementCount: string;
    memoryBytes: string;
    lastSuccessfulUpdate: string;
}

export interface Schema {
    connectionId: string;
    fetchedAt: string;
    databases?: string[];
    columns: SchemaColumn[];
    tables: SchemaTable[];
    dictionaries?: SchemaDictionary[];
    warnings: string[];
    metadataWarnings?: string[];
    truncated: boolean;
    pagination?: {
        databases?: number;
        tables?: number;
        columns?: number;
    };
}
