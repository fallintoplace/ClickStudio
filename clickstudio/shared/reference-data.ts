import type { ClickHouseDocumentationEntry, ReferenceCategory, Schema } from './types.js';
import { POPULAR_REFERENCE, REFERENCE_TYPES_BY_CATEGORY, referenceId } from './reference.js';
import offlineReferenceCatalog from './offline-reference-catalog.json' with { type: 'json' };

const CURATED_REFERENCE: readonly ClickHouseDocumentationEntry[] = [
    { name: 'MergeTree', type: 'Table Engine', description: 'The general-purpose engine for high insert throughput and analytical queries. It stores sorted data parts; choose a sorting key that matches common filters and grouping patterns.\n\n```sql\nCREATE TABLE events\n(\n    event_time DateTime,\n    user_id UInt64,\n    event_type LowCardinality(String)\n)\nENGINE = MergeTree\nPARTITION BY toYYYYMM(event_time)\nORDER BY (event_type, event_time, user_id)\n```', serverVersion: 'Demo catalog', origin: 'bundled' },
    { name: 'ReplacingMergeTree', type: 'Table Engine', description: 'Keeps rows with matching sorting keys and removes older versions during background merges. Deduplication is eventual; use `FINAL` only when its query cost is acceptable.\n\n```sql\nCREATE TABLE user_profile\n(\n    user_id UInt64,\n    updated_at DateTime,\n    plan String\n)\nENGINE = ReplacingMergeTree(updated_at)\nORDER BY user_id\n```', serverVersion: 'Demo catalog', origin: 'bundled' },
    { name: 'SummingMergeTree', type: 'Table Engine', description: 'Combines rows with the same sorting key by summing selected numeric columns during background merges. Queries should still aggregate because merges may not have happened yet.\n\n```sql\nCREATE TABLE daily_counts\n(\n    day Date,\n    country LowCardinality(String),\n    events UInt64\n)\nENGINE = SummingMergeTree\nORDER BY (day, country)\n```', serverVersion: 'Demo catalog', origin: 'bundled' },
    { name: 'AggregatingMergeTree', type: 'Table Engine', description: 'Stores and merges aggregate states for pre-aggregated data. Build states with `...State` functions and read them with the matching `...Merge` function.\n\n```sql\nCREATE TABLE daily_uniques\n(\n    day Date,\n    users AggregateFunction(uniqExact, UInt64)\n)\nENGINE = AggregatingMergeTree\nORDER BY day;\n\nINSERT INTO daily_uniques\nSELECT toDate(event_time), uniqExactState(user_id)\nFROM events\nGROUP BY toDate(event_time);\n\nSELECT day, uniqExactMerge(users) AS users\nFROM daily_uniques\nGROUP BY day\n```', serverVersion: 'Demo catalog', origin: 'bundled' },
    { name: 'Distributed', type: 'Table Engine', description: 'Routes reads and writes across shards using a configured cluster. Create a matching local table on each shard first; the Distributed table stores no data itself.\n\n```sql\nCREATE TABLE events_all AS events_local\nENGINE = Distributed(\n    analytics_cluster,\n    currentDatabase(),\n    events_local,\n    cityHash64(user_id)\n)\n```', serverVersion: 'Demo catalog', origin: 'bundled' },
    { name: 'Array', type: 'Data Type', description: 'Stores an ordered collection of values of one element type. Use array functions to filter, transform, or expand its values.\n\n```sql\nSELECT arrayJoin([\'signup\', \'purchase\']) AS event_type\n```', serverVersion: 'Demo catalog', origin: 'bundled' },
    { name: 'Decimal', type: 'Data Type', description: 'Stores fixed-precision decimal values. Choose precision and scale explicitly for currency and other exact decimal calculations.\n\n```sql\nSELECT toDecimal64(12.34, 2) AS amount\n```', serverVersion: 'Demo catalog', origin: 'bundled' },
    { name: 'Map', type: 'Data Type', description: 'Stores key/value pairs with one key type and one value type. Map lookups return the default value for a missing key.\n\n```sql\nSELECT map(\'region\', \'eu\')[\'region\'] AS region\n```', serverVersion: 'Demo catalog', origin: 'bundled' },
    { name: 'UInt64', type: 'Data Type', description: 'An unsigned 64-bit integer for non-negative whole numbers. Convert explicitly when a source value has a different type.\n\n```sql\nSELECT toUInt64(42) AS event_count\n```', serverVersion: 'Demo catalog', origin: 'bundled' },
    { name: 'LowCardinality', type: 'Data Type', description: 'A dictionary-encoded type modifier that can reduce storage and improve processing when a column contains relatively few distinct values.\n\n```sql\nCREATE TABLE events\n(\n    event_type LowCardinality(String),\n    country LowCardinality(String)\n)\nENGINE = MergeTree\nORDER BY (country, event_type)\n```', serverVersion: 'Demo catalog', origin: 'bundled' },
    { name: 'Nullable', type: 'Data Type', description: 'A type modifier that allows a column to contain `NULL`. Nullable columns use additional storage and can add processing overhead. Use `IS NULL` or `isNull` to find missing values.\n\n```sql\nSELECT countIf(isNull(discount)) AS missing_discounts\nFROM orders\n```', serverVersion: 'Demo catalog', origin: 'bundled' },
    { name: 'DateTime64', type: 'Data Type', description: 'A date and time type with configurable subsecond precision.\n\n```sql\nDateTime64(3, \'UTC\')\n```', serverVersion: 'Demo catalog', origin: 'bundled' },
    { name: 'argMax', type: 'Aggregate Function', description: 'Returns the value of one expression for the row where another expression is greatest. It is useful for selecting the latest value per group.\n\n```sql\nSELECT user_id, argMax(status, updated_at) AS latest_status\nFROM order_updates\nGROUP BY user_id\n```', serverVersion: 'Demo catalog', origin: 'bundled' },
    { name: 'countIf', type: 'Aggregate Function', description: 'Counts rows that match a condition. Use it alongside `count()` to calculate rates without a separate filtered query.\n\n```sql\nSELECT countIf(status >= 500) AS server_errors\nFROM http_logs\n```', serverVersion: 'Demo catalog', origin: 'bundled' },
    { name: 'sum', type: 'Aggregate Function', description: 'Adds numeric values in each group. Filtered sums can use `sumIf(value, condition)`.\n\n```sql\nSELECT country, sum(revenue) AS revenue\nFROM events\nGROUP BY country\n```', serverVersion: 'Demo catalog', origin: 'bundled' },
    { name: 'uniq', type: 'Aggregate Function', description: 'Estimates the number of distinct values using an adaptive sampling algorithm. It is usually faster and smaller than exact counting.\n\n```sql\nSELECT country, uniq(user_id) AS visitors\nFROM events\nGROUP BY country\n```', serverVersion: 'Demo catalog', origin: 'bundled' },
    { name: 'uniqExact', type: 'Aggregate Function', description: 'Counts distinct values exactly. Its memory use grows with the number of distinct values.\n\n```sql\nSELECT uniqExact(user_id) AS visitors\nFROM events\nWHERE event_time >= now() - INTERVAL 7 DAY\n```', serverVersion: 'Demo catalog', origin: 'bundled' },
    { name: 'quantile', type: 'Aggregate Function', description: 'Computes an approximate quantile. Use a level such as `0.95` for the 95th percentile; choose an exact variant when exact results are required.\n\n```sql\nSELECT quantile(0.95)(duration_ms) AS p95_ms\nFROM request_log\n```', serverVersion: 'Demo catalog', origin: 'bundled' },
    { name: 'quantileExact', type: 'Aggregate Function', description: 'Computes an exact quantile by retaining values for the calculation. This can use substantially more memory than approximate quantile functions.\n\n```sql\nSELECT quantileExact(0.5)(duration_ms) AS median_ms\nFROM request_log\n```', serverVersion: 'Demo catalog', origin: 'bundled' },
    { name: 'arrayJoin', type: 'Function', description: 'Expands an array into multiple rows. Each source row can produce one output row for every array element.\n\n```sql\nSELECT arrayJoin([\'docs\', \'blog\']) AS section\n```', serverVersion: 'Demo catalog', origin: 'bundled' },
    { name: 'toStartOfInterval', type: 'Function', description: 'Rounds a date or time down to the start of an interval, which is useful for time-bucketed analysis.\n\n```sql\nSELECT\n    toStartOfInterval(event_time, INTERVAL 15 MINUTE) AS bucket,\n    count() AS events\nFROM events\nGROUP BY bucket\nORDER BY bucket\n```', serverVersion: 'Demo catalog', origin: 'bundled' },
    { name: 'JSONExtractString', type: 'Function', description: 'Reads a string field from JSON text. For repeated access to large JSON payloads, consider extracting fields into typed columns.\n\n```sql\nSELECT JSONExtractString(\'{"campaign":"spring"}\', \'campaign\') AS campaign\n```', serverVersion: 'Demo catalog', origin: 'bundled' },
    { name: 'max_threads', type: 'Setting', description: 'Limits the maximum number of query-processing threads. The effective value can also depend on user profiles and server configuration. Apply a query-level value with `SETTINGS`.\n\n```sql\nSELECT count()\nFROM events\nSETTINGS max_threads = 4\n```', serverVersion: 'Demo catalog', origin: 'bundled' },
    { name: 'max_execution_time', type: 'Setting', description: 'Sets a query execution time limit in seconds. The server can also apply a stricter profile or user limit.\n\n```sql\nSELECT count()\nFROM events\nSETTINGS max_execution_time = 5\n```', serverVersion: 'Demo catalog', origin: 'bundled' },
    { name: 'max_memory_usage', type: 'Setting', description: 'Limits memory used by a query, in bytes. A user profile or server configuration can impose a lower limit.\n\n```sql\nSELECT count()\nFROM events\nSETTINGS max_memory_usage = 500000000\n```', serverVersion: 'Demo catalog', origin: 'bundled' },
    { name: 'query_log', type: 'System Table', description: 'Stores query execution records for the current server. Logging and flush intervals affect when recent records become visible.\n\n```sql\nSELECT query, event_time, query_duration_ms\nFROM system.query_log\nORDER BY event_time DESC\nLIMIT 20\n```', serverVersion: 'Demo catalog', origin: 'bundled' },
    { name: 'parts', type: 'System Table', description: 'Exposes data parts for MergeTree tables, including their ranges, row counts, and active state. Filter to active parts when inspecting the current table layout.\n\n```sql\nSELECT partition, count() AS parts, sum(rows) AS rows\nFROM system.parts\nWHERE database = currentDatabase()\n  AND table = \'events\'\n  AND active\nGROUP BY partition\nORDER BY partition\n```', serverVersion: 'Demo catalog', origin: 'bundled' },
    { name: 'columns', type: 'System Table', description: 'Lists columns and types for databases and tables visible to the current user. Filter by both database and table to keep the result focused.\n\n```sql\nSELECT name, type\nFROM system.columns\nWHERE database = \'default\' AND table = \'events\'\nORDER BY position\n```', serverVersion: 'Demo catalog', origin: 'bundled' },
    { name: 'Parquet', type: 'Format', description: 'A columnar file format supported by ClickHouse for reading and writing analytical data. The `file` table function can read a local Parquet file when the server has access to it.\n\n```sql\nSELECT *\nFROM file(\'events.parquet\')\nLIMIT 10\n```', serverVersion: 'Demo catalog', origin: 'bundled' },
    { name: 'JSONEachRow', type: 'Format', description: 'A JSON format that represents each result row as one JSON object, with column names as keys.\n\n```sql\nSELECT event_time, event_type\nFROM events\nLIMIT 10\nFORMAT JSONEachRow\n```', serverVersion: 'Demo catalog', origin: 'bundled' },
];

type OfflineReferenceEntry = Pick<ClickHouseDocumentationEntry, 'name' | 'type' | 'description' | 'source'>;
const curatedIds = new Set(CURATED_REFERENCE.map(referenceId));
const generatedReference: readonly ClickHouseDocumentationEntry[] = (offlineReferenceCatalog.entries as OfflineReferenceEntry[]).map(entry => ({
    ...entry,
    serverVersion: `Offline docs ${offlineReferenceCatalog.sourceRevision.slice(0, 7)}`,
    origin: 'bundled',
}));

export const BUNDLED_REFERENCE: readonly ClickHouseDocumentationEntry[] = [
    ...CURATED_REFERENCE,
    ...generatedReference.filter(entry => !curatedIds.has(referenceId(entry))),
];

function displayName(entry: Pick<ClickHouseDocumentationEntry, 'name' | 'type'>) {
    return entry.type === 'System Table' ? `system.${entry.name}` : entry.name;
}

function inCategory(entry: ClickHouseDocumentationEntry, category: ReferenceCategory) {
    return category === 'all' || REFERENCE_TYPES_BY_CATEGORY[category].includes(entry.type);
}

export function searchBundledReference(query: string, category: ReferenceCategory): ClickHouseDocumentationEntry[] {
    const search = query.trim().toLocaleLowerCase();
    const popularOrder = new Map(POPULAR_REFERENCE.map((entry, index) => [referenceId(entry), index]));
    return BUNDLED_REFERENCE
        .filter(entry => inCategory(entry, category))
        .map(entry => {
            const name = displayName(entry).toLocaleLowerCase();
            const type = entry.type.toLocaleLowerCase();
            const description = entry.description.toLocaleLowerCase();
            const score = !search ? 0 : name === search ? 0 : name.startsWith(search) ? 1 : name.includes(search) ? 2 : type.includes(search) || description.includes(search) ? 3 : -1;
            return { entry, score };
        })
        .filter(item => item.score >= 0)
        .sort((left, right) => {
            if (search) return left.score - right.score || left.entry.name.localeCompare(right.entry.name) || left.entry.type.localeCompare(right.entry.type);
            if (category === 'all') return (popularOrder.get(referenceId(left.entry)) ?? Number.MAX_SAFE_INTEGER) - (popularOrder.get(referenceId(right.entry)) ?? Number.MAX_SAFE_INTEGER);
            return left.entry.name.localeCompare(right.entry.name) || left.entry.type.localeCompare(right.entry.type);
        })
        .map(item => item.entry);
}

export function findBundledReference(name: string, type: string) {
    return BUNDLED_REFERENCE.find(entry => entry.name === name && entry.type === type);
}

const ASSISTANT_REFERENCE_LIMIT = 4;
const assistantStopWords = new Set([
    'about', 'after', 'all', 'also', 'and', 'are', 'as', 'at', 'be', 'before', 'between', 'by', 'can', 'clickhouse', 'data', 'does', 'explain', 'for', 'from', 'give', 'how', 'into', 'is', 'it', 'me', 'more', 'of', 'on', 'or', 'please', 'query', 'result', 'results', 'return', 'returns', 'show', 'sql', 'that', 'the', 'this', 'to', 'use', 'using', 'what', 'when', 'where', 'which', 'why', 'with', 'would', 'zero', 'zeros',
]);
const sqlStopWords = new Set([
    'add', 'after', 'all', 'alter', 'and', 'as', 'asc', 'between', 'by', 'case', 'create', 'cross', 'database', 'deduplication', 'delete', 'desc', 'distinct', 'drop', 'else', 'end', 'except', 'exists', 'explain', 'false', 'fetch', 'final', 'from', 'full', 'function', 'global', 'group', 'having', 'ilike', 'in', 'inner', 'insert', 'intersect', 'into', 'is', 'join', 'left', 'like', 'limit', 'local', 'natural', 'not', 'null', 'offset', 'on', 'optimize', 'or', 'order', 'outer', 'over', 'partition', 'prewhere', 'query', 'rename', 'replace', 'right', 'select', 'settings', 'table', 'then', 'to', 'true', 'truncate', 'union', 'update', 'use', 'using', 'values', 'when', 'where', 'with',
]);

function normalizedReferenceName(value: string) {
    return value.toLocaleLowerCase().replace(/[^a-z0-9_]/g, '');
}

const assistantReferencesByName = new Map<string, ClickHouseDocumentationEntry[]>();
for (const entry of BUNDLED_REFERENCE) {
    for (const name of [entry.name, displayName(entry)]) {
        const key = normalizedReferenceName(name);
        assistantReferencesByName.set(key, [...(assistantReferencesByName.get(key) ?? []), entry]);
    }
}

function identifiers(value: string) {
    return value.match(/[A-Za-z_][A-Za-z0-9_]*/g)?.map(token => token.toLocaleLowerCase()) ?? [];
}

const topicalPluralForms: Readonly<Record<string, string>> = { indexes: 'index', indices: 'index', functions: 'function', queries: 'query', tables: 'table', engines: 'engine', types: 'type', settings: 'setting' };

function words(value: string) {
    return value.replace(/([a-z0-9])([A-Z])/g, '$1 $2').match(/[A-Za-z0-9]+/g)?.map(token => {
        const word = token.toLocaleLowerCase();
        return topicalPluralForms[word] ?? word;
    }) ?? [];
}

export function selectAssistantReferenceDocs(question: string, sql: string, options: { schema?: Schema; database?: string; evidenceSql?: string; limit?: number } = {}): ClickHouseDocumentationEntry[] {
    const selected = new Map<string, { entry: ClickHouseDocumentationEntry; score: number }>();
    const add = (entry: ClickHouseDocumentationEntry, score: number) => {
        const key = referenceId(entry), previous = selected.get(key);
        if (!previous || previous.score < score) selected.set(key, { entry, score });
    };
    const addExact = (name: string, score: number, accept: (entry: ClickHouseDocumentationEntry) => boolean = () => true) => {
        for (const entry of assistantReferencesByName.get(normalizedReferenceName(name)) ?? [])
            if (accept(entry)) add(entry, score);
    };

    const searchableSql = [sql, options.evidenceSql]
        .filter((value): value is string => typeof value === 'string')
        .map(value => value.slice(0, 20000)
            .replace(/--[^\n]*/g, ' ')
            .replace(/\/\*[\s\S]*?\*\//g, ' ')
            .replace(/'(?:''|\\.|[^'])*'/g, ' ')
            .replace(/"(?:""|\\.|[^"])*"/g, ' '))
        .join('\n');
    const functionNames = [...searchableSql.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)].map(match => match[1] ?? '');
    for (const name of functionNames) addExact(name, 100);
    const relations = [...searchableSql.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\s+((?:`?[A-Za-z_][\w]*`?\.)?`?[A-Za-z_][\w]*`?)/gi)]
        .map(match => (match[1] ?? '').replaceAll('`', '').split('.'));
    for (const relation of relations) {
        const name = relation.at(-1) ?? '', database = relation.length > 1 ? relation[relation.length - 2] : undefined;
        const matchingTables = options.schema?.tables.filter(table => table.name.toLocaleLowerCase() === name.toLocaleLowerCase() && (!database || table.database.toLocaleLowerCase() === database.toLocaleLowerCase())) ?? [];
        const systemTable = database?.toLocaleLowerCase() === 'system' || matchingTables.some(table => table.database.toLocaleLowerCase() === 'system') || (!database && !matchingTables.length && options.database?.toLocaleLowerCase() === 'system');
        if (systemTable) addExact(name, 90, entry => entry.type === 'System Table');
        for (const table of matchingTables)
            if (table.database.toLocaleLowerCase() !== 'system') addExact(table.engine, 85, entry => entry.type.includes('Engine'));
    }

    const engineNames = [...searchableSql.matchAll(/\bENGINE\s*=\s*([A-Za-z_][A-Za-z0-9_]*)/gi)].map(match => match[1] ?? '');
    for (const name of engineNames) addExact(name, 85, entry => entry.type.includes('Engine'));
    const settingNames = [...searchableSql.matchAll(/\bSETTINGS?\s+([A-Za-z_][A-Za-z0-9_]*)\s*=/gi)].map(match => match[1] ?? '');
    for (const name of settingNames) addExact(name, 85, entry => entry.type.includes('Setting'));
    const formats = [...searchableSql.matchAll(/\bFORMAT\s+([A-Za-z_][A-Za-z0-9_]*)/gi)].map(match => match[1] ?? '');
    for (const name of formats) addExact(name, 85, entry => entry.type === 'Format');

    const questionIdentifiers = [...new Set(identifiers(question).filter(token => token.length >= 3 && !assistantStopWords.has(token)))];
    const schemaTables = new Set(options.schema?.tables.filter(table => table.database.toLocaleLowerCase() !== 'system').map(table => table.name.toLocaleLowerCase()) ?? []);
    const explicitlySystemQualified = /\bsystem\s*\.\s*[`"']?[a-z_][\w]*\b/i.test(question);
    for (const name of questionIdentifiers)
        addExact(name, 80, entry => entry.type !== 'System Table' || explicitlySystemQualified || !schemaTables.has(name));

    const topicTerms = [...new Set(words(question).filter(token => token.length >= 4 && !assistantStopWords.has(token) && !sqlStopWords.has(token)))].slice(0, 8);
    if (topicTerms.length) {
        const topical = BUNDLED_REFERENCE.map(entry => {
            const titleTerms = new Set(words(`${displayName(entry)} ${entry.type}`));
            const descriptionTerms = words(entry.description);
            const titleMatches = topicTerms.filter(term => titleTerms.has(term)).length;
            const descriptionMatches = topicTerms.filter(term => descriptionTerms.includes(term)).length;
            return { entry, score: titleMatches * 30 + descriptionMatches, titleMatches, descriptionMatches };
        }).filter(item => item.titleMatches > 0 || item.descriptionMatches >= 2)
            .sort((left, right) => right.score - left.score || left.entry.name.localeCompare(right.entry.name) || left.entry.type.localeCompare(right.entry.type));
        for (const item of topical.slice(0, 8)) add(item.entry, Math.min(70, 30 + item.score));
    }

    const boundedLimit = Math.max(0, Math.min(ASSISTANT_REFERENCE_LIMIT, Math.floor(options.limit ?? ASSISTANT_REFERENCE_LIMIT)));
    return [...selected.values()].sort((left, right) => right.score - left.score || left.entry.name.localeCompare(right.entry.name) || left.entry.type.localeCompare(right.entry.type))
        .slice(0, boundedLimit)
        .map(({ entry }) => entry);
}
