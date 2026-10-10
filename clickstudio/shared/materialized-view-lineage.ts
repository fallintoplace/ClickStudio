import {
    materializedViewDefinition,
    type MaterializedViewDefinition,
    type TableReference,
} from './materialized-view-definition.js';
import {
    metadataFlag,
    metadataInteger,
    metadataProgress,
    metadataText,
    metadataTime,
    type MetadataRow,
    type MetadataSnapshot,
} from './native-metadata.js';

export interface ViewRefresh {
    status: string;
    lastSuccessAt?: string;
    lastSuccessDurationMs?: string;
    lastAttemptAt?: string;
    nextRefreshAt?: string;
    progress?: number;
    readRows?: string;
    writtenRows?: string;
    exception?: string;
}
export interface LineageNode extends TableReference {
    id: string;
    engine: string;
    kind: 'table' | 'materialized-view' | 'external';
    mode?: MaterializedViewDefinition['mode'];
    schedule?: string;
    definition?: string;
    definitionTruncated?: boolean;
    refresh?: ViewRefresh;
}
export interface LineageEdge {
    source: string;
    target: string;
    kind: 'insert-trigger' | 'writes-to' | 'refresh-dependency' | 'catalog-dependency';
}
export interface LineageSnapshot extends MetadataSnapshot {
    kind: 'lineage';
    nodes: LineageNode[];
    edges: LineageEdge[];
}
export const LINEAGE_TABLE_LIMIT = 250;
const NODE_LIMIT = 500,
    EDGE_LIMIT = 1500;
export const tableReferenceId = (database: string, table: string) =>
    JSON.stringify([database, table]);

function pairedReferences(
    row: MetadataRow,
    databasesKey: string,
    tablesKey: string,
): TableReference[] {
    const databases = row[databasesKey],
        tables = row[tablesKey];
    if (!Array.isArray(databases) || !Array.isArray(tables)) return [];
    // Preserve indexes: filtering the two arrays separately would invent relationships.
    return tables
        .slice(0, 64)
        .flatMap((table, index) =>
            typeof table === 'string' && table && typeof databases[index] === 'string'
                ? [{ database: databases[index] as string, table }]
                : [],
        );
}
function refreshState(row: MetadataRow): ViewRefresh {
    return {
        status: metadataText(row.status) || 'Unknown',
        lastSuccessAt: metadataTime(row.last_success_time),
        lastSuccessDurationMs: metadataInteger(row.last_success_duration_ms),
        lastAttemptAt: metadataTime(row.last_refresh_time),
        nextRefreshAt: metadataTime(row.next_refresh_time),
        progress: metadataProgress(row.progress),
        readRows: metadataInteger(row.read_rows),
        writtenRows: metadataInteger(row.written_rows),
        exception: metadataText(row.exception) || undefined,
    };
}

export function buildMaterializedViewLineage(
    database: string,
    rows: MetadataRow[],
    refreshRows: MetadataRow[],
    notes: string[] = [],
    observedAt = new Date().toISOString(),
): LineageSnapshot {
    const sourceRows = rows.slice(0, LINEAGE_TABLE_LIMIT);
    const known = new Map(
        sourceRows.map(row => [
            tableReferenceId(metadataText(row.database), metadataText(row.name)),
            row,
        ]),
    );
    const refreshes = new Map(
        refreshRows.map(row => [
            tableReferenceId(metadataText(row.database), metadataText(row.view)),
            refreshState(row),
        ]),
    );
    const nodes = new Map<string, LineageNode>(),
        edges = new Map<string, LineageEdge>();
    let truncated = rows.length > LINEAGE_TABLE_LIMIT || refreshRows.length > LINEAGE_TABLE_LIMIT;
    const addNode = (reference: TableReference): string | undefined => {
        const id = tableReferenceId(reference.database, reference.table);
        if (nodes.has(id)) return id;
        if (nodes.size >= NODE_LIMIT) {
            truncated = true;
            return undefined;
        }
        const row = known.get(id),
            engine = metadataText(row?.engine),
            definition = metadataText(row?.create_table_query);
        const materialized = engine === 'MaterializedView';
        const parsed = materialized
            ? materializedViewDefinition(definition, reference.database)
            : undefined;
        const refresh = refreshes.get(id);
        nodes.set(id, {
            ...reference,
            id,
            engine: engine || 'Metadata outside this snapshot',
            kind: materialized ? 'materialized-view' : row ? 'table' : 'external',
            mode: refresh && parsed?.mode !== 'append-incremental' ? 'refreshable' : parsed?.mode,
            schedule: parsed?.schedule,
            definition: materialized ? definition : undefined,
            definitionTruncated: metadataFlag(row?.definition_truncated),
            refresh,
        });
        return id;
    };
    const addEdge = (from: TableReference, to: TableReference, kind: LineageEdge['kind']) => {
        if (edges.size >= EDGE_LIMIT) {
            truncated = true;
            return;
        }
        const source = addNode(from),
            target = addNode(to);
        if (!source || !target || source === target) return;
        edges.set(JSON.stringify([source, target, kind]), { source, target, kind });
    };
    for (const row of sourceRows) {
        const from = { database: metadataText(row.database), table: metadataText(row.name) };
        if (!from.table) continue;
        for (const to of pairedReferences(row, 'dependencies_database', 'dependencies_table'))
            addEdge(from, to, 'insert-trigger');
        if (metadataFlag(row.dependencies_truncated)) truncated = true;
        if (row.engine !== 'MaterializedView') continue;
        addNode(from);
        const parsed = materializedViewDefinition(
            metadataText(row.create_table_query),
            from.database,
        );
        const target = metadataText(row.target_table)
            ? {
                  database: metadataText(row.target_database) || from.database,
                  table: metadataText(row.target_table),
              }
            : parsed.target;
        if (target) addEdge(from, target, 'writes-to');
        for (const dependency of parsed.dependsOn) addEdge(dependency, from, 'refresh-dependency');
        for (const dependency of pairedReferences(
            row,
            'loading_dependencies_database',
            'loading_dependencies_table',
        )) {
            const sourceId = tableReferenceId(dependency.database, dependency.table),
                targetId = tableReferenceId(from.database, from.table);
            if (target && sourceId === tableReferenceId(target.database, target.table)) continue;
            if (
                parsed.dependsOn.some(
                    item =>
                        item.database === dependency.database && item.table === dependency.table,
                )
            )
                continue;
            if (edges.has(JSON.stringify([sourceId, targetId, 'insert-trigger']))) continue;
            addEdge(dependency, from, 'catalog-dependency');
        }
    }
    // A source may sort after its view: prefer the stronger insert-trigger relationship.
    for (const [key, edge] of edges)
        if (
            edge.kind === 'catalog-dependency' &&
            edges.has(JSON.stringify([edge.source, edge.target, 'insert-trigger']))
        )
            edges.delete(key);
    return {
        kind: 'lineage',
        database,
        observedAt,
        source: 'clickhouse',
        nodes: [...nodes.values()],
        edges: [...edges.values()],
        notes,
        truncated,
    };
}

/** Bounded topological layout; cycles stay visible in a final column instead of hanging. */
export function layoutLineage(nodes: readonly LineageNode[], edges: readonly LineageEdge[]) {
    const levels = new Map<string, number>(),
        indegree = new Map(nodes.map(node => [node.id, 0]));
    const outgoing = new Map<string, Set<string>>();
    for (const edge of edges) {
        if (!indegree.has(edge.source) || !indegree.has(edge.target)) continue;
        const targets = outgoing.get(edge.source) ?? new Set<string>();
        if (!targets.has(edge.target)) indegree.set(edge.target, indegree.get(edge.target)! + 1);
        targets.add(edge.target);
        outgoing.set(edge.source, targets);
    }
    const queue = nodes.filter(node => indegree.get(node.id) === 0).map(node => node.id);
    for (let index = 0; index < queue.length; index++) {
        const id = queue[index]!,
            level = levels.get(id) ?? 0;
        levels.set(id, level);
        for (const target of outgoing.get(id) ?? []) {
            levels.set(target, Math.max(levels.get(target) ?? 0, level + 1));
            indegree.set(target, indegree.get(target)! - 1);
            if (indegree.get(target) === 0) queue.push(target);
        }
    }
    const visited = new Set(queue),
        cycleLevel = Math.max(0, ...levels.values()) + 1;
    const counts = new Map<number, number>();
    const positioned = nodes.map(node => {
        const level = visited.has(node.id) ? (levels.get(node.id) ?? 0) : cycleLevel;
        const row = counts.get(level) ?? 0;
        counts.set(level, row + 1);
        return { ...node, x: 30 + level * 270, y: 35 + row * 108 };
    });
    return {
        nodes: positioned,
        width: Math.max(740, ...positioned.map(node => node.x + 260)),
        height: Math.max(330, ...positioned.map(node => node.y + 112)),
        hasCycle: visited.size !== nodes.length,
    };
}
