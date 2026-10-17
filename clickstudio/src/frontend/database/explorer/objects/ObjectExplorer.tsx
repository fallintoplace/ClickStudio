import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CLICKHOUSE_CLOUD_CONNECTION_ID } from '../../../../shared/database/connections/cloud-policy';
import { useSqlFunctions } from '../../functions/useSqlFunctions';
import { FunctionGroupsTree } from '../../functions/FunctionGroupsTree';
import { SqlFunctionDetails } from '../../functions/SqlFunctionDetails';
import { CreateSqlFunctionDialog } from '../../functions/CreateSqlFunctionDialog';
import { DeleteSqlFunctionDialog } from '../../functions/DeleteSqlFunctionDialog';
import { Button, cx } from '../../../ui/components/primitives';
import { Icon } from '../../../ui/components/icons';
import { ObjectDetails } from './ObjectExplorerDetails';
import type { ObjectExplorerProps } from './tree/object-explorer-types';
import { useObjectExplorerState } from './tree/useObjectExplorerState';
import { ObjectExplorerSearch } from './ObjectExplorerSearch';
import { ObjectTree } from './tree/ObjectTree';
import { ObjectExplorerDialogs } from './ObjectExplorerDialogs';
import { usePythonFunctions } from '../../functions/usePythonFunctions';
import { CreatePythonFunctionDialog } from '../../functions/CreatePythonFunctionDialog';
import { PythonFunctionDetails } from '../../functions/PythonFunctionDetails';
import { DeleteDatabaseDialog } from '../../databases/DeleteDatabaseDialog';
import { metadataConnectionKey } from '../../schema/metadata-state';
import { TableBrowseDialog } from './TableBrowseDialog';
import type { ExplorerSelection } from './object-explorer-model';

function ObjectExplorerEmptySearch({
    query,
    copy,
}: {
    query: string;
    copy: ObjectExplorerProps['copy'];
}) {
    return (
        <div className="object-empty-search">
            <strong>{query ? copy.noObjectsMatch : copy.noObjectsAvailable}</strong>
            <span>{query ? copy.noObjectsMatchHint : copy.noObjectsAvailableHint}</span>
        </div>
    );
}

function refreshObjectMetadata(...catalogs: { refresh: () => void }[]) {
    for (const catalog of catalogs) catalog.refresh();
}

export function ObjectExplorer(props: ObjectExplorerProps) {
    const state = useObjectExplorerState(props);
    const [browseTarget, setBrowseTarget] = useState<Extract<ExplorerSelection, { kind: 'relation' }>>();
    const [deleteDatabaseTarget, setDeleteDatabaseTarget] = useState<{
        database: string;
        connectionKey: string;
    }>();
    const connectionKey = metadataConnectionKey(props.connection);
    const currentConnectionKey = useRef(connectionKey);
    currentConnectionKey.current = connectionKey;
    useEffect(() => { setDeleteDatabaseTarget(undefined); setBrowseTarget(undefined); }, [connectionKey, props.trusted]);
    const [functionExpansion, setFunctionExpansion] = useState({
        functions: true,
        sql: true,
        python: true,
    });
    const {
        compact,
        showCompactDetails,
        selectedTable,
        tablePermissions,
        connection,
        trusted,
        copy,
        createTableDatabase,
        setCreateTableDatabase,
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
        onRefreshSchema,
        schema,
        selectObject,
        partsTable,
        lineageOpen,
        setLineageOpen,
        setSearch,
        setCreatedTableTarget,
        insertRowTarget,
        deleteTableTarget,
        onTableDeleted,
        setSelectedId,
        setDetailsOpen,
    } = state;
    const functionsEnabled = trusted && connection.id === CLICKHOUSE_CLOUD_CONNECTION_ID;
    const functions = useSqlFunctions(connection, functionsEnabled, props.functionCatalog);
    const python = usePythonFunctions(
        connection,
        !connection.readonly &&
            (connection.id !== CLICKHOUSE_CLOUD_CONNECTION_ID ||
                functions.catalog?.canCreate === true),
        props.pythonFunctionCatalog,
        functions.loading || Boolean(functions.error),
    );
    const functionDetails = functions.selected || python.selected;
    const deployPython =
        trusted && !connection.readonly && connection.id === CLICKHOUSE_CLOUD_CONNECTION_ID;
    const canDeleteFunction = functions.canDelete;
    const functionsSlot =
        functions.visible || python.visible ? (
            <FunctionGroupsTree
                sql={functions}
                python={python}
                search={search}
                expanded={functionExpansion}
                onToggle={group =>
                    setFunctionExpansion(current => ({ ...current, [group]: !current[group] }))
                }
                createReason={
                    connection.readonly
                        ? 'This connection is read only.'
                        : functions.catalog?.createReason || 'Checking CREATE FUNCTION privileges…'
                }
                onSelectSql={fn => {
                    python.close();
                    functions.select(fn);
                }}
                onSelectPython={fn => {
                    functions.close();
                    python.select(fn);
                }}
            />
        ) : undefined;
    const canInsertSelectedTable =
        connection.dataSource !== 'fixture' &&
        Boolean(insertableTable) &&
        tablePermissions.insert !== false;
    const canDeleteSelectedTable =
        connection.dataSource !== 'fixture' &&
        Boolean(deletableTable) &&
        tablePermissions.drop !== false;
    const tableActionDisabledReason = trusted ? undefined : copy.runActionTrustRequired;
    const compactTableActions =
        showCompactDetails &&
        selectedTable &&
        (canInsertSelectedTable || canDeleteSelectedTable) ? (
            <div className="object-utility-actions object-table-write-actions">
                {canInsertSelectedTable && (
                    <Button
                        variant="ghost"
                        className="toolbar-small"
                        disabled={!trusted}
                        title={tableActionDisabledReason}
                        onClick={() => {
                            if (insertableTable)
                                setInsertRowTarget({
                                    table: insertableTable.table,
                                    columns: insertableTable.columns,
                                });
                        }}
                    >
                        <Icon name="plus" />
                        {copy.insertRow}
                    </Button>
                )}
                {canDeleteSelectedTable && (
                    <Button
                        variant="danger"
                        className="toolbar-small"
                        disabled={!trusted}
                        title={tableActionDisabledReason}
                        onClick={() => {
                            if (deletableTable) setDeleteTableTarget(deletableTable);
                        }}
                    >
                        <Icon name="trash" />
                        {copy.deleteTable}
                    </Button>
                )}
            </div>
        ) : undefined;
    return (
        <section
            className={cx(
                'inspector-section object-explorer-section',
                compact && 'is-compact',
                (showCompactDetails || functionDetails) && 'is-detail-mode',
            )}
        >
            {python.selected ? (
                <div className="object-compact-details">
                    <button type="button" className="object-back-button" onClick={python.close}>
                        <Icon name="chevron" className="object-back-icon" />
                        {copy.objects}
                    </button>
                    <PythonFunctionDetails
                        key={`${python.key}:${python.selected.name}`}
                        fn={python.selected}
                        trusted={trusted}
                        deployAllowed={deployPython}
                        evidence={props.functionTest}
                        onRun={onOpenSqlDraft}
                        onCopy={(value, id) => void copyText(value, id)}
                        onRefresh={python.refresh}
                    />
                </div>
            ) : null}
            {!python.selected && functions.selected ? (
                <div className="object-compact-details">
                    <button type="button" className="object-back-button" onClick={functions.close}>
                        <Icon name="chevron" className="object-back-icon" />
                        {copy.objects}
                    </button>
                    <SqlFunctionDetails
                        key={functions.selected.name}
                        fn={functions.selected}
                        evidence={props.functionTest}
                        trusted={trusted}
                        canDelete={canDeleteFunction}
                        deleteReason={
                            connection.readonly
                                ? 'This connection is read only.'
                                : functions.catalog?.dropReason ||
                                  'Checking DROP FUNCTION privileges…'
                        }
                        onDelete={() => {
                            if (functions.selected) functions.openDelete(functions.selected);
                        }}
                        onRun={onOpenSqlDraft}
                        copiedId={copiedId}
                        onCopy={(sql, id) => void copyText(sql, id)}
                    />
                </div>
            ) : null}
            {!functionDetails && showCompactDetails && selected ? (
                <div className="object-compact-details">
                    <button type="button" className="object-back-button" onClick={browseObjects}>
                        <Icon name="chevron" className="object-back-icon" />
                        {copy.objects}
                    </button>
                    <ObjectDetails
                        copy={copy}
                        selection={selected}
                        tableActions={compactTableActions}
                        trusted={trusted}
                        expert={expert}
                        copiedId={copiedId}
                        onInsert={onInsert}
                        onCopy={copyText}
                        onOpenSqlDraft={onOpenSqlDraft}
                        onBrowseTable={setBrowseTarget}
                        canBrowse={connection.dataSource !== 'fixture'}
                        onOpenReference={onOpenReference}
                        onOpenParts={setPartsTable}
                        onSelect={selectObject}
                        search={search}
                    />
                </div>
            ) : null}
            {!functionDetails && !showCompactDetails && (
                <ObjectExplorerBrowser
                    state={state}
                    onBrowseTable={setBrowseTarget}
                    onDeleteDatabase={database =>
                        setDeleteDatabaseTarget({ database, connectionKey })
                    }
                    functionsSlot={functionsSlot}
                    functionsVisible={Boolean(functionsSlot)}
                    functionsLoading={functions.loading || python.loading}
                    refreshErrors={functionRefreshErrors(functions, python)}
                    onRefreshFunctions={() =>
                        refreshObjectMetadata(functions, python, props.tablePermissionCatalog)
                    }
                />
            )}
            {trusted && deleteDatabaseTarget?.connectionKey === connectionKey && (
                <DeleteDatabaseDialog
                    key={`${connectionKey}:${deleteDatabaseTarget.database}`}
                    connection={connection}
                    database={deleteDatabaseTarget.database}
                    onClose={() => setDeleteDatabaseTarget(undefined)}
                    onDeleted={database => {
                        props.onDatabaseDeleted(database);
                        if (currentConnectionKey.current !== connectionKey) return;
                        setDeleteDatabaseTarget(undefined);
                        setSelectedId(undefined);
                        setDetailsOpen(false);
                        setSearch('');
                        onRefreshSchema();
                    }}
                />
            )}
            {functions.createOpen && (
                <CreateSqlFunctionDialog
                    onClose={functions.closeCreate}
                    onCreated={functions.created}
                />
            )}
            {python.createOpen && (
                <CreatePythonFunctionDialog key={python.key} onClose={python.closeCreate} />
            )}
            {functions.deleteTarget && canDeleteFunction && (
                <DeleteSqlFunctionDialog
                    key={functions.deleteTarget.name}
                    name={functions.deleteTarget.name}
                    onClose={functions.closeDelete}
                    onDeleted={functions.deleted}
                />
            )}
            {trusted && browseTarget && (
                <TableBrowseDialog key={connectionKey + ':' + browseTarget.id}
                    table={browseTarget.table} columns={browseTarget.columns}
                    connection={connection} onClose={() => setBrowseTarget(undefined)}
                    onOpenSqlDraft={onOpenSqlDraft} />
            )}
            <ObjectExplorerDialogs
                {...{
                    copy,
                    trusted,
                    partsTable,
                    setPartsTable,
                    lineageOpen,
                    connection,
                    schema,
                    setLineageOpen,
                    createTableDatabase,
                    tablePermissions,
                    setCreateTableDatabase,
                    setSearch,
                    setCreatedTableTarget,
                    onRefreshSchema,
                    insertRowTarget,
                    setInsertRowTarget,
                    deleteTableTarget,
                    setDeleteTableTarget,
                    onTableDeleted,
                    setSelectedId,
                    setDetailsOpen,
                }}
            />
        </section>
    );
}

function functionRefreshErrors(
    functions: ReturnType<typeof useSqlFunctions>,
    python: ReturnType<typeof usePythonFunctions>,
) {
    return [
        functions.refreshError
            ? `SQL functions could not refresh. ${functions.catalog ? 'Showing previous data. ' : ''}${functions.refreshError}`
            : '',
        python.refreshError
            ? `Python functions could not refresh. ${python.available ? 'Showing previous data. ' : ''}${python.refreshError}`
            : '',
    ].filter(Boolean);
}

function ObjectExplorerBrowser({
    state,
    onBrowseTable,
    onDeleteDatabase,
    functionsSlot,
    functionsVisible,
    functionsLoading,
    refreshErrors,
    onRefreshFunctions,
}: {
    state: ReturnType<typeof useObjectExplorerState>;
    onBrowseTable: (selection: Extract<ExplorerSelection, { kind: 'relation' }>) => void;
    onDeleteDatabase: (database: string) => void;
    functionsSlot?: ReactNode;
    functionsVisible: boolean;
    functionsLoading: boolean;
    refreshErrors: string[];
    onRefreshFunctions: () => void;
}) {
    const {
        compact,
        trusted,
        copy,
        setCreateTableDatabase,
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
        tablePermissionCatalog,
    } = state;
    const busy = schemaLoading || functionsLoading;
    const refreshing = useRef(false);
    useEffect(() => {
        if (!busy) refreshing.current = false;
    }, [busy]);
    const refreshLabel = refreshing.current ? 'Refreshing objects' : 'Loading objects';
    return (
        <>
            <div className="object-search-row">
                <ObjectExplorerSearch
                    includeFunctions={Boolean(functionsSlot)}
                    {...{ search, changeSearch, copy }}
                />
                <div className="schema-heading object-heading">
                    {expert && (
                        <Button
                            variant="ghost"
                            className="toolbar-small"
                            disabled={!trusted}
                            onClick={() => setLineageOpen(true)}
                        >
                            View dependencies
                        </Button>
                    )}
                    <Button
                        variant="ghost"
                        className={cx(
                            'toolbar-small',
                            'object-refresh-action',
                            busy && 'is-loading',
                        )}
                        aria-label={busy ? refreshLabel : copy.refresh}
                        aria-busy={busy}
                        title={busy ? refreshLabel : copy.refresh}
                        onClick={() => {
                            if (refreshing.current || busy || schemaLoadingMore || !trusted) return;
                            refreshing.current = true;
                            onRefreshSchema();
                            onRefreshFunctions();
                        }}
                        disabled={busy || schemaLoadingMore || !trusted}
                    >
                        <Icon name="refresh" />
                    </Button>
                </div>
            </div>
            {schemaError && <div className="callout callout-error">{schemaError}</div>}
            {refreshErrors.map(error => (
                <div key={error} className="callout callout-error" role="status">
                    {error}
                </div>
            ))}
            {!trusted && (
                <div className="inspector-empty">
                    <Icon name="lock" />
                    <strong>{copy.schemaPrivate}</strong>
                    <p>{copy.trustToInspect}</p>
                </div>
            )}
            {trusted && (schema || functionsVisible) && (
                <>
                    {model.databases.length || functionsVisible ? (
                        <ObjectTree
                            {...{
                                functionsSlot,
                                treeScroll,
                                copy,
                                model,
                                expanded,
                                toggle,
                                renderRelation,
                                selectedId,
                                selectObject,
                                tablePermissionCatalog,
                                onCreateTable: setCreateTableDatabase,
                                onDeleteDatabase,
                            }}
                        />
                    ) : (
                        <ObjectExplorerEmptySearch query={model.query} copy={copy} />
                    )}
                    {schema?.truncated && schema.pagination && (
                        <div className="schema-partial-state" role="status">
                            <span>
                                Showing part of this schema. Load the next page to see more tables
                                and columns.
                            </span>
                            <Button
                                variant="secondary"
                                className="toolbar-small"
                                disabled={busy || schemaLoadingMore || !onLoadMoreSchema}
                                onClick={onLoadMoreSchema}
                            >
                                {schemaLoadingMore ? 'Loading…' : 'Load more metadata'}
                            </Button>
                        </div>
                    )}
                    {!compact && detailsOpen && selected && (
                        <ObjectDetails
                            copy={copy}
                            selection={selected}
                            trusted={trusted}
                            expert={expert}
                            copiedId={copiedId}
                            onClose={browseObjects}
                            onInsert={onInsert}
                            onCopy={copyText}
                            onOpenSqlDraft={onOpenSqlDraft}
                            onBrowseTable={onBrowseTable}
                            canBrowse={state.connection.dataSource !== 'fixture'}
                            onOpenReference={onOpenReference}
                            onOpenParts={setPartsTable}
                            onSelect={selectObject}
                            search={search}
                        />
                    )}
                </>
            )}
        </>
    );
}
