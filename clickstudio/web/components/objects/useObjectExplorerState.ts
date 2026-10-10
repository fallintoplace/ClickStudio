import { useEffect, useMemo, useRef, useState } from 'react';
import type { SchemaColumn, SchemaTable } from '../../../shared/types';
import {
    buildObjectExplorer,
    explorerCategoryId,
    explorerDatabaseId,
    explorerRelationId,
    type ExplorerCategoryKind,
    type ExplorerRelation,
} from '../../../shared/object-explorer';
import { canDropTableTarget, isSystemDatabaseName } from '../../../shared/table-deletion';
import type { ObjectExplorerProps } from './object-explorer-types';
import { createRelationRenderer } from './object-relation-renderer';

export type ObjectExplorerView = ReturnType<typeof useObjectExplorerState>;

type ExplorerUiState = {
    selectedId?: string;
    expandedIds: string[];
};
const uiStateKey = (connectionId: string) => `clickstudio:object-explorer:${connectionId}:v1`;
function recoverUiState(key: string): ExplorerUiState {
    try {
        const value = JSON.parse(window.localStorage.getItem(key) ?? 'null') as {
            selectedId?: unknown;
            expandedIds?: unknown;
        } | null;
        return {
            selectedId: typeof value?.selectedId === 'string' ? value.selectedId : undefined,
            expandedIds: Array.isArray(value?.expandedIds)
                ? value.expandedIds
                      .filter((id): id is string => typeof id === 'string')
                      .slice(0, 200)
                : [],
        };
    } catch {
        return { expandedIds: [] };
    }
}
export function useObjectExplorerState(props: ObjectExplorerProps) {
    const {
        copy,
        connection,
        expert,
        schema,
        schemaLoading,
        schemaLoadingMore = false,
        schemaError,
        search,
        setSearch,
        trusted,
        onRefreshSchema,
        onLoadMoreSchema,
        importedTableTarget,
        onImportedTableRevealed,
        onInsert,
        onOpenSqlDraft,
        onTableDeleted,
        onOpenReference,
        compact = false,
    } = props;

    const model = useMemo(
        () => buildObjectExplorer(schema, search, connection.database),
        [schema, search, connection.database],
    );
    const storageKey = uiStateKey(connection.id);
    const recovered = useMemo(() => recoverUiState(storageKey), [storageKey]);
    const [selectedId, setSelectedId] = useState<string | undefined>(() => recovered.selectedId);
    const [expandedIds, setExpandedIds] = useState<Set<string>>(
        () => new Set(recovered.expandedIds),
    );
    const [detailsOpen, setDetailsOpen] = useState(false);
    const [copiedId, setCopiedId] = useState<string>();
    const [lineageOpen, setLineageOpen] = useState(false);
    const [partsTable, setPartsTable] = useState<SchemaTable>();
    const [insertRowTarget, setInsertRowTarget] = useState<{
        table: SchemaTable;
        columns: readonly SchemaColumn[];
    }>();
    const [deleteTableTarget, setDeleteTableTarget] = useState<SchemaTable>();
    const [createTableOpen, setCreateTableOpen] = useState(false);
    const [createdTableTarget, setCreatedTableTarget] = useState<{
        database: string;
        table: string;
    }>();
    const handledImportedTargetRef = useRef<string | undefined>(undefined);
    const highlightedRevealRef = useRef<string | undefined>(undefined);
    const treeScroll = useRef<HTMLDivElement>(null);
    const copyTimer = useRef<number | undefined>(undefined);
    const revealTimer = useRef<number | undefined>(undefined);
    const [highlightedTableId, setHighlightedTableId] = useState<string>();
    const importedSchemaTable = useMemo(
        () =>
            importedTableTarget
                ? schema?.tables.find(
                      table => `${table.database}.${table.name}` === importedTableTarget.table,
                  )
                : undefined,
        [importedTableTarget, schema?.tables],
    );
    const revealTarget = useMemo(
        () =>
            createdTableTarget ??
            (importedSchemaTable
                ? { database: importedSchemaTable.database, table: importedSchemaTable.name }
                : undefined),
        [createdTableTarget, importedSchemaTable],
    );

    useEffect(
        () => () => {
            if (copyTimer.current !== undefined) window.clearTimeout(copyTimer.current);
            if (revealTimer.current !== undefined) window.clearTimeout(revealTimer.current);
        },
        [],
    );

    useEffect(() => {
        try {
            window.localStorage.setItem(
                storageKey,
                JSON.stringify({ selectedId, expandedIds: [...expandedIds].slice(0, 200) }),
            );
        } catch {
            // The explorer remains usable when local storage is unavailable.
        }
    }, [storageKey, selectedId, expandedIds]);

    useEffect(() => {
        if (!selectedId || model.selectionById.has(selectedId)) return;
        setSelectedId(undefined);
        setDetailsOpen(false);
    }, [model.selectionById, selectedId]);

    useEffect(() => {
        if (!revealTarget) return;
        const id = explorerRelationId(revealTarget.database, revealTarget.table);
        if (!model.selectionById.has(id)) return;
        setSelectedId(id);
        setDetailsOpen(true);
        setExpandedIds(
            current =>
                new Set([
                    ...current,
                    explorerDatabaseId(revealTarget.database),
                    explorerCategoryId(revealTarget.database, 'table'),
                ]),
        );
    }, [revealTarget, model.selectionById]);

    useEffect(() => {
        if (!revealTarget || search) return;
        const id = explorerRelationId(revealTarget.database, revealTarget.table);
        if (
            selectedId !== id ||
            !expandedIds.has(explorerDatabaseId(revealTarget.database)) ||
            !expandedIds.has(explorerCategoryId(revealTarget.database, 'table'))
        )
            return;
        const frame = window.requestAnimationFrame(() => {
            const rows = treeScroll.current?.querySelectorAll<HTMLElement>('[data-table-name]');
            const row =
                rows &&
                [...rows].find(
                    item =>
                        item.dataset.database === revealTarget.database &&
                        item.dataset.tableName === revealTarget.table,
                );
            if (!row) return;
            row.scrollIntoView({ block: 'nearest' });
            const highlightId = importedTableTarget?.id ?? id;
            if (highlightedRevealRef.current !== highlightId) {
                highlightedRevealRef.current = highlightId;
                setHighlightedTableId(id);
                if (revealTimer.current !== undefined) window.clearTimeout(revealTimer.current);
                revealTimer.current = window.setTimeout(() => {
                    setHighlightedTableId(current => (current === id ? undefined : current));
                    revealTimer.current = undefined;
                }, 2200);
            }
            if (createdTableTarget) setCreatedTableTarget(undefined);
            if (
                importedSchemaTable &&
                importedTableTarget &&
                handledImportedTargetRef.current !== importedTableTarget.id
            ) {
                handledImportedTargetRef.current = importedTableTarget.id;
                onImportedTableRevealed(importedTableTarget);
            }
        });
        return () => window.cancelAnimationFrame(frame);
    }, [
        compact,
        createdTableTarget,
        detailsOpen,
        expandedIds,
        importedSchemaTable,
        importedTableTarget,
        onImportedTableRevealed,
        revealTarget,
        schemaLoading,
        search,
        selectedId,
    ]);

    useEffect(() => {
        if (search || expandedIds.size || !model.databases.length) return;
        const database = model.databases[0]!;
        const firstCategory: ExplorerCategoryKind | undefined = database.tables.length
            ? 'table'
            : database.views.length
              ? 'view'
              : database.dictionaries.length
                ? 'dictionary'
                : undefined;
        if (!firstCategory) return;
        setExpandedIds(new Set([database.id, explorerCategoryId(database.name, firstCategory)]));
    }, [expandedIds.size, model.databases, search]);

    const toggle = (id: string) =>
        setExpandedIds(current => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    const expanded = (id: string, forced = false) => forced || expandedIds.has(id);
    const selected = selectedId ? model.selectionById.get(selectedId) : undefined;
    const selectedTable =
        selected?.kind === 'relation' && selected.relationKind === 'table' ? selected : undefined;
    const insertableTable =
        selectedTable && !isSystemDatabaseName(selectedTable.table.database)
            ? selectedTable
            : undefined;
    const deletableTable =
        selectedTable && canDropTableTarget(selectedTable.table.database, selectedTable.table.name)
            ? selectedTable.table
            : undefined;
    const selectObject = (id: string) => {
        setSelectedId(id);
        setDetailsOpen(true);
    };
    const browseObjects = () => setDetailsOpen(false);
    const changeSearch = (value: string) => {
        setDetailsOpen(false);
        setSearch(value);
    };

    const copyText = async (value: string, id: string) => {
        try {
            await navigator.clipboard.writeText(value);
            setCopiedId(id);
            if (copyTimer.current !== undefined) window.clearTimeout(copyTimer.current);
            copyTimer.current = window.setTimeout(
                () => setCopiedId(current => (current === id ? undefined : current)),
                1200,
            );
        } catch {
            // Clipboard availability varies by browser and embedding context.
        }
    };

    const relationChildrenMatch = (relation: ExplorerRelation) =>
        relation.matchedColumns.length > 0 ||
        relation.matchedProjections.length > 0 ||
        relation.matchedSkipIndexes.length > 0;

    const renderRelation = createRelationRenderer({
        expanded,
        model,
        relationChildrenMatch,
        selectedId,
        highlightedTableId,
        copy,
        toggle,
        selectObject,
        onInsert,
    });

    const showCompactDetails = compact && detailsOpen && selected;

    return {
        compact,
        showCompactDetails,
        selectedTable,
        connection,
        trusted,
        copy,
        setCreateTableOpen,
        insertableTable,
        setInsertRowTarget,
        deletableTable,
        setDeleteTableTarget,
        browseObjects,
        selected,
        expert,
        copiedId,
        onInsert,
        copyText,
        onOpenSqlDraft,
        onOpenReference,
        setPartsTable,
        search,
        changeSearch,
        setLineageOpen,
        model,
        schemaLoading,
        onRefreshSchema,
        schemaError,
        schema,
        treeScroll,
        expanded,
        toggle,
        renderRelation,
        selectedId,
        selectObject,
        schemaLoadingMore,
        onLoadMoreSchema,
        detailsOpen,
        partsTable,
        lineageOpen,
        createTableOpen,
        setSearch,
        setCreatedTableTarget,
        insertRowTarget,
        deleteTableTarget,
        onTableDeleted,
        setSelectedId,
        setDetailsOpen,
    };
}
