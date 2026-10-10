import type {
    ClickHouseDocumentationEntry,
    ClickHouseDocumentationSummary,
    ReferenceCategory,
    Row,
} from '../shared/types.js';
import {
    buildReferenceEntryQuery,
    buildReferenceSearchQuery,
    isMissingDocumentationSourceColumn,
} from '../shared/reference.js';
import { api, isFrontendDemoPreview, RequestError } from './api.js';
import {
    PLAYGROUND_CONNECTION_ID,
    PlaygroundError,
    queryPlaygroundWithParams,
    type PlaygroundQueryResult,
} from './playground.js';
import type { Connected } from './workspace-types.js';

export type ReferenceProvider = {
    kind: 'native' | 'bundled';
    search: (
        query: string,
        category: ReferenceCategory,
        signal: AbortSignal,
    ) => Promise<ClickHouseDocumentationSummary[]>;
    get: (
        name: string,
        type: string,
        signal: AbortSignal,
    ) => Promise<ClickHouseDocumentationEntry | undefined>;
};

function stringColumn(result: PlaygroundQueryResult, row: Row, name: string) {
    const index = result.columns.findIndex(column => column.name === name);
    const value = index < 0 ? undefined : row[index];
    return typeof value === 'string' ? value : undefined;
}

function playgroundRows<T>(
    result: PlaygroundQueryResult,
    convert: (result: PlaygroundQueryResult, row: Row) => T,
): T[] {
    return result.rows.map(row => convert(result, row));
}

export function isReferenceUnavailable(error: unknown) {
    if (error instanceof RequestError && error.detail.code === 'CAPABILITY_UNAVAILABLE')
        return true;
    const value =
        error instanceof PlaygroundError
            ? `${error.code} ${error.message}`
            : error instanceof Error
              ? error.message
              : String(error);
    return /CLICKHOUSE_(?:47|60|497|516)\b|system\.documentation.{0,80}(?:does not exist|not found|unknown table|access denied)|(?:unknown table|not enough privileges|permission denied|access denied).{0,80}system\.documentation/i.test(
        value,
    );
}

const bundledProvider: ReferenceProvider = {
    kind: 'bundled',
    async search(query, category) {
        const referenceData = await import('./reference-data.js');
        return referenceData.searchBundledReference(query, category);
    },
    async get(name, type) {
        const referenceData = await import('./reference-data.js');
        return referenceData.findBundledReference(name, type);
    },
};

function serverProvider(connection: Connected): ReferenceProvider {
    const prefix = `/connections/${encodeURIComponent(connection.id)}/documentation`;
    return {
        kind: 'native',
        search(query, category, signal) {
            const params = new URLSearchParams({ query, category });
            return api<ClickHouseDocumentationSummary[]>(`${prefix}/search?${params}`, { signal });
        },
        get(name, type, signal) {
            const params = new URLSearchParams({ name, type });
            return api<ClickHouseDocumentationEntry>(`${prefix}/entry?${params}`, { signal });
        },
    };
}

function playgroundProvider(): ReferenceProvider {
    const run = async <T>(
        query: string,
        parameters: Record<string, string>,
        signal: AbortSignal,
        convert: (result: PlaygroundQueryResult, row: Row) => T,
    ) => {
        try {
            const result = await queryPlaygroundWithParams(query, parameters, signal);
            return playgroundRows(result, convert);
        } catch (error) {
            if (!isMissingDocumentationSourceColumn(error)) throw error;
            const fallbackQuery = query.replace(', source', '');
            const result = await queryPlaygroundWithParams(fallbackQuery, parameters, signal);
            return playgroundRows(result, convert);
        }
    };
    return {
        kind: 'native',
        async search(query, category, signal) {
            const built = buildReferenceSearchQuery(query, category, true);
            return run<ClickHouseDocumentationSummary>(
                built.sql,
                built.parameters,
                signal,
                (result, row) => ({
                    name: stringColumn(result, row, 'name') ?? '',
                    type: stringColumn(result, row, 'type') ?? '',
                    source: stringColumn(result, row, 'source'),
                }),
            );
        },
        async get(name, type, signal) {
            const query = buildReferenceEntryQuery(true);
            const entries = await run<ClickHouseDocumentationEntry>(
                query,
                { name, type },
                signal,
                (result, row) => ({
                    name: stringColumn(result, row, 'name') ?? '',
                    type: stringColumn(result, row, 'type') ?? '',
                    description: stringColumn(result, row, 'description') ?? '',
                    source: stringColumn(result, row, 'source'),
                    serverVersion:
                        stringColumn(result, row, 'serverVersion') ?? 'ClickHouse Playground',
                    origin: 'native' as const,
                }),
            );
            return entries[0];
        },
    };
}

export function createReferenceProvider(connection: Connected): ReferenceProvider {
    if (isFrontendDemoPreview && connection.id === PLAYGROUND_CONNECTION_ID)
        return playgroundProvider();
    if (
        connection.dataSource === 'fixture' ||
        connection.manifest?.documentation.available === false
    )
        return bundledProvider;
    return serverProvider(connection);
}

export { bundledProvider };
