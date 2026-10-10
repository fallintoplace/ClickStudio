import type { ProposalDecisionAction } from '../shared/assistant-types';
import { createPortal } from 'react-dom';
import { parameterNames } from '../shared/sql';
import { sqlReferencesQualifiedTable } from '../shared/table-deletion';
import type { Result, Run, Schema, SchemaTable } from '../shared/types';
import { api, download } from './api';
import { DetachedQueryPlaceholder } from './components/DetachedQueryPlaceholder';
import { ExportDialog } from './components/ExportDialog';
import { HelpButton } from './components/HelpButton';
import { ImportWizard } from './components/ImportWizard';
import { InspectorPane, type InspectorPaneProps } from './components/InspectorPane';
import { ObservabilityExplorer } from './components/ObservabilityExplorer';
import { OverlayPortal } from './components/OverlayPortal';
import { RestoreRevisionDialog } from './components/RestoreRevisionDialog';
import { RestoreSqlMenu } from './components/RestoreSqlMenu';
import { Button, cx, Icon, inspectorLabel, terminal } from './components/ui';
import { ExecutionBar, RailButton } from './components/WorkspaceChrome';
import { WorkspaceDocumentTabs } from './components/WorkspaceDocumentTabs';
import { WorkspaceHelpPanel } from './components/WorkspaceHelpPanel';
import { WorkspacePanelSplitter } from './components/WorkspacePanelSplitter';
import { WorkspaceQueryPanel } from './components/WorkspaceQueryPanel';
import { WorkspaceResultsPanel } from './components/WorkspaceResultsPanel';
import {
    EXPERT_BROWSE_NAVIGATION,
    EXPERT_EXECUTION_NAVIGATION,
    PRIMARY_INSPECTOR_NAVIGATION,
} from './inspector-navigation';
import { PLAYGROUND_CONNECTION_ID } from './playground';
import type { WorkspaceState } from './workspace-state';
import { closeDraft, MAX_TABS, newDraft, reopenDraft, type Draft } from './workspace-state';

import { WORKSPACE_TOAST_TIMEOUT_MS } from './useWorkspaceNotifications';
import {
    focusEditor,
    helpParseDuration,
    helpParseResult,
    helpQueryLogAvailable,
    helpStatementOffset,
    helpStatementSql,
    insertEditorText,
    revealEditorRange,
    safeStatementCount,
} from './workspace-helpers';

import { useWorkspaceController, type WorkspaceProps } from './useWorkspaceController';
import { createExampleDraft } from './useWorkspaceExecution';

async function loadAssistantRunContext(
    run: Run | undefined,
    snapshot: Result | undefined,
    signal: AbortSignal,
) {
    if (!run || !terminal(run))
        throw new Error('Wait for the latest run to finish before including it.');
    let result;

    if (run.resultState === 'reopenable') {
        if (snapshot?.runId === run.id) {
            result = snapshot;
        } else {
            result = await api<Result>(`/runs/${encodeURIComponent(run.id)}/snapshot`, { signal });
        }
    } else {
        result = undefined;
    }
    signal.throwIfAborted();
    return { result, evidenceSql: run.sql, error: run.error?.message };
}

function openImportedSqlQuery(
    name: string,
    sql: string,
    openDraft: (draft: Draft) => boolean,
    markImported: (id: string) => void,
    setNotice: (notice: string) => void,
) {
    const draft = newDraft(name, sql);
    const opened = openDraft(draft);
    if (opened) {
        markImported(draft.id);
        setNotice(`${name} opened in a new query tab. It has not been run.`);
    }
    return opened;
}

function workspaceAfterTableDeleted(
    state: WorkspaceState,
    table: Pick<SchemaTable, 'database' | 'name'>,
): WorkspaceState {
    return {
        ...state,
        tabs: state.tabs.map(draft =>
            draft.activeRunId && sqlReferencesQualifiedTable(draft.sql, table.database, table.name)
                ? {
                      ...draft,
                      invalidatedSource: {
                          database: table.database,
                          table: table.name,
                          runId: draft.activeRunId,
                      },
                  }
                : draft,
        ),
    };
}

export function Workspace({
    connection,
    connectionLabel,
    connections,
    onSelectConnection,
    onRefreshConnections,
    trustActionRef,
    testConnectionActionRef,
    demoMode,
    experience,
    nativeParserEnabled,
    dark,
    copy,
    locale,
}: WorkspaceProps) {
    const model = useWorkspaceController({
        connection,
        connectionLabel,
        connections,
        onSelectConnection,
        onRefreshConnections,
        trustActionRef,
        testConnectionActionRef,
        demoMode,
        experience,
        nativeParserEnabled,
        dark,
        copy,
        locale,
    });
    const { active } = model.tabs;

    const { schema, history } = model.data;
    const {
        run,
        page,
        setPage,
        resultPage,
        profile,
        pipeline,
        flamegraph,
        profilesByRun,
        pipelinesByRun,
    } = model.evidence;
    const {
        inspector,
        showInspector,
        editor,
        perform,
        loadProfile,
        loadPipeline,
        setView,
        trusted,
        nativeParserStatus,
        nativeParseSnapshot,
        execute,
        busy,
        unsupportedParameters,
        parameters,
        pendingExecution,
        cancelling,
        patch,
        saveDraft,
        formatActiveSql,
        cancel,
        runActionTitle,
        setNativeParserStatus,
        setNativeParseSnapshot,
        detachedEditor,
        panels,
        viewState,
        failedQueryError,
        script,
        setSelectedScriptResult,
        scriptFollowRef,
        update,
        loadFlamegraph,
    } = model;

    const inspectorProps = createInspectorProps({
        copy,
        connection,
        active,
        nativeParserEnabled,
        experience,
        model,
    });

    const queryPanel = (
        <WorkspaceQueryPanel
            state={{
                active,
                connection,
                schema,
                copy,
                experience,
                dark,
                nativeParserEnabled,
                nativeParserStatus,
                trusted,
                unsupportedParameters,
                parameters,
                busy,
                inspector,
                demoMode,
                executionPending: Boolean(pendingExecution.execution),
                cancelling,
            }}
            actions={{
                onPatch: patch,
                onOpenAssistant: () => showInspector('assistant'),
                onSave: saveDraft,
                onFormat: formatActiveSql,
                onRun: execute,
                onCancel: () => void cancel(),
                runActionTitle,
                onConnectionAction: () =>
                    !demoMode && !connection.manifest
                        ? testConnectionActionRef.current()
                        : trustActionRef.current(),
                onNativeParserStatus: setNativeParserStatus,
                onNativeParseSnapshot: setNativeParseSnapshot,
                onOpenDetached: detachedEditor.openEditor,
                onDockDetached: detachedEditor.dockEditor,
                onShowOutput: () => {
                    setView('results');
                    panels.revealPanelTemporarily('results', active.id);
                },
            }}
            panels={panels}
            viewState={viewState}
            editorRef={editor}
            detached={Boolean(detachedEditor.detached)}
        />
    );

    const resultsPanel = (
        <WorkspaceResultsPanel
            state={{
                active,
                connection,
                copy,
                locale,
                run,
                failedAttempt: failedQueryError,
                script,
                history,
                page,
                resultPage,
                profile,
                pipeline,
                flamegraph,
                profilesByRun,
                pipelinesByRun,
                nativeParserEnabled,
                nativeParserStatus,
                nativeParseSnapshot,
                trusted,
                busy,
                execution: pendingExecution.execution,
                assistantBusy: model.assistant.assistantBusy,
                retainedExecutionResult: pendingExecution.retainedExecutionResult,
                cancelling,
                experience,
            }}
            actions={{
                onSelectView: nextView => {
                    setView(nextView);
                    if (nextView === 'insights') void perform(loadProfile, 'save');
                },
                onFixWithAi: () => {
                    const { failureSql, failureError } = viewState;
                    if (!failureSql || !failureError) return;
                    showInspector('assistant');
                    void model.assistant.requestAssistantSql(
                        schema,
                        connection.id === PLAYGROUND_CONNECTION_ID
                            ? model.data.serverVersion
                            : connection.manifest?.serverVersion,
                        connection.database,
                        undefined,
                        {
                            repair: {
                                sql: failureSql,
                                error: [
                                    `[${failureError.code}] ${failureError.message}`,
                                    viewState.failureLocation
                                        ? `Line ${viewState.failureLocation.line}, column ${viewState.failureLocation.column}`
                                        : '',
                                ]
                                    .filter(Boolean)
                                    .join('\n')
                                    .slice(0, 3_000),
                            },
                            loadSchema: model.data.loadSchema,
                        },
                    );
                },
                onSelectScriptRun: runId => {
                    setSelectedScriptResult(active.id, `${active.scriptId}:${runId}`);
                    if (active.scriptId)
                        scriptFollowRef.current = { scriptId: active.scriptId, enabled: false };
                    update(active.id, draft => ({ ...draft, activeRunId: runId }));
                    setView('results');
                },
                onSelectScriptError: () => {
                    setSelectedScriptResult(active.id, '');
                    setView('results');
                },
                onCancel: () => void cancel(),
                onPage: setPage,
                onPatch: patch,
                onLoadProfile: () => void perform(loadProfile, 'save'),
                onLoadPipeline: () => void perform(loadPipeline, 'save'),
                onLoadFlamegraph: () => void perform(loadFlamegraph, 'save'),
                onRevealRange: (from, to) => {
                    panels.revealPanelTemporarily('query', active.id);
                    window.requestAnimationFrame(() => {
                        editor.current?.revealRange(from, to);
                        editor.current?.focus();
                    });
                },
            }}
            panels={panels}
            viewState={viewState}
        />
    );

    return renderWorkspaceLayout({
        experience,
        copy,
        connection,
        connectionLabel,
        locale,
        nativeParserEnabled,
        queryPanel,
        resultsPanel,
        inspectorProps,
        demoMode,
        model,
    });
}

function createInspectorProps({
    copy,
    connection,
    active,
    nativeParserEnabled,
    experience,
    model,
}: {
    copy: WorkspaceProps['copy'];
    connection: WorkspaceProps['connection'];
    active: Draft;
    nativeParserEnabled: WorkspaceProps['nativeParserEnabled'];
    experience: WorkspaceProps['experience'];
    model: ReturnType<typeof useWorkspaceController>;
}) {
    const {
        serverVersion: playgroundServerVersion,
        schema,
        schemaLoading,
        schemaLoadingMore,
        schemaError,
        documents,
        revisionsDocumentId,
        documentRevisions,
        revisionLoading,
        revisionError,
        documentsReadError,
        loadSchema,
        loadMoreSchema,
        loadHistory,
        loadDocuments,
        loadDocumentRevisions,
    } = model.data;
    const { run, profile, pipeline, profilesByRun, pipelinesByRun, snapshot } = model.evidence;
    const {
        assistantQuestion,
        changeAssistantQuestion,
        assistantChats,
        activeAssistantChatId,
        assistantTurns,
        assistantChatStorageError,
        newAssistantChat,
        setIncludeRun,
        selectAssistantChat,
        renameAssistantChat,
        deleteAssistantChat,
        assistantBusy,
        assistantCancelable,
        assistantPhase,
        assistantError,
        assistantNotice,
        requestAssistantSql,
        includeRun,
        cancelAssistantRequest,
        decideAssistantProposal,
    } = model.assistant;

    const {
        inspector,
        showInspector,
        search,
        setSearch,
        sortedHistory,
        savedDocument,
        saveStatus,
        importedReveal,
        editor,
        openSqlDraft,
        setWorkspace,
        openRun,
        openDocument,
        perform,
        loadProfile,
        loadPipeline,
        setView,
        trusted,
        restoreDocumentRevision,
        selectableRunId,
        nativeParserStatus,
        nativeParseSnapshot,
        execute,
        busy,
    } = model;

    return {
        copy: copy.common,
        inspector,
        setInspector: showInspector,
        connection,
        serverVersion:
            connection.id === PLAYGROUND_CONNECTION_ID
                ? playgroundServerVersion
                : connection.manifest?.serverVersion,
        schema,
        schemaLoading,
        schemaLoadingMore,
        schemaError,
        search,
        setSearch,
        history: sortedHistory,
        documents,
        revisions: revisionsDocumentId === active.serverId ? documentRevisions : [],
        revisionsDocumentId,
        revisionLoading,
        revisionError,
        currentRevision:
            revisionsDocumentId === active.serverId
                ? (documentRevisions[0]?.revision ?? savedDocument?.revision ?? active.baseRevision)
                : (savedDocument?.revision ?? active.baseRevision),
        unsavedDraft: saveStatus.state !== 'saved' && saveStatus.state !== 'checking',
        canRestoreRevision: Boolean(
            active.serverId &&
            revisionsDocumentId === active.serverId &&
            documentRevisions.length > 1 &&
            !revisionLoading &&
            !documentsReadError &&
            savedDocument &&
            !savedDocument.deletedAt,
        ),
        run,
        profile,
        pipeline,
        comparisonProfiles: profilesByRun,
        comparisonPipelines: pipelinesByRun,
        onRefreshSchema: () => void loadSchema(true),
        onLoadMoreSchema: () => void loadMoreSchema(),
        importedTableTarget: importedReveal.importedTableTarget,
        onImportedTableRevealed: importedReveal.onImportedTableRevealed,
        onRefreshHistory: () => void loadHistory(),
        onInsert: (value: string) => editor.current?.insert(value),
        onOpenSqlDraft: openSqlDraft,
        onTableDeleted: table =>
            setWorkspace(current => workspaceAfterTableDeleted(current, table)),
        onOpenRun: openRun,
        onOpenDocument: openDocument,
        onLoadProfile: () => void perform(loadProfile, 'save'),
        onLoadPipeline: () => void perform(loadPipeline, 'save'),
        onOpenGraph: () => {
            setView('insights');
        },
        connectionId: connection.id,
        sql: active.sql,
        trusted,
        onRefreshDocuments: () => void loadDocuments(),
        onRefreshRevisions: () => void loadDocumentRevisions(active.serverId),
        onRestoreRevision: restoreDocumentRevision,
        assistantQuestion,
        onAssistantQuestion: changeAssistantQuestion,
        assistantChats,
        activeAssistantChatId,
        assistantTurns,
        assistantChatStorageError,
        onNewAssistantChat: () => {
            newAssistantChat();
            if (selectableRunId) setIncludeRun(true);
        },
        onSelectAssistantChat: selectAssistantChat,
        onRenameAssistantChat: renameAssistantChat,
        onDeleteAssistantChat: deleteAssistantChat,
        assistantBusy,
        assistantCancelable,
        assistantPhase,
        assistantError,
        assistantNotice,
        nativeParserEnabled,
        nativeParserStatus,
        nativeParseSnapshot,
        onRetryParser: () => editor.current?.retryNativeParser(),
        onAskAI: (currentSchema?: Schema, serverVersion?: string, database?: string) =>
            void requestAssistantSql(
                currentSchema,
                serverVersion,
                database,
                includeRun ? signal => loadAssistantRunContext(run, snapshot, signal) : undefined,
            ),
        onCancelAssistantRequest: cancelAssistantRequest,
        onDecideProposal: (turnId: string, decision: ProposalDecisionAction) =>
            void decideAssistantProposal(turnId, decision),
        onRunQuery: sql => void execute('query', sql),
        runDisabled: sql => {
            if (!trusted || busy) return true;
            const statementCount = safeStatementCount(sql);
            if (
                statementCount !== undefined &&
                statementCount > 1 &&
                connection.manifest?.scripts.available !== true
            )
                return true;
            if (connection.manifest?.parameters.available !== false) return false;
            try {
                return parameterNames(sql).length > 0;
            } catch {
                return true;
            }
        },
        expert: experience === 'expert',
    } satisfies InspectorPaneProps;
}

function renderWorkspaceLayout({
    experience,
    copy,
    connection,
    connectionLabel,
    locale,
    nativeParserEnabled,
    queryPanel,
    resultsPanel,
    inspectorProps,
    demoMode,
    model,
}: {
    experience: WorkspaceProps['experience'];
    copy: WorkspaceProps['copy'];
    connection: WorkspaceProps['connection'];
    connectionLabel: WorkspaceProps['connectionLabel'];
    locale: WorkspaceProps['locale'];
    nativeParserEnabled: WorkspaceProps['nativeParserEnabled'];
    queryPanel: import('react').ReactElement;
    resultsPanel: import('react').ReactElement;
    inspectorProps: ReturnType<typeof createInspectorProps>;
    demoMode: WorkspaceProps['demoMode'];
    model: ReturnType<typeof useWorkspaceController>;
}) {
    const { active } = model.tabs;

    const { run, eventState } = model.evidence;
    let serverLabel = 'ClickHouse version unavailable';
    if (connection.dataSource === 'fixture') {
        serverLabel = 'Sample data';
    } else if (inspectorProps.serverVersion) {
        serverLabel = `ClickHouse ${inspectorProps.serverVersion}`;
    } else if (model.data.serverVersionLoading) {
        serverLabel = 'ClickHouse …';
    }

    const {
        inspectorDocked,
        error,
        setError,
        notice,
        setNotice,
        storageError,
        inspector,
        drawerOpen,
        showInspector,
        setImportOpen,
        setExportOpen,
        workspace,
        detachedEditor,
        helpPanelOpen,
        setObservabilityOpen,
        trusted,
        openNewDraft,
        startBlankSql,
        panels,
        outputVisible,
        failedQueryError,
        script,
        pendingExecution,
        visibleResultsView,
        emptySqlActionRef,
        setDrawerOpen,
        observabilityOpen,
        importOpen,
        importedReveal,
        exportOpen,
        exportCurrentQuery,
        exportCurrentCsv,
        restoreRevisionConfirmation,
        setRestoreRevisionConfirmation,
        restoreDocumentRevision,
        viewState,
        openHelp,
    } = model;

    return (
        <div
            className={cx(
                'workspace-root',
                experience === 'expert' && 'is-expert',
                experience === 'beginner' && 'is-beginner',
                inspectorDocked && 'has-inspector-dock',
            )}
        >
            <OverlayPortal>
                <div className="toast-stack">
                    {error && (
                        <div className="toast toast-error animate-enter" role="alert">
                            <span>!</span>
                            {error}
                            <button onClick={() => setError('')} aria-label="Dismiss error">
                                <Icon name="close" />
                            </button>
                            <div
                                key={error}
                                className="toast-timer"
                                style={{ animationDuration: `${WORKSPACE_TOAST_TIMEOUT_MS}ms` }}
                                aria-hidden="true"
                            />
                        </div>
                    )}
                    {notice && (
                        <div className="toast toast-success animate-enter" role="status">
                            <span>✓</span>
                            {notice}
                            <button onClick={() => setNotice('')} aria-label="Dismiss message">
                                <Icon name="close" />
                            </button>
                            <div
                                key={notice}
                                className="toast-timer"
                                style={{ animationDuration: `${WORKSPACE_TOAST_TIMEOUT_MS}ms` }}
                                aria-hidden="true"
                            />
                        </div>
                    )}
                    {storageError && (
                        <div className="toast toast-error" role="alert">
                            Local draft storage could not save changes: {storageError}
                        </div>
                    )}
                </div>
            </OverlayPortal>

            <div className="workspace-layout">
                <aside className="icon-rail" aria-label="Workspace tools">
                    <span className="rail-separator" />
                    {PRIMARY_INSPECTOR_NAVIGATION.map(item => (
                        <RailButton
                            key={item.id}
                            icon={item.icon}
                            label={copy.common[item.copyKey]}
                            active={inspector === item.id && drawerOpen}
                            accent={item.id === 'assistant'}
                            testId={
                                experience === 'expert' && item.id === 'assistant'
                                    ? 'open-ai'
                                    : undefined
                            }
                            onClick={() => showInspector(item.id)}
                        />
                    ))}
                    <span className="rail-spacer" />
                    <span className="rail-separator" />
                    <RailButton
                        icon="importFile"
                        label={copy.common.import}
                        onClick={() => setImportOpen(true)}
                    />
                    <RailButton
                        icon="exportFile"
                        label={copy.common.export}
                        onClick={() => setExportOpen(true)}
                    />
                    {experience === 'expert' && (
                        <div className="expert-rail-secondary">
                            <span className="rail-separator" />
                            {EXPERT_BROWSE_NAVIGATION.map(item => (
                                <RailButton
                                    key={item.id}
                                    icon={item.icon}
                                    label={
                                        item.copyKey
                                            ? copy.common[item.copyKey]
                                            : inspectorLabel(item.id)
                                    }
                                    active={inspector === item.id && drawerOpen}
                                    onClick={() => showInspector(item.id)}
                                />
                            ))}
                            <span className="rail-spacer" />
                            {EXPERT_EXECUTION_NAVIGATION.map(item => (
                                <RailButton
                                    key={item.id}
                                    icon={item.icon}
                                    label={inspectorLabel(item.id)}
                                    active={inspector === item.id && drawerOpen}
                                    onClick={() => showInspector(item.id)}
                                />
                            ))}
                            <span className="rail-separator" />
                            <button
                                className="rail-icon-button rail-icon-muted"
                                type="button"
                                title="Export local drafts"
                                onClick={() => download('clickstudio-local-drafts.json', workspace)}
                            >
                                <Icon name="settings" />
                            </button>
                        </div>
                    )}
                </aside>

                <main className="workspace-main">
                    {renderDocumentTabs({
                        experience,
                        connection,
                        copy,
                        connectionLabel,
                        locale,
                        nativeParserEnabled,
                        model,
                    })}
                    {workspace.tabs.length > 0 ? (
                        <div
                            ref={panels.workspaceContentRef}
                            id="sql-document-panel"
                            role="tabpanel"
                            aria-labelledby={`document-tab-${active.id}`}
                            tabIndex={0}
                            style={
                                detachedEditor.detached ? undefined : panels.workspaceLayoutStyle
                            }
                            className={cx(
                                'workspace-content',
                                Boolean(detachedEditor.detached) && 'has-detached-query',
                                experience === 'beginner' && 'beginner-workspace-content',
                                outputVisible &&
                                    Boolean(
                                        run ||
                                        failedQueryError ||
                                        script ||
                                        pendingExecution.execution,
                                    ) &&
                                    'has-run',
                                outputVisible && visibleResultsView === 'sqlmap' && 'has-sql-map',
                                panels.queryCollapsed &&
                                    !detachedEditor.detached &&
                                    'is-query-collapsed',
                                outputVisible && panels.resultsCollapsed && 'is-results-collapsed',
                                panels.canSplitPanels &&
                                    !detachedEditor.detached &&
                                    'has-panel-split',
                            )}
                        >
                            {detachedEditor.detached ? (
                                <DetachedQueryPlaceholder
                                    name={active.name}
                                    copy={copy.common}
                                    onFocus={detachedEditor.focusEditor}
                                    onDock={detachedEditor.dockEditor}
                                />
                            ) : (
                                queryPanel
                            )}

                            {outputVisible && !detachedEditor.detached && (
                                <WorkspacePanelSplitter panels={panels} />
                            )}

                            {outputVisible && resultsPanel}
                        </div>
                    ) : (
                        <section
                            className="empty-sql-workspace"
                            role="tabpanel"
                            aria-label={copy.common.noSqlTabsOpen}
                        >
                            <Icon name="documents" />
                            <h2>{copy.common.noSqlTabsOpen}</h2>
                            <p>{copy.common.noSqlTabsOpenDescription}</p>
                            <button
                                ref={emptySqlActionRef}
                                type="button"
                                className="button-base button-primary"
                                onClick={startBlankSql}
                            >
                                <Icon name="plus" />
                                {copy.common.startBlankSql}
                            </button>
                        </section>
                    )}
                </main>

                {inspectorDocked && (
                    <InspectorPane
                        {...inspectorProps}
                        docked
                        onClose={() => setDrawerOpen(false)}
                    />
                )}
            </div>
            {observabilityOpen && (
                <OverlayPortal>
                    <ObservabilityExplorer
                        connectionId={connection.id}
                        connectionLabel={connectionLabel}
                        trusted={trusted}
                        queryLog={connection.manifest?.queryLog}
                        replication={connection.manifest?.replication}
                        onClose={() => setObservabilityOpen(false)}
                    />
                </OverlayPortal>
            )}
            <ImportWizard
                open={importOpen}
                connectionId={connection.id}
                trusted={trusted}
                demoMode={demoMode}
                importCopy={copy.imports}
                onImportQuery={(name, sql) =>
                    openImportedSqlQuery(
                        name,
                        sql,
                        openNewDraft,
                        importedReveal.markImportedSqlDraft,
                        setNotice,
                    )
                }
                onClose={() => setImportOpen(false)}
                onImported={importedReveal.onImported}
                onTableNeedsInspection={importedReveal.onUnconfirmedDestination}
            />
            <ExportDialog
                open={exportOpen}
                queryAvailable={Boolean(active.sql.trim())}
                rowsAvailable={run?.resultState === 'reopenable'}
                onClose={() => setExportOpen(false)}
                onExportQuery={() => {
                    setExportOpen(false);
                    exportCurrentQuery();
                }}
                onExportRows={() => {
                    setExportOpen(false);
                    void exportCurrentCsv();
                }}
            />
            <RestoreRevisionDialog
                revision={restoreRevisionConfirmation?.revision}
                locale={locale}
                onClose={() => setRestoreRevisionConfirmation(undefined)}
                onConfirm={() => {
                    const revision = restoreRevisionConfirmation;
                    if (!revision) return;
                    setRestoreRevisionConfirmation(undefined);
                    restoreDocumentRevision(revision, true);
                }}
            />
            <ExecutionBar
                run={run}
                failedAttempt={Boolean(
                    failedQueryError ||
                    (viewState.failureError &&
                        run?.status !== 'failed' &&
                        !pendingExecution.execution),
                )}
                failureInToolbar={Boolean(viewState.failureError && !pendingExecution.execution)}
                eventState={eventState}
                onOpenDetails={() => showInspector('details')}
                scriptRunning={script?.status === 'running'}
                serverLabel={serverLabel}
                copy={copy.common}
                helpButton={
                    <HelpButton copy={copy.common} open={helpPanelOpen} onOpen={openHelp} />
                }
            />
            {detachedEditor.detached && createPortal(queryPanel, detachedEditor.detached.container)}
        </div>
    );
}

function renderDocumentTabs({
    experience,
    connection,
    copy,
    connectionLabel,
    locale,
    nativeParserEnabled,
    model,
}: {
    experience: WorkspaceProps['experience'];
    connection: WorkspaceProps['connection'];
    copy: WorkspaceProps['copy'];
    connectionLabel: WorkspaceProps['connectionLabel'];
    locale: WorkspaceProps['locale'];
    nativeParserEnabled: WorkspaceProps['nativeParserEnabled'];
    model: ReturnType<typeof useWorkspaceController>;
}) {
    const {
        active,
        tabScrollerRef,
        tabScrollState,
        updateTabScrollState,
        scrollTabs,
        renamingTabId,
        tabRenameValue,
        setTabRenameValue,
        beginTabRename,
        cancelTabRename,
    } = model.tabs;
    const {
        documents,
        documentsLoaded,
        documentsReadError,
        schema,
        schemaLoading,
        schemaError,
        loadSchema,
        history,
    } = model.data;
    const { run, profilesByRun, pipelinesByRun } = model.evidence;

    const {
        workspace,
        savingDraftIds,
        finishTabRename,
        setWorkspace,
        detachedEditor,
        clearFailedQueryError,
        helpPanelOpen,
        helpPanelSection,
        setHelpPanelSection,
        closeHelpPanel,
        setObservabilityOpen,
        showInspector,
        sqlExamples,
        trusted,
        sqlMapStatement,
        sqlMapParseStatement,
        nativeParserStatus,
        nativeParseSnapshot,
        queryTreeAvailable,
        queryTreeUnavailableReason,
        editor,
        busy,
        unsupportedParameters,
        execute,
        openNewDraft,
        runExample,
        startBlankSql,
        workspaceRef,
        setError,
        panels,
        inspector,
    } = model;

    return (
        <WorkspaceDocumentTabs
            workspace={workspace}
            experience={experience}
            activeId={active.id}
            connectionId={connection.id}
            documents={documents}
            documentsLoaded={documentsLoaded}
            documentsReadError={documentsReadError}
            savingDraftIds={savingDraftIds}
            tabScrollerRef={tabScrollerRef}
            tabScrollState={tabScrollState}
            updateTabScrollState={updateTabScrollState}
            scrollTabs={scrollTabs}
            renamingTabId={renamingTabId}
            tabRenameValue={tabRenameValue}
            setTabRenameValue={setTabRenameValue}
            beginTabRename={beginTabRename}
            finishTabRename={finishTabRename}
            cancelTabRename={cancelTabRename}
            onActivate={draftId => setWorkspace(current => ({ ...current, activeId: draftId }))}
            onClose={draftId => {
                if (workspace.tabs.length === 1) detachedEditor.closeEditor();
                setWorkspace(current => closeDraft(current, draftId));
                clearFailedQueryError(draftId);
            }}
            actions={
                <>
                    <button
                        className="new-tab-button"
                        data-testid="new-sql"
                        type="button"
                        aria-label={copy.common.newSql}
                        title={copy.common.newSql}
                        onClick={startBlankSql}
                    >
                        <Icon name="plus" />
                    </button>
                    <WorkspaceHelpPanel
                        open={helpPanelOpen}
                        section={helpPanelSection}
                        onSectionChange={setHelpPanelSection}
                        onClose={closeHelpPanel}
                        onOpenMonitoring={() => setObservabilityOpen(true)}
                        onOpenAssistant={() => showInspector('assistant')}
                        examples={sqlExamples}
                        sourceLabel={connectionLabel}
                        copy={copy.common}
                        experimentalLabel={copy.app.expert}
                        locale={locale}
                        connection={connection}
                        databases={schema?.databases ?? [connection.database]}
                        tables={schema?.tables ?? []}
                        schemaLoaded={schema !== undefined}
                        schemaLoading={schemaLoading}
                        schemaError={schemaError}
                        onRefreshSchema={() => void loadSchema(true)}
                        trusted={trusted}
                        queryEngine={{
                            copy: copy.common,
                            sql: helpStatementSql(sqlMapStatement, active.sql),
                            sourceOffset: helpStatementOffset(sqlMapStatement),
                            parseResult: helpParseResult(sqlMapParseStatement),
                            parserEnabled: nativeParserEnabled,
                            parserStatus: nativeParserStatus,
                            parseDurationMs: helpParseDuration(nativeParseSnapshot),
                            connectionId: connection.id,
                            parameters: active.parameters,
                            analyzerAvailable: queryTreeAvailable,
                            analyzerUnavailableReason: queryTreeUnavailableReason,
                            onRevealRange: (from, to) => {
                                closeHelpPanel(false);
                                window.requestAnimationFrame(() =>
                                    revealEditorRange(editor, from, to),
                                );
                            },
                        }}
                        busy={Boolean(busy)}
                        unsupportedParameters={unsupportedParameters}
                        onRunExplain={kind => void execute(kind)}
                        comparison={{
                            connectionId: connection.id,
                            trusted,
                            history,
                            initialRun: run,
                            profiles: profilesByRun,
                            pipelines: pipelinesByRun,
                            queryLogAvailable: helpQueryLogAvailable(connection),
                        }}
                        onReferenceInsert={value => {
                            insertEditorText(editor, value);
                            closeHelpPanel(false);
                            window.requestAnimationFrame(() => focusEditor(editor));
                        }}
                        onOpenExample={example => {
                            const draft = createExampleDraft(example, locale, copy.common);
                            if (!openNewDraft(draft, true)) return false;
                            window.requestAnimationFrame(() => editor.current?.focus());
                            return true;
                        }}
                        onRunExample={runExample}
                        onStartBlankSql={startBlankSql}
                    />
                    {!!workspace.closedTabs?.length && (
                        <RestoreSqlMenu
                            closedTabs={workspace.closedTabs}
                            copy={copy.common}
                            onRestore={draftId => {
                                if (workspaceRef.current.tabs.length >= MAX_TABS) {
                                    setError(
                                        `Close a tab before restoring one. This workspace supports ${MAX_TABS} open drafts.`,
                                    );
                                    return false;
                                }
                                const restored = reopenDraft(workspaceRef.current, draftId);
                                setWorkspace(restored);
                                if (restored.activeId)
                                    panels.revealPanelTemporarily('query', restored.activeId);
                                window.requestAnimationFrame(() => editor.current?.focus());
                                return true;
                            }}
                        />
                    )}
                    {experience === 'expert' && active.serverId && (
                        <Button
                            variant="ghost"
                            className="revision-history-trigger"
                            aria-label={`Version history for ${active.name}`}
                            aria-pressed={inspector === 'revisions'}
                            title="View saved versions"
                            onClick={() => showInspector('revisions')}
                        >
                            <Icon name="history" />
                            <span>Versions</span>
                        </Button>
                    )}
                </>
            }
        />
    );
}
