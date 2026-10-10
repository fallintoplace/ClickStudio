import { useRef, type RefObject } from 'react';
import type { RunKind, Schema } from '../../shared/types';
import type { NativeParseSnapshot, NativeParserStatus } from '../../shared/native-parser';
import type { SqlParameter } from '../../shared/sql';
import type { Copy, ExperienceLevel } from '../i18n';
import type {
    BusyAction,
    Connected,
    Inspector,
    WorkspaceFormatter,
    WorkspaceRunCapability,
    WorkspaceRunCapabilityAction,
} from '../workspace-types';
import type { Draft } from '../workspace-state';
import { safeStatementCount } from '../workspace-helpers';
import type { WorkspacePanelController } from '../useWorkspacePanels';
import type { WorkspaceViewState } from '../useWorkspaceViewState';
import { SqlEditor, type EditorHandle } from './SqlEditor';
import { Button, cx, Icon } from './ui';
import { RunActionGroup } from './WorkspaceChrome';
import { WorkspaceInlineNotice } from './WorkspaceInlineNotice';
import type { WorkspaceFeedback } from '../useWorkspaceNotifications';

export type WorkspaceQueryPanelState = Readonly<{
    active: Draft;
    connection: Connected;
    schema?: Schema;
    copy: Copy;
    experience: ExperienceLevel;
    dark: boolean;
    nativeParserEnabled: boolean;
    nativeParserStatus: NativeParserStatus;
    trusted: boolean;
    unsupportedParameters: boolean;
    parameters: readonly SqlParameter[];
    busy: BusyAction;
    inspector: Inspector;
    demoMode: boolean;
    executionPending: boolean;
    cancelling: boolean;
    draftFeedback?: WorkspaceFeedback;
}>;

export type WorkspaceQueryPanelActions = Readonly<{
    onPatch: (values: Partial<Draft>) => void;
    onOpenAssistant: () => void;
    onSave: (draft?: Draft) => Promise<void>;
    onFormat: (formatter: WorkspaceFormatter) => Promise<void>;
    onRun: (kind?: RunKind, sqlOverride?: string) => Promise<void>;
    onCancel: () => void;
    runActionTitle: (
        capability: WorkspaceRunCapability | undefined,
        action: WorkspaceRunCapabilityAction,
    ) => string | undefined;
    onConnectionAction: () => Promise<void>;
    onNativeParserStatus: (status: NativeParserStatus) => void;
    onNativeParseSnapshot: (snapshot?: NativeParseSnapshot) => void;
    onOpenDetached: () => void;
    onDockDetached: () => void;
    onShowOutput: () => void;
}>;

export function WorkspaceQueryPanel({
    state,
    actions,
    panels,
    viewState,
    editorRef,
    detached = false,
}: {
    state: WorkspaceQueryPanelState;
    actions: WorkspaceQueryPanelActions;
    panels: WorkspacePanelController;
    viewState: WorkspaceViewState;
    editorRef: RefObject<EditorHandle | null>;
    detached?: boolean;
}) {
    const {
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
        demoMode,
    } = state;
    const { statementCount, editorErrorContext, editorErrorRange } = viewState;
    const selectedSql =
        active.to > active.from ? active.sql.slice(active.from, active.to) : undefined;
    const queryNameAtFocus = useRef(active.name);
    const sqlToRun = selectedSql ?? active.sql;
    const statementsToRun = safeStatementCount(sqlToRun);
    const runRequiresScript = statementsToRun !== undefined && statementsToRun > 1;
    const runDisabled =
        !trusted ||
        Boolean(busy) ||
        unsupportedParameters ||
        (runRequiresScript && !connection.manifest?.scripts.available);
    const executionCanCancel = state.executionPending && busy !== 'run' && busy !== 'script';
    const cancelButtonActive = executionCanCancel || state.cancelling;
    const runTitle = runRequiresScript
        ? actions.runActionTitle(connection.manifest?.scripts, 'script')
        : undefined;
    const standardFormatter =
        nativeParserEnabled && nativeParserStatus === 'ready' ? 'wasm' : 'builtin';
    let runButtonLabel: string;

    if (state.cancelling) {
        runButtonLabel = 'Cancelling…';
    } else if (executionCanCancel) {
        runButtonLabel = copy.common.cancel;
    } else if (busy === 'run' || busy === 'script') {
        runButtonLabel = copy.common.running;
    } else {
        runButtonLabel = copy.common.run;
    }
    const runSql = () => actions.onRun('query');
    const runButton = (
        <Button
            variant={cancelButtonActive ? 'danger' : 'primary'}
            className="run-query-button compact-run-button"
            data-testid="run-button"
            aria-label={runButtonLabel}
            title={cancelButtonActive ? runButtonLabel : runTitle}
            onClick={() => (executionCanCancel ? actions.onCancel() : void runSql())}
            disabled={state.cancelling || (!executionCanCancel && runDisabled)}
        >
            <Icon name={cancelButtonActive ? 'stop' : 'play'} />
            {runButtonLabel}
        </Button>
    );
    const saveButton = (
        <Button
            variant="secondary"
            className="save-revision-button standard-save-button"
            data-testid="save-query"
            aria-label={copy.common.save}
            aria-keyshortcuts="Control+S Meta+S"
            title={`${copy.common.save} (Ctrl/Cmd+S)`}
            onClick={() => void actions.onSave(active)}
            disabled={Boolean(busy) || !active.name.trim()}
        >
            <Icon name="documents" />
            {copy.common.save}
        </Button>
    );
    const getTrustDescription = () => {
        if (demoMode) {
            return 'Start the sample workspace to run this query.';
        }

        if (!connection.manifest) {
            if (trusted) {
                return 'Retest this connection to refresh its feature checks.';
            }

            return 'Test this connection to discover its ClickHouse features.';
        }

        return 'Trust this connection to run SQL.';
    };
    const getTrustActionLabel = () => {
        if (demoMode) {
            return 'Start exploring';
        }

        if (!connection.manifest) {
            if (trusted) {
                return 'Retest connection';
            }

            return 'Test connection';
        }

        return 'Trust connection';
    };
    return (
        <section
            className={cx(
                'editor-surface',
                viewState.failureError && !state.executionPending && 'has-error-output',
                !detached && panels.queryCollapsed && 'is-collapsed',
            )}
        >
            {renderQueryHeading({
                viewState,
                state,
                actions,
                queryNameAtFocus,
                editorRef,
                standardFormatter,
                saveButton,
                runButton,
                detached,
                panels,
            })}
            <WorkspaceInlineNotice feedback={state.draftFeedback} />
            <div
                id="sql-editor-content"
                className="panel-content editor-content"
                hidden={!detached && panels.queryCollapsed}
            >
                <div className="editor-workspace-layout">
                    <div className="editor-main-column">
                        {experience === 'beginner' &&
                            (!trusted || (!demoMode && !connection.manifest)) && (
                                <div className="beginner-connection-notice" role="status">
                                    <span>{getTrustDescription()}</span>
                                    <Button
                                        variant="secondary"
                                        className="toolbar-small"
                                        onClick={() => void actions.onConnectionAction()}
                                    >
                                        {getTrustActionLabel()}
                                    </Button>
                                </div>
                            )}
                        <div className="editor-frame">
                            <SqlEditor
                                key={active.id}
                                ref={editorRef}
                                value={active.sql}
                                from={active.from}
                                to={active.to}
                                schema={trusted ? schema : undefined}
                                dark={dark}
                                nativeParserEnabled={nativeParserEnabled}
                                parserStatus={nativeParserStatus}
                                error={editorErrorContext?.error}
                                errorRange={editorErrorRange}
                                onChange={sql => actions.onPatch({ sql })}
                                onSelection={(from, to) => actions.onPatch({ from, to })}
                                onNativeParserStatus={actions.onNativeParserStatus}
                                onNativeParseSnapshot={actions.onNativeParseSnapshot}
                            />
                        </div>
                        {unsupportedParameters ? (
                            <div className="callout mt-3" role="status">
                                {connection.manifest?.parameters.reason ??
                                    'Query parameters are unavailable on this connection.'}{' '}
                                Replace placeholders with SQL literals to run this query.
                            </div>
                        ) : (
                            parameters.length > 0 && (
                                <div className="parameters-row">
                                    <div className="parameters-label">
                                        <span>INPUTS</span>
                                        <strong>Query parameters</strong>
                                        <small>
                                            Values are bound separately from the SQL text.
                                        </small>
                                    </div>
                                    {parameters.map(parameter => (
                                        <label className="parameter-field" key={parameter.name}>
                                            <span>
                                                {parameter.name}
                                                <code>:{parameter.type}</code>
                                            </span>
                                            <input
                                                value={active.parameters[parameter.name] ?? ''}
                                                placeholder="Enter value"
                                                onChange={event =>
                                                    actions.onPatch({
                                                        parameters: {
                                                            ...active.parameters,
                                                            [parameter.name]: event.target.value,
                                                        },
                                                    })
                                                }
                                            />
                                        </label>
                                    ))}
                                    <span className="parameter-count">
                                        {
                                            parameters.filter(parameter =>
                                                Boolean(active.parameters[parameter.name]?.trim()),
                                            ).length
                                        }{' '}
                                        / {parameters.length} ready
                                    </span>
                                </div>
                            )
                        )}
                    </div>
                    {experience === 'expert' && (
                        <aside className="editor-control-rail" aria-label={copy.common.runActions}>
                            <div className="editor-rail-status">
                                <div className="editor-mode-label">
                                    <span className="editor-language-dot" />
                                    {copy.common.clickhouseSql}
                                </div>
                                <span>
                                    {statementCount === undefined
                                        ? copy.common.incompleteSql
                                        : (statementCount === 1
                                              ? copy.common.oneStatement
                                              : copy.common.manyStatements
                                          ).replace('{count}', String(statementCount))}
                                </span>
                            </div>
                            <div className="editor-actions">
                                <RunActionGroup
                                    copy={copy.common}
                                    actions={[
                                        {
                                            id: 'explain',
                                            label: copy.common.explain,
                                            disabled:
                                                !trusted ||
                                                Boolean(busy) ||
                                                unsupportedParameters ||
                                                !connection.manifest?.explain.available,
                                            title: actions.runActionTitle(
                                                connection.manifest?.explain,
                                                'explain',
                                            ),
                                            onSelect: () => void actions.onRun('explain'),
                                        },
                                        {
                                            id: 'explain-plan',
                                            label: copy.common.explainPlan,
                                            disabled:
                                                !trusted ||
                                                Boolean(busy) ||
                                                unsupportedParameters ||
                                                !(
                                                    connection.manifest?.explainPlan ??
                                                    connection.manifest?.explain
                                                )?.available,
                                            title: actions.runActionTitle(
                                                connection.manifest?.explainPlan ??
                                                    connection.manifest?.explain,
                                                'explain-plan',
                                            ),
                                            onSelect: () => void actions.onRun('plan'),
                                        },
                                        {
                                            id: 'explain-pipeline',
                                            label: copy.common.explainPipeline,
                                            disabled:
                                                !trusted ||
                                                Boolean(busy) ||
                                                unsupportedParameters ||
                                                !(
                                                    connection.manifest?.explainPipeline ??
                                                    connection.manifest?.pipeline
                                                )?.available,
                                            title: actions.runActionTitle(
                                                connection.manifest?.explainPipeline ??
                                                    connection.manifest?.pipeline,
                                                'explain-pipeline',
                                            ),
                                            onSelect: () => void actions.onRun('pipeline'),
                                        },
                                        {
                                            id: 'explain-analyze',
                                            label: copy.common.explainAnalyze,
                                            disabled:
                                                !trusted ||
                                                Boolean(busy) ||
                                                unsupportedParameters ||
                                                !connection.manifest?.explainAnalyze?.available,
                                            title: actions.runActionTitle(
                                                connection.manifest?.explainAnalyze,
                                                'explain-analyze',
                                            ),
                                            onSelect: () => void actions.onRun('analyze'),
                                        },
                                    ]}
                                />
                            </div>
                        </aside>
                    )}
                </div>
            </div>
        </section>
    );
}

function renderQueryHeading({
    viewState,
    state,
    actions,
    queryNameAtFocus,
    editorRef,
    standardFormatter,
    saveButton,
    runButton,
    detached,
    panels,
}: {
    viewState: WorkspaceViewState;
    state: WorkspaceQueryPanelState;
    actions: WorkspaceQueryPanelActions;
    queryNameAtFocus: import('react').RefObject<string>;
    editorRef: RefObject<EditorHandle | null>;
    standardFormatter: 'wasm' | 'builtin';
    saveButton: import('react').ReactElement;
    runButton: import('react').ReactElement;
    detached: boolean;
    panels: WorkspacePanelController;
}) {
    const { copy, active, experience, inspector, nativeParserEnabled, nativeParserStatus } = state;

    return (
        <div className="editor-heading">
            <div className="editor-file-heading">
                <span className="file-type-icon">SQL</span>
                <div className="document-name">
                    {viewState.failureError && !state.executionPending ? (
                        <button
                            type="button"
                            className="query-failed-status"
                            onClick={actions.onShowOutput}
                            title={copy.common.showOutput}
                        >
                            <span className="status-light is-error" aria-hidden="true" />
                            {copy.common.lastExecutionFailed}
                        </button>
                    ) : (
                        <span className="eyebrow">{copy.common.query}</span>
                    )}
                    <input
                        aria-label="SQL document name"
                        value={active.name}
                        onFocus={() => {
                            queryNameAtFocus.current = active.name;
                        }}
                        onChange={event => actions.onPatch({ name: event.target.value })}
                        onBlur={event => {
                            const name = event.currentTarget.value.trim();
                            const savingButtonFocused =
                                event.relatedTarget instanceof HTMLElement &&
                                event.relatedTarget.closest('[data-testid="save-query"]');
                            const runButtonFocused =
                                event.relatedTarget instanceof HTMLElement &&
                                event.relatedTarget.closest(
                                    '[data-testid="run-button"], [data-testid^="run-action-"]',
                                );
                            if (name && name !== queryNameAtFocus.current) {
                                actions.onPatch({ name });
                                if (!savingButtonFocused && !runButtonFocused)
                                    void actions.onSave({ ...active, name });
                            }
                        }}
                        onKeyDown={event => {
                            if (event.key === 'Enter') {
                                event.preventDefault();
                                event.currentTarget.blur();
                            }
                        }}
                    />
                </div>
            </div>
            <div className="editor-heading-actions">
                {experience === 'beginner' && (
                    <Button
                        variant="ghost"
                        className="sql-ai-button"
                        data-testid="open-ai"
                        aria-label={copy.common.askAi}
                        aria-pressed={inspector === 'assistant'}
                        onClick={actions.onOpenAssistant}
                    >
                        <Icon name="assistant" />
                        {copy.common.askAi}
                    </Button>
                )}
                {experience === 'expert' &&
                    nativeParserEnabled &&
                    nativeParserStatus === 'unavailable' && (
                        <>
                            <span
                                className="toolbar-small"
                                role="status"
                                title="Formatting remains available while the native parser is unavailable."
                            >
                                {copy.common.parserUnavailable}
                            </span>
                            <Button
                                variant="ghost"
                                className="toolbar-small"
                                onClick={() => editorRef.current?.retryNativeParser()}
                            >
                                {copy.common.retryParser}
                            </Button>
                        </>
                    )}
                <Button
                    variant="ghost"
                    className="toolbar-small standard-format-button"
                    data-testid="format-sql"
                    aria-label={copy.common.formatSql}
                    title={copy.common.formatSql}
                    onClick={() => void actions.onFormat(standardFormatter)}
                >
                    {copy.common.format}
                </Button>
                {saveButton}
                {runButton}
                {detached ? (
                    <Button
                        variant="ghost"
                        className="panel-window-button"
                        aria-label={copy.common.dockQueryEditor}
                        title={copy.common.dockQueryEditor}
                        onClick={actions.onDockDetached}
                    >
                        <Icon name="dock" />
                    </Button>
                ) : (
                    !panels.compactViewport && (
                        <Button
                            variant="ghost"
                            className="panel-window-button"
                            aria-label={copy.common.openQueryInNewWindow}
                            title={copy.common.openQueryInNewWindow}
                            onClick={actions.onOpenDetached}
                        >
                            <Icon name="newWindow" />
                        </Button>
                    )
                )}
                {!detached && (
                    <Button
                        variant="ghost"
                        className="panel-collapse-button"
                        aria-label={
                            panels.queryCollapsed
                                ? copy.common.expandQuery
                                : copy.common.collapseQuery
                        }
                        aria-expanded={!panels.queryCollapsed}
                        aria-controls="sql-editor-content"
                        title={
                            panels.queryCollapsed
                                ? copy.common.expandQuery
                                : copy.common.collapseQuery
                        }
                        onClick={() => panels.setQueryCollapsed(value => !value)}
                    >
                        <Icon className="panel-toggle-icon" name="chevron" />
                    </Button>
                )}
            </div>
        </div>
    );
}
