import type {
    Schema,
    SchemaColumn,
    SchemaDictionary,
    SchemaProjection,
    SchemaSkipIndex,
    SchemaTable,
} from '../../../../shared/database/schema/types.js';
import { quoteIdentifier } from '../../../../shared/sql/sql.js';

export type ExplorerRelationKind = 'table' | 'view';
export type ExplorerCategoryKind = ExplorerRelationKind | 'dictionary';

export interface ExplorerRelation {
    id: string;
    kind: ExplorerRelationKind;
    table: SchemaTable;
    columns: readonly SchemaColumn[];
    matchedColumns: readonly SchemaColumn[];
    matchedProjections: readonly SchemaProjection[];
    matchedSkipIndexes: readonly SchemaSkipIndex[];
    relationMatches: boolean;
}

export interface ExplorerDatabase {
    id: string;
    name: string;
    tables: readonly ExplorerRelation[];
    views: readonly ExplorerRelation[];
    dictionaries: readonly SchemaDictionary[];
    visibleObjectCount: number;
}

export type ExplorerSelection =
    | {
          id: string;
          kind: 'relation';
          relationKind: ExplorerRelationKind;
          table: SchemaTable;
          columns: readonly SchemaColumn[];
      }
    | { id: string; kind: 'column'; table: SchemaTable; column: SchemaColumn }
    | { id: string; kind: 'projection'; table: SchemaTable; projection: SchemaProjection }
    | { id: string; kind: 'skip-index'; table: SchemaTable; index: SchemaSkipIndex }
    | { id: string; kind: 'dictionary'; dictionary: SchemaDictionary };

export interface ObjectExplorerModel {
    query: string;
    databases: readonly ExplorerDatabase[];
    totalObjects: number;
    visibleObjects: number;
    selectionById: ReadonlyMap<string, ExplorerSelection>;
}

const key = (...parts: readonly string[]) => parts.join('\u0000');

export const explorerDatabaseId = (database: string) => `database:${database}`;
export const explorerCategoryId = (database: string, category: ExplorerCategoryKind) =>
    `category:${key(database, category)}`;
export const explorerRelationId = (database: string, table: string) =>
    `relation:${key(database, table)}`;
export const explorerColumnsId = (database: string, table: string) =>
    `columns:${key(database, table)}`;
export const explorerProjectionsId = (database: string, table: string) =>
    `projections:${key(database, table)}`;
export const explorerSkipIndexesId = (database: string, table: string) =>
    `skip-indexes:${key(database, table)}`;
export const explorerColumnId = (database: string, table: string, column: string) =>
    `column:${key(database, table, column)}`;
export const explorerProjectionId = (database: string, table: string, projection: string) =>
    `projection:${key(database, table, projection)}`;
export const explorerSkipIndexId = (database: string, table: string, index: string) =>
    `skip-index:${key(database, table, index)}`;
export const explorerDictionaryId = (database: string, dictionary: string) =>
    `dictionary:${key(database, dictionary)}`;

export function relationKind(table: SchemaTable): ExplorerRelationKind {
    return table.materializedViewTarget || table.engine.toLowerCase().includes('view')
        ? 'view'
        : 'table';
}

function relationSearchText(table: SchemaTable): string {
    const getTtlSearchText = () => {
        if (table.ttlConfigured === undefined) {
            return '';
        }

        if (table.ttlConfigured) {
            return 'ttl configured';
        }

        return 'no ttl';
    };
    return [
        table.database,
        table.name,
        table.engine,
        table.orderBy,
        table.primaryKey,
        table.partitionKey,
        table.samplingKey,
        table.materializedViewTarget,
        table.rowEstimate,
        table.sizeBytes,
        table.uncompressedBytes,
        table.parts,
        table.activeParts,
        getTtlSearchText(),
        table.skipIndexTypes?.join(' '),
        ...(table.projections ?? []).flatMap(projection => [
            projection.name,
            projection.type,
            projection.sortingKey,
        ]),
        ...(table.skipIndexes ?? []).flatMap(index => [
            index.name,
            index.type,
            index.expression,
            index.granularity,
        ]),
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
}

function dictionarySearchText(dictionary: SchemaDictionary): string {
    return [
        dictionary.database,
        dictionary.name,
        dictionary.status,
        dictionary.type,
        dictionary.keyColumns,
        dictionary.attributeColumns,
        dictionary.elementCount,
        dictionary.memoryBytes,
        dictionary.lastSuccessfulUpdate,
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
}

function databaseSort(preferredDatabase: string) {
    return (left: ExplorerDatabase, right: ExplorerDatabase) => {
        const rank = (database: string) => {
            if (database === preferredDatabase) {
                return 0;
            }

            if (database === 'system') {
                return 2;
            }

            return 1;
        };
        return rank(left.name) - rank(right.name) || left.name.localeCompare(right.name);
    };
}

export function buildObjectExplorer(
    schema: Schema | undefined,
    search: string,
    preferredDatabase = '',
): ObjectExplorerModel {
    const query = search.trim().toLowerCase();
    const selectionById = new Map<string, ExplorerSelection>();
    if (!schema) return { query, databases: [], totalObjects: 0, visibleObjects: 0, selectionById };

    const columnsByTable = new Map<string, SchemaColumn[]>();
    for (const column of schema.columns) {
        const tableKey = key(column.database, column.table);
        const columns = columnsByTable.get(tableKey) ?? [];
        columns.push(column);
        columnsByTable.set(tableKey, columns);
    }

    type MutableDatabase = {
        id: string;
        name: string;
        tables: ExplorerRelation[];
        views: ExplorerRelation[];
        dictionaries: SchemaDictionary[];
    };
    const databases = new Map<string, MutableDatabase>();
    const ensureDatabase = (database: string) => {
        const name = database || 'Server';
        const existing = databases.get(name);
        if (existing) return existing;
        const created: MutableDatabase = {
            id: explorerDatabaseId(name),
            name,
            tables: [],
            views: [],
            dictionaries: [],
        };
        databases.set(name, created);
        return created;
    };

    for (const table of schema.tables) {
        const columns = columnsByTable.get(key(table.database, table.name)) ?? [];
        const kind = relationKind(table);
        const relationId = explorerRelationId(table.database, table.name);
        selectionById.set(relationId, {
            id: relationId,
            kind: 'relation',
            relationKind: kind,
            table,
            columns,
        });
        for (const column of columns) {
            const id = explorerColumnId(table.database, table.name, column.name);
            selectionById.set(id, { id, kind: 'column', table, column });
        }
        for (const projection of table.projections ?? []) {
            const id = explorerProjectionId(table.database, table.name, projection.name);
            selectionById.set(id, { id, kind: 'projection', table, projection });
        }
        for (const index of table.skipIndexes ?? []) {
            const id = explorerSkipIndexId(table.database, table.name, index.name);
            selectionById.set(id, { id, kind: 'skip-index', table, index });
        }

        const relationMatches = !query || relationSearchText(table).includes(query);
        const matchedColumns = query
            ? columns.filter(column =>
                  `${column.name} ${column.type} ${column.defaultKind} ${column.comment}`
                      .toLowerCase()
                      .includes(query),
              )
            : [];
        const matchedProjections = query
            ? (table.projections ?? []).filter(projection =>
                  `${projection.name} ${projection.type} ${projection.sortingKey}`
                      .toLowerCase()
                      .includes(query),
              )
            : [];
        const matchedSkipIndexes = query
            ? (table.skipIndexes ?? []).filter(index =>
                  `${index.name} ${index.type} ${index.expression} ${index.granularity}`
                      .toLowerCase()
                      .includes(query),
              )
            : [];
        if (
            query &&
            !relationMatches &&
            !matchedColumns.length &&
            !matchedProjections.length &&
            !matchedSkipIndexes.length
        )
            continue;

        const relation: ExplorerRelation = {
            id: relationId,
            kind,
            table,
            columns,
            matchedColumns,
            matchedProjections,
            matchedSkipIndexes,
            relationMatches,
        };
        const database = ensureDatabase(table.database);
        (kind === 'view' ? database.views : database.tables).push(relation);
    }

    for (const dictionary of schema.dictionaries ?? []) {
        const id = explorerDictionaryId(dictionary.database, dictionary.name);
        selectionById.set(id, { id, kind: 'dictionary', dictionary });
        if (query && !dictionarySearchText(dictionary).includes(query)) continue;
        ensureDatabase(dictionary.database).dictionaries.push(dictionary);
    }

    const sortRelations = (relations: ExplorerRelation[]) =>
        relations.sort((left, right) => left.table.name.localeCompare(right.table.name));
    const result = [...databases.values()]
        .map(database => {
            sortRelations(database.tables);
            sortRelations(database.views);
            database.dictionaries.sort((left, right) => left.name.localeCompare(right.name));
            return {
                ...database,
                visibleObjectCount:
                    database.tables.length + database.views.length + database.dictionaries.length,
            } satisfies ExplorerDatabase;
        })
        .filter(database => database.visibleObjectCount > 0)
        .sort(databaseSort(preferredDatabase));

    const totalObjects = schema.tables.length + (schema.dictionaries?.length ?? 0);
    const visibleObjects = result.reduce((sum, database) => sum + database.visibleObjectCount, 0);
    return { query, databases: result, totalObjects, visibleObjects, selectionById };
}

export function tableQuerySql(
    table: SchemaTable,
    columns: readonly SchemaColumn[],
    mode: 'preview' | 'select',
): string {
    const qualifiedName = `${quoteIdentifier(table.database)}.${quoteIdentifier(table.name)}`;
    if (mode === 'preview') return `SELECT *\nFROM ${qualifiedName}\nLIMIT 100;`;

    const selectList =
        columns.length > 0 && columns.length <= 24
            ? columns.map(column => `    ${quoteIdentifier(column.name)}`).join(',\n')
            : '    *';
    return `SELECT\n${selectList}\nFROM ${qualifiedName}\nLIMIT 100;`;
}
