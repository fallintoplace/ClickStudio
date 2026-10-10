import type { ClickHouseDocumentationSummary } from './types.js';

export const REFERENCE_CATEGORIES = ['all', 'functions', 'types', 'engines', 'settings', 'system', 'formats', 'sql'] as const;
export type ReferenceCategory = typeof REFERENCE_CATEGORIES[number];

export const REFERENCE_TYPES_BY_CATEGORY: Readonly<Record<Exclude<ReferenceCategory, 'all'>, readonly string[]>> = {
    functions: ['Function', 'Aggregate Function', 'Table Function', 'Aggregate Function Combinator'],
    types: ['Data Type'],
    engines: ['Table Engine', 'Database Engine', 'Dictionary Layout', 'Dictionary Source', 'Data Skipping Index', 'Disk Type', 'Compression Codec'],
    settings: ['Setting', 'MergeTree Setting', 'Server Setting'],
    system: ['System Table', 'Profile Event', 'Current Metric', 'Asynchronous Metric'],
    formats: ['Format'],
    sql: ['Statement', 'SQL Statement', 'SQL Operator', 'SQL Syntax', 'Protocol'],
};

export const POPULAR_REFERENCE: readonly ClickHouseDocumentationSummary[] = [
    { name: 'quantileExact', type: 'Aggregate Function' },
    { name: 'uniq', type: 'Aggregate Function' },
    { name: 'MergeTree', type: 'Table Engine' },
    { name: 'LowCardinality', type: 'Data Type' },
    { name: 'max_threads', type: 'Setting' },
    { name: 'query_log', type: 'System Table' },
    { name: 'arrayJoin', type: 'Function' },
    { name: 'DateTime64', type: 'Data Type' },
    { name: 'ReplacingMergeTree', type: 'Table Engine' },
    { name: 'JSONEachRow', type: 'Format' },
];

export function isReferenceCategory(value: string): value is ReferenceCategory {
    return (REFERENCE_CATEGORIES as readonly string[]).includes(value);
}

export function referenceId(entry: Pick<ClickHouseDocumentationSummary, 'name' | 'type'>) {
    return `${entry.type}\u0000${entry.name}`;
}

export function isMissingDocumentationSourceColumn(error: unknown) {
    return error instanceof Error && /\bsource\b.{0,80}(?:unknown (?:expression )?identifier|unknown column|not found|doesn't exist|does not exist)|(?:missing columns|unknown (?:expression )?identifier|unknown column|not found|doesn't exist|does not exist).{0,80}\bsource\b/i.test(error.message);
}

export function buildReferenceSearchQuery(query: string, category: ReferenceCategory, includeSource = true) {
    const search = query.trim().slice(0, 128);
    const typeNames = category === 'all' ? [] : REFERENCE_TYPES_BY_CATEGORY[category];
    const typeFilter = typeNames.length ? `AND type IN (${typeNames.map(type => `'${type}'`).join(', ')})` : '';
    const searchFilter = search
        ? 'AND (positionCaseInsensitive(name, {search:String}) > 0 OR positionCaseInsensitive(description, {search:String}) > 0)'
        : '';
    const favoriteOrder = POPULAR_REFERENCE.map(entry => `'${entry.type}:${entry.name}'`).join(', ');
    const favoriteIndex = `indexOf([${favoriteOrder}], concat(toString(type), ':', name))`;
    const rank = `if(length({search:String}) = 0, if(${favoriteIndex} = 0, ${POPULAR_REFERENCE.length + 1}, ${favoriteIndex}), multiIf(lower(name) = lower({search:String}), 0, startsWith(lower(name), lower({search:String})), 1, positionCaseInsensitive(name, {search:String}) > 0, 2, 3))`;
    const source = includeSource ? ', source' : '';
    return {
        sql: `SELECT name, toString(type) AS type${source} FROM system.documentation WHERE 1 ${typeFilter} ${searchFilter} ORDER BY ${rank}, name, type`,
        parameters: { search },
    };
}

export function buildReferenceEntryQuery(includeSource = true) {
    const source = includeSource ? ', source' : '';
    return `SELECT name, toString(type) AS type, description${source}, version() AS serverVersion FROM system.documentation WHERE name = {name:String} AND toString(type) = {type:String} LIMIT 1`;
}
