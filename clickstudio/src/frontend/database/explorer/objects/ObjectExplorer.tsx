import { Button, cx, Spinner } from '../../../common/components/ui';
import { Icon } from '../../../common/components/icons';
import { ObjectDetails } from './ObjectExplorerDetails';
import type { ObjectExplorerProps } from './tree/object-explorer-types';
import { useObjectExplorerState } from './tree/useObjectExplorerState';
import { ObjectExplorerActions } from './ObjectExplorerActions';
import { ObjectExplorerSearch } from './ObjectExplorerActions';
import { ObjectTree } from './tree/ObjectTree';
import { ObjectExplorerDialogs } from './ObjectExplorerDialogs';

export function ObjectExplorer(props: ObjectExplorerProps) {
    const {
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
    } = useObjectExplorerState(props);
    return (
        <section
            className={cx(
                'inspector-section object-explorer-section',
                compact && 'is-compact',
                showCompactDetails && 'is-detail-mode',
            )}
        >
            <ObjectExplorerActions
                {...{
                    selectedTable,
                    connection,
                    trusted,
                    copy,
                    setCreateTableOpen,
                    insertableTable,
                    setInsertRowTarget,
                    deletableTable,
                    setDeleteTableTarget,
                }}
            />
            {showCompactDetails && selected ? (
                <div className="object-compact-details">
                    <button type="button" className="object-back-button" onClick={browseObjects}>
                        <span>‹</span>
                        {copy.objects}
                    </button>
                    <ObjectDetails
                        copy={copy}
                        selection={selected}
                        trusted={trusted}
                        expert={expert}
                        copiedId={copiedId}
                        onInsert={onInsert}
                        onCopy={copyText}
                        onOpenSqlDraft={onOpenSqlDraft}
                        onOpenReference={onOpenReference}
                        onOpenParts={setPartsTable}
                    />
                </div>
            ) : (
                <>
                    <ObjectExplorerSearch {...{ search, changeSearch, copy }} />
                    <div
                        className={cx(
                            'schema-heading object-heading',
                            !expert && 'is-standard-object-heading',
                        )}
                    >
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
                        <span>
                            {copy.objectCount.replace(
                                '{count}',
                                (model.query
                                    ? model.visibleObjects
                                    : model.totalObjects
                                ).toLocaleString(),
                            )}
                        </span>
                        <Button
                            variant="ghost"
                            className={cx(
                                'toolbar-small',
                                'object-refresh-action',
                                schemaLoading && 'is-loading',
                            )}
                            aria-label={schemaLoading ? copy.loading : copy.refresh}
                            aria-busy={schemaLoading}
                            title={schemaLoading ? copy.loading : copy.refresh}
                            onClick={onRefreshSchema}
                            disabled={schemaLoading || !trusted}
                        >
                            <Icon name="refresh" />
                        </Button>
                    </div>
                    {schemaError && <div className="callout callout-error">{schemaError}</div>}
                    {schema?.metadataWarnings?.length ? (
                        <div className="schema-metadata-warning" role="note">
                            <span className="schema-metadata-warning-icon" aria-hidden="true">
                                i
                            </span>
                            <div className="schema-metadata-warning-content">
                                {schema.metadataWarnings.map(warning => (
                                    <p key={warning}>{warning}</p>
                                ))}
                            </div>
                        </div>
                    ) : null}
                    {!trusted && (
                        <div className="inspector-empty">
                            <Icon name="lock" />
                            <strong>{copy.schemaPrivate}</strong>
                            <p>{copy.trustToInspect}</p>
                        </div>
                    )}
                    {schemaLoading && (
                        <div className="inspector-empty">
                            <Spinner />
                            <p>{copy.readingSchema}</p>
                        </div>
                    )}
                    {trusted && schema && !schemaLoading && (
                        <>
                            {model.databases.length ? (
                                <ObjectTree
                                    {...{
                                        treeScroll,
                                        copy,
                                        model,
                                        expanded,
                                        toggle,
                                        renderRelation,
                                        selectedId,
                                        selectObject,
                                    }}
                                />
                            ) : (
                                <div className="object-empty-search">
                                    <strong>
                                        {model.query
                                            ? copy.noObjectsMatch
                                            : copy.noObjectsAvailable}
                                    </strong>
                                    <span>
                                        {model.query
                                            ? copy.noObjectsMatchHint
                                            : copy.noObjectsAvailableHint}
                                    </span>
                                </div>
                            )}
                            {schema.truncated && schema.pagination && (
                                <div className="schema-partial-state" role="status">
                                    <span>
                                        Showing part of this schema. Load the next page to see more
                                        tables and columns.
                                    </span>
                                    <Button
                                        variant="secondary"
                                        className="toolbar-small"
                                        disabled={schemaLoadingMore || !onLoadMoreSchema}
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
                                    onOpenReference={onOpenReference}
                                    onOpenParts={setPartsTable}
                                />
                            )}
                        </>
                    )}
                </>
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
                    createTableOpen,
                    setCreateTableOpen,
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
