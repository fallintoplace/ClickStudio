import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Schema, SchemaColumn, SchemaDictionary, SchemaTable } from '../../shared/types';
import {
    buildObjectExplorer,
    explorerCategoryId,
    explorerColumnId,
    explorerColumnsId,
    explorerDictionaryId,
    explorerDatabaseId,
    explorerRelationId,
    explorerProjectionId,
    explorerProjectionsId,
    explorerSkipIndexId,
    explorerSkipIndexesId,
    type ExplorerCategoryKind,
    type ExplorerRelation,
} from '../../shared/object-explorer';
import { quoteIdentifier } from '../../shared/sql';
import type { Connected, ImportedTableTarget } from '../workspace-types';
import type { Copy } from '../i18n';
import { Button, cx, Icon } from './ui';
import { canDropTableTarget, isSystemDatabaseName } from '../../shared/table-deletion';
import { ObjectDetails } from './ObjectExplorerDetails';
import { OverlayPortal } from './OverlayPortal';
import { StorageExplorer } from './StorageExplorer';
import { MaterializedViewExplorer } from './MaterializedViewExplorer';
import { CreateTableDialog } from './CreateTableDialog';
import { InsertRowDialog } from './InsertRowDialog';
import { DeleteTableDialog } from './DeleteTableDialog';

type ObjectExplorerProps = {
    copy: Copy['common'];
    connection: Connected;
    schema?: Schema;
    schemaLoading: boolean;
    schemaLoadingMore?: boolean;
    schemaError: string;
    search: string;
    setSearch: (search: string) => void;
    trusted: boolean;
    onRefreshSchema: () => void;
    onLoadMoreSchema?: () => void;
    importedTableTarget?: ImportedTableTarget;
    onImportedTableRevealed: (target: ImportedTableTarget) => void;
    onInsert: (value: string) => void;
    onOpenSqlDraft: (name: string, sql: string, run: boolean) => void;
    onOpenReference: (name: string, type: string) => void;
    compact?: boolean;
};

type ExplorerUiState = {
    selectedId?: string;
    expandedIds: string[];
};

const uiStateKey = (connectionId: string) => `clickstudio:object-explorer:${connectionId}:v1`;

function recoverUiState(key: string): ExplorerUiState {
    try {
        const value = JSON.parse(window.localStorage.getItem(key) ?? 'null') as { selectedId?: unknown; expandedIds?: unknown } | null;
        return {
            selectedId: typeof value?.selectedId === 'string' ? value.selectedId : undefined,
            expandedIds: Array.isArray(value?.expandedIds) ? value.expandedIds.filter((id): id is string => typeof id === 'string').slice(0, 200) : [],
        };
    } catch {
        return { expandedIds: [] };
    }
}

export function ObjectExplorer({ copy, connection, schema, schemaLoading, schemaLoadingMore = false, schemaError, search, setSearch, trusted, onRefreshSchema, onLoadMoreSchema, importedTableTarget, onImportedTableRevealed, onInsert, onOpenSqlDraft, onOpenReference, compact = false }: ObjectExplorerProps) {
    const model = useMemo(() => buildObjectExplorer(schema, search, connection.database), [schema, search, connection.database]);
    const storageKey = uiStateKey(connection.id);
    const recovered = useMemo(() => recoverUiState(storageKey), [storageKey]);
    const [selectedId, setSelectedId] = useState<string | undefined>(() => recovered.selectedId);
    const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set(recovered.expandedIds));
    const [detailsOpen, setDetailsOpen] = useState(false);
    const [copiedId, setCopiedId] = useState<string>();
    const [lineageOpen, setLineageOpen] = useState(false);
    const [partsTable, setPartsTable] = useState<SchemaTable>();
    const [insertRowTarget, setInsertRowTarget] = useState<{ table: SchemaTable; columns: readonly SchemaColumn[] }>();
    const [deleteTableTarget, setDeleteTableTarget] = useState<SchemaTable>();
    const [createTableOpen, setCreateTableOpen] = useState(false);
    const [createdTableTarget, setCreatedTableTarget] = useState<{ database: string; table: string }>();
    const handledImportedTargetRef = useRef<string | undefined>(undefined);
    const highlightedRevealRef = useRef<string | undefined>(undefined);
    const treeScroll = useRef<HTMLDivElement>(null);
    const copyTimer = useRef<number | undefined>(undefined);
    const revealTimer = useRef<number | undefined>(undefined);
    const [highlightedTableId, setHighlightedTableId] = useState<string>();
    const importedSchemaTable = useMemo(() => importedTableTarget
        ? schema?.tables.find(table => `${table.database}.${table.name}` === importedTableTarget.table)
        : undefined, [importedTableTarget, schema?.tables]);
    const revealTarget = useMemo(() => createdTableTarget ?? (importedSchemaTable
        ? { database: importedSchemaTable.database, table: importedSchemaTable.name }
        : undefined), [createdTableTarget, importedSchemaTable]);

    useEffect(() => () => {
        if (copyTimer.current !== undefined) window.clearTimeout(copyTimer.current);
        if (revealTimer.current !== undefined) window.clearTimeout(revealTimer.current);
    }, []);

    useEffect(() => {
        try {
            window.localStorage.setItem(storageKey, JSON.stringify({ selectedId, expandedIds: [...expandedIds].slice(0, 200) }));
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
        setExpandedIds(current => new Set([...current, explorerDatabaseId(revealTarget.database), explorerCategoryId(revealTarget.database, 'table')]));
    }, [revealTarget, model.selectionById]);

    useEffect(() => {
        if (!revealTarget || search) return;
        const id = explorerRelationId(revealTarget.database, revealTarget.table);
        if (selectedId !== id || !expandedIds.has(explorerDatabaseId(revealTarget.database)) || !expandedIds.has(explorerCategoryId(revealTarget.database, 'table'))) return;
        const frame = window.requestAnimationFrame(() => {
            const rows = treeScroll.current?.querySelectorAll<HTMLElement>('[data-table-name]');
            const row = rows && [...rows].find(item => item.dataset.database === revealTarget.database && item.dataset.tableName === revealTarget.table);
            if (!row) return;
            row.scrollIntoView({ block: 'nearest' });
            const highlightId = importedTableTarget?.id ?? id;
            if (highlightedRevealRef.current !== highlightId) {
                highlightedRevealRef.current = highlightId;
                setHighlightedTableId(id);
                if (revealTimer.current !== undefined) window.clearTimeout(revealTimer.current);
                revealTimer.current = window.setTimeout(() => {
                    setHighlightedTableId(current => current === id ? undefined : current);
                    revealTimer.current = undefined;
                }, 2200);
            }
            if (createdTableTarget) setCreatedTableTarget(undefined);
            if (importedSchemaTable && importedTableTarget && handledImportedTargetRef.current !== importedTableTarget.id) {
                handledImportedTargetRef.current = importedTableTarget.id;
                onImportedTableRevealed(importedTableTarget);
            }
        });
        return () => window.cancelAnimationFrame(frame);
    }, [compact, createdTableTarget, detailsOpen, expandedIds, importedSchemaTable, importedTableTarget, onImportedTableRevealed, revealTarget, schemaLoading, search, selectedId]);

    useEffect(() => {
        if (search || expandedIds.size || !model.databases.length) return;
        const database = model.databases[0]!;
        const firstCategory: ExplorerCategoryKind | undefined = database.tables.length ? 'table' : database.views.length ? 'view' : database.dictionaries.length ? 'dictionary' : undefined;
        if (!firstCategory) return;
        setExpandedIds(new Set([database.id, explorerCategoryId(database.name, firstCategory)]));
    }, [expandedIds.size, model.databases, search]);

    const toggle = (id: string) => setExpandedIds(current => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
    });
    const expanded = (id: string, forced = false) => forced || expandedIds.has(id);
    const selected = selectedId ? model.selectionById.get(selectedId) : undefined;
    const selectedTable = selected?.kind === 'relation' && selected.relationKind === 'table' ? selected : undefined;
    const insertableTable = selectedTable && !isSystemDatabaseName(selectedTable.table.database) ? selectedTable : undefined;
    const deletableTable = selectedTable && canDropTableTarget(selectedTable.table.database, selectedTable.table.name) ? selectedTable.table : undefined;
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
            copyTimer.current = window.setTimeout(() => setCopiedId(current => current === id ? undefined : current), 1200);
        } catch {
            // Clipboard availability varies by browser and embedding context.
        }
    };

    const relationChildrenMatch = (relation: ExplorerRelation) =>
        relation.matchedColumns.length > 0 || relation.matchedProjections.length > 0 || relation.matchedSkipIndexes.length > 0;

    const renderRelation = (relation: ExplorerRelation, level: number) => {
        const relationExpanded = expanded(relation.id, Boolean(model.query && relationChildrenMatch(relation)));
        const columnGroupId = explorerColumnsId(relation.table.database, relation.table.name);
        const projectionGroupId = explorerProjectionsId(relation.table.database, relation.table.name);
        const indexGroupId = explorerSkipIndexesId(relation.table.database, relation.table.name);
        const columnsExpanded = expanded(columnGroupId, Boolean(model.query && relation.matchedColumns.length));
        const projectionsExpanded = expanded(projectionGroupId, Boolean(model.query && relation.matchedProjections.length));
        const indexesExpanded = expanded(indexGroupId, Boolean(model.query && relation.matchedSkipIndexes.length));
        const columns = model.query && relation.matchedColumns.length ? relation.matchedColumns : relation.columns;
        const projections = model.query && relation.matchedProjections.length ? relation.matchedProjections : relation.table.projections ?? [];
        const indexes = model.query && relation.matchedSkipIndexes.length ? relation.matchedSkipIndexes : relation.table.skipIndexes ?? [];
        const hasChildren = relation.columns.length > 0 || (relation.table.projections?.length ?? 0) > 0 || (relation.table.skipIndexes?.length ?? 0) > 0;

        return <div className="object-tree-branch" key={relation.id}>
            <div role="treeitem" aria-level={level} aria-expanded={hasChildren ? relationExpanded : undefined} aria-selected={selectedId === relation.id} data-database={relation.table.database} data-table-name={relation.table.name} className={cx('object-tree-row', 'is-object', selectedId === relation.id && 'is-selected', highlightedTableId === relation.id && 'is-import-highlight')} style={{ paddingLeft: `${Math.max(0, level - 1) * 10}px` }}>
                <button type="button" className="object-tree-toggle" aria-label={relationExpanded ? copy.collapse : copy.expand} disabled={!hasChildren} onClick={() => hasChildren && toggle(relation.id)}><span className={cx(relationExpanded && 'is-open')}>{hasChildren && <Icon name="chevron"/>}</span></button>
                <button type="button" className="object-tree-main" title={`${relation.table.database}.${relation.table.name}`} onClick={() => selectObject(relation.id)}>
                    <span className={cx('object-kind-glyph', relation.kind === 'view' && 'is-view')}><Icon name={relation.kind === 'view' ? 'view' : 'table'}/></span>
                    <span className="object-tree-label"><strong>{relation.table.name}</strong><small>{relation.table.engine}</small></span>
                </button>
                <button type="button" className="object-tree-inline-action" title={copy.insertTableName} aria-label={`${copy.insertTableName}: ${relation.table.name}`} onClick={() => onInsert(qualifiedTableName(relation.table))}><Icon name="plus"/></button>
            </div>
            {relationExpanded && hasChildren && <div role="group" className="object-tree-children">
                {relation.columns.length > 0 && <>
                    <ExplorerGroupRow level={level + 1} label={copy.columns} count={relation.columns.length} expanded={columnsExpanded} onToggle={() => toggle(columnGroupId)} kind="column" />
                    {columnsExpanded && <div role="group">{columns.map(column => {
                        const id = explorerColumnId(relation.table.database, relation.table.name, column.name);
                        return <ObjectLeafRow key={id} level={level + 2} selected={selectedId === id} glyph="column" label={column.name} meta={column.type} onSelect={() => selectObject(id)} onInsert={() => onInsert(quoteIdentifier(column.name))} insertLabel="Insert column name"/>;
                    })}</div>}
                </>}
                {(relation.table.projections?.length ?? 0) > 0 && <>
                    <ExplorerGroupRow level={level + 1} label={copy.projections} count={relation.table.projections!.length} expanded={projectionsExpanded} onToggle={() => toggle(projectionGroupId)} kind="projection" />
                    {projectionsExpanded && <div role="group">{projections.map(projection => {
                        const id = explorerProjectionId(relation.table.database, relation.table.name, projection.name);
                        return <ObjectLeafRow key={id} level={level + 2} selected={selectedId === id} glyph="projection" label={projection.name} meta={projection.type} onSelect={() => selectObject(id)}/>;
                    })}</div>}
                </>}
                {(relation.table.skipIndexes?.length ?? 0) > 0 && <>
                    <ExplorerGroupRow level={level + 1} label={copy.skipIndexes} count={relation.table.skipIndexes!.length} expanded={indexesExpanded} onToggle={() => toggle(indexGroupId)} kind="index" />
                    {indexesExpanded && <div role="group">{indexes.map(index => {
                        const id = explorerSkipIndexId(relation.table.database, relation.table.name, index.name);
                        return <ObjectLeafRow key={id} level={level + 2} selected={selectedId === id} glyph="index" label={index.name} meta={index.type} onSelect={() => selectObject(id)}/>;
                    })}</div>}
                </>}
            </div>}
        </div>;
    };

    const showCompactDetails = compact && detailsOpen && selected;

    return <section className={cx('inspector-section object-explorer-section', compact && 'is-compact', showCompactDetails && 'is-detail-mode')}>
        <div className="object-explorer-action-bar" role="group" aria-label={selectedTable ? `Actions for ${selectedTable.table.database}.${selectedTable.table.name}` : 'Table actions'}>
            {connection.dataSource !== 'fixture' && <Button variant="secondary" className="toolbar-small object-create-table-action" disabled={!trusted} title={!trusted ? copy.runActionTrustRequired : undefined} onClick={() => setCreateTableOpen(true)}><Icon name="table"/>{copy.newTable}</Button>}
            {connection.dataSource !== 'fixture' && insertableTable && <Button variant="secondary" className="toolbar-small" disabled={!trusted} title={!trusted ? copy.runActionTrustRequired : undefined} onClick={() => setInsertRowTarget({ table: insertableTable.table, columns: insertableTable.columns })}><Icon name="plus"/>{copy.insertRow}</Button>}
            {connection.dataSource !== 'fixture' && deletableTable && <Button variant="danger" className="toolbar-small object-delete-table-action" disabled={!trusted} title={!trusted ? copy.runActionTrustRequired : undefined} onClick={() => setDeleteTableTarget(deletableTable)}><Icon name="trash"/>{copy.deleteTable}</Button>}
            {selectedTable && <span className="object-action-context" title={`${selectedTable.table.database}.${selectedTable.table.name}`}><span>Selected</span><code>{selectedTable.table.database}.{selectedTable.table.name}</code></span>}
        </div>
        {showCompactDetails ? <div className="object-compact-details">
            <button type="button" className="object-back-button" onClick={browseObjects}><span>‹</span>{copy.objects}</button>
            <ObjectDetails copy={copy} selection={selected} trusted={trusted} copiedId={copiedId} onInsert={onInsert} onCopy={copyText} onOpenSqlDraft={onOpenSqlDraft} onOpenReference={onOpenReference} onOpenParts={setPartsTable}/>
        </div> : <>
        <div className="inspector-search object-search"><Icon name="search"/><input data-testid="schema-search" value={search} onChange={event => changeSearch(event.target.value)} placeholder={copy.objectSearch} aria-label={copy.objectSearch}/>{search && <button type="button" className="object-search-clear" aria-label="Clear object search" onClick={() => changeSearch('')}>×</button>}</div>
        <div className="schema-heading object-heading"><Button variant="ghost" className="toolbar-small" disabled={!trusted} onClick={() => setLineageOpen(true)}>View dependencies</Button><span>{copy.objectCount.replace('{count}', (model.query ? model.visibleObjects : model.totalObjects).toLocaleString())}</span><Button variant="ghost" className={cx('toolbar-small', 'object-refresh-action', schemaLoading && 'is-loading')} aria-label={schemaLoading ? copy.loading : copy.refresh} aria-busy={schemaLoading} title={schemaLoading ? copy.loading : copy.refresh} onClick={onRefreshSchema} disabled={schemaLoading || !trusted}><Icon name="refresh"/></Button></div>
        {schemaError && <div className="callout callout-error">{schemaError}</div>}
        {schema?.metadataWarnings?.map(warning => <div className="schema-metadata-warning" key={warning}>{warning}</div>)}
        {!trusted && <div className="inspector-empty"><Icon name="lock"/><strong>{copy.schemaPrivate}</strong><p>{copy.trustToInspect}</p></div>}
        {schemaLoading && <div className="inspector-empty"><span className="loading-orbit"/><p>{copy.readingSchema}</p></div>}
        {trusted && schema && !schemaLoading && <>
            {model.databases.length ? <div className="object-tree-scroll" ref={treeScroll}>
                <div className="object-tree" role="tree" aria-label={copy.objects}>
                    {model.databases.map(database => {
                        const databaseExpanded = expanded(database.id, Boolean(model.query));
                        return <div className="object-tree-branch" key={database.id}>
                            <ExplorerGroupRow level={1} label={database.name} count={database.visibleObjectCount} expanded={databaseExpanded} onToggle={() => toggle(database.id)} database />
                            {databaseExpanded && <div role="group" className="object-tree-children">
                                {database.tables.length > 0 && <ObjectCategory label={copy.tables} kind="table" database={database.name} relations={database.tables} level={2} query={model.query} expanded={expanded} toggle={toggle} renderRelation={renderRelation}/>}
                                {database.views.length > 0 && <ObjectCategory label={copy.views} kind="view" database={database.name} relations={database.views} level={2} query={model.query} expanded={expanded} toggle={toggle} renderRelation={renderRelation}/>}
                                {database.dictionaries.length > 0 && <DictionaryCategory label={copy.dictionaries} database={database.name} dictionaries={database.dictionaries} level={2} query={model.query} expanded={expanded} toggle={toggle} selectedId={selectedId} onSelect={selectObject}/>}
                            </div>}
                        </div>;
                    })}
                </div>
            </div> : <div className="object-empty-search"><strong>{copy.noObjectsMatch}</strong><span>{search ? 'Try a different name, type, engine, index, or column.' : copy.metadataUnavailable}</span></div>}
            {schema.truncated && schema.pagination && <div className="schema-partial-state" role="status"><span>Showing part of this schema. Load the next page to see more tables and columns.</span><Button variant="secondary" className="toolbar-small" disabled={schemaLoadingMore || !onLoadMoreSchema} onClick={onLoadMoreSchema}>{schemaLoadingMore ? 'Loading…' : 'Load more metadata'}</Button></div>}
            {!compact && detailsOpen && selected && <ObjectDetails copy={copy} selection={selected} trusted={trusted} copiedId={copiedId} onClose={browseObjects} onInsert={onInsert} onCopy={copyText} onOpenSqlDraft={onOpenSqlDraft} onOpenReference={onOpenReference} onOpenParts={setPartsTable}/>}
        </>}
        </>}
        {trusted && partsTable && <OverlayPortal><StorageExplorer connection={connection} table={partsTable} copy={copy} onClose={() => setPartsTable(undefined)}/></OverlayPortal>}
        {trusted && lineageOpen && <OverlayPortal><MaterializedViewExplorer connection={connection} database={connection.database} databases={schema?.databases} onClose={() => setLineageOpen(false)}/></OverlayPortal>}
        {trusted && createTableOpen && <OverlayPortal><CreateTableDialog connection={connection} databases={schema?.databases ?? []} onClose={() => setCreateTableOpen(false)} onCreated={target => { setSearch(''); setCreatedTableTarget(target); onRefreshSchema(); }}/></OverlayPortal>}
        {trusted && insertRowTarget && <OverlayPortal><InsertRowDialog key={`${insertRowTarget.table.database}.${insertRowTarget.table.name}`} connectionId={connection.id} table={insertRowTarget.table} columns={insertRowTarget.columns} onClose={() => setInsertRowTarget(undefined)} onInserted={onRefreshSchema}/></OverlayPortal>}
        {trusted && deleteTableTarget && <OverlayPortal><DeleteTableDialog connectionId={connection.id} table={deleteTableTarget} onClose={() => setDeleteTableTarget(undefined)} onDeleted={() => { setSelectedId(undefined); setDetailsOpen(false); onRefreshSchema(); }}/></OverlayPortal>}
    </section>;
}

function ObjectCategory({ label, kind, database, relations, level, query, expanded, toggle, renderRelation }: {
    label: string;
    kind: 'table' | 'view';
    database: string;
    relations: readonly ExplorerRelation[];
    level: number;
    query: string;
    expanded: (id: string, forced?: boolean) => boolean;
    toggle: (id: string) => void;
    renderRelation: (relation: ExplorerRelation, level: number) => ReactNode;
}) {
    const id = explorerCategoryId(database, kind);
    const open = expanded(id, Boolean(query));
    return <div className="object-tree-branch">
        <ExplorerGroupRow level={level} label={label} count={relations.length} expanded={open} onToggle={() => toggle(id)} kind={kind}/>
        {open && <div role="group">{relations.map(relation => renderRelation(relation, level + 1))}</div>}
    </div>;
}

function DictionaryCategory({ label, database, dictionaries, level, query, expanded, toggle, selectedId, onSelect }: {
    label: string;
    database: string;
    dictionaries: readonly SchemaDictionary[];
    level: number;
    query: string;
    expanded: (id: string, forced?: boolean) => boolean;
    toggle: (id: string) => void;
    selectedId?: string;
    onSelect: (id: string) => void;
}) {
    const id = explorerCategoryId(database, 'dictionary');
    const open = expanded(id, Boolean(query));
    return <div className="object-tree-branch">
        <ExplorerGroupRow level={level} label={label} count={dictionaries.length} expanded={open} onToggle={() => toggle(id)} kind="dictionary"/>
        {open && <div role="group">{dictionaries.map(dictionary => {
            const dictionaryId = explorerDictionaryId(dictionary.database, dictionary.name);
            return <ObjectLeafRow key={dictionaryId} level={level + 1} selected={selectedId === dictionaryId} glyph="dictionary" label={dictionary.name} meta={dictionary.type || dictionary.status} onSelect={() => onSelect(dictionaryId)}/>;
        })}</div>}
    </div>;
}

function ExplorerGroupRow({ level, label, count, expanded, onToggle, database = false, kind = 'table' }: { level: number; label: string; count: number; expanded: boolean; onToggle: () => void; database?: boolean; kind?: 'table' | 'view' | 'dictionary' | 'column' | 'projection' | 'index' }) {
    return <div role="treeitem" aria-level={level} aria-expanded={expanded} className={cx('object-tree-row', 'is-group', database && 'is-database')} style={{ paddingLeft: `${Math.max(0, level - 1) * 10}px` }}>
        <button type="button" className="object-tree-toggle" aria-label={expanded ? `Collapse ${label}` : `Expand ${label}`} onClick={onToggle}><span className={cx(expanded && 'is-open')}><Icon name="chevron"/></span></button>
        <button type="button" className="object-tree-main" title={label} onClick={onToggle}><span className={cx('object-kind-glyph', database && 'is-database')}><Icon name={database ? 'database' : kind}/></span><span className="object-tree-label"><strong>{label}</strong></span><small className="object-tree-count">{count.toLocaleString()}</small></button>
    </div>;
}

function ObjectLeafRow({ level, selected, glyph, label, meta, onSelect, onInsert, insertLabel }: { level: number; selected: boolean; glyph: 'column' | 'projection' | 'index' | 'dictionary'; label: string; meta?: string; onSelect: () => void; onInsert?: () => void; insertLabel?: string }) {
    return <div role="treeitem" aria-level={level} aria-selected={selected} className={cx('object-tree-row', 'is-object', 'is-leaf', selected && 'is-selected')} style={{ paddingLeft: `${Math.max(0, level - 1) * 10}px` }}>
        <span className="object-tree-toggle object-tree-spacer"/>
        <button type="button" className="object-tree-main" title={meta ? `${label} · ${meta}` : label} onClick={onSelect}><span className="object-kind-glyph"><Icon name={glyph}/></span><span className="object-tree-label"><strong>{label}</strong>{meta && <small>{meta}</small>}</span></button>
        {onInsert && <button type="button" className="object-tree-inline-action" title={insertLabel} aria-label={`${insertLabel}: ${label}`} onClick={onInsert}><Icon name="plus"/></button>}
    </div>;
}

function qualifiedTableName(table: SchemaTable) {
    return `${quoteIdentifier(table.database)}.${quoteIdentifier(table.name)}`;
}
