import type { RefObject } from 'react';
import type { RunKind, Schema } from '../../shared/types';
import type { NativeParseSnapshot, NativeParserStatus } from '../../shared/native-parser';
import { hasSqlComments, type SqlParameter } from '../../shared/sql';
import type { Copy, ExperienceLevel } from '../i18n';
import type {
    BusyAction,
    Connected,
    Inspector,
    ResultsView,
    WorkspaceFormatter,
    WorkspaceRunCapability,
    WorkspaceRunCapabilityAction,
} from '../workspace-types';
import type { Draft } from '../workspace-state';
import { PanelResizeHandles, panelTargetIsInteractive, type WorkspacePanelController } from '../useWorkspacePanels';
import type { WorkspaceViewState } from '../useWorkspaceViewState';
import { SqlEditor, type EditorHandle } from './SqlEditor';
import { Button, cx, Icon } from './ui';
import { RunActionGroup } from './WorkspaceChrome';

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
    view: ResultsView;
}>;

export type WorkspaceQueryPanelActions = Readonly<{
    onPatch: (values: Partial<Draft>) => void;
    onToggleSqlMap: () => void;
    onOpenAssistant: () => void;
    onSave: () => Promise<void>;
    onFormat: (formatter: WorkspaceFormatter) => Promise<void>;
    onRun: (wholeScript?: boolean, kind?: RunKind) => Promise<void>;
    runActionTitle: (capability: WorkspaceRunCapability | undefined, action: WorkspaceRunCapabilityAction) => string | undefined;
    onConnectionAction: () => Promise<void>;
    onNativeParserStatus: (status: NativeParserStatus) => void;
    onNativeParseSnapshot: (snapshot?: NativeParseSnapshot) => void;
    onOpenDetached: () => void;
    onDockDetached: () => void;
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
        inspector,
        demoMode,
        view,
    } = state;
    const { statementCount, editorErrorContext, editorErrorRange } = viewState;
    const {
        queryPanelRef,
        queryMode,
        queryFloating,
        activeFloatingPanel,
        setActiveFloatingPanel,
        panelStyle,
        togglePanelFloating,
        togglePanelMaximized,
        startPanelDrag,
        startPanelResize,
    } = panels;
    return <section
        ref={queryPanelRef}
        className={cx('editor-surface', panels.queryCollapsed && 'is-collapsed', queryFloating && 'is-floating', queryMode === 'maximized' && 'is-maximized', activeFloatingPanel === 'query' && queryFloating && 'is-front')}
        style={panelStyle('query', queryMode)}
        onPointerDownCapture={() => { if (queryFloating) setActiveFloatingPanel('query'); }}
    >
        <div
            className={cx('editor-heading', queryFloating && 'workspace-panel-drag-handle')}
            onPointerDown={event => startPanelDrag('query', event)}
            onDoubleClick={event => {
                if (queryFloating && !panelTargetIsInteractive(event.target)) togglePanelMaximized('query');
            }}
        >
            <div className="editor-file-heading"><span className="file-type-icon">SQL</span><label className="document-name"><span className="eyebrow">{copy.common.query}</span><input aria-label="SQL document name" value={active.name} onChange={event => actions.onPatch({ name: event.target.value })}/></label></div>
            {experience === 'expert' && <div className="editor-heading-tools">
                <Button variant="ghost" className="sql-map-button" aria-label={copy.common.visualizeSqlStructure} aria-pressed={view === 'sqlmap'} title={copy.common.visualizeSqlStructure} onClick={actions.onToggleSqlMap}><Icon name="pipeline"/>{copy.common.sqlMap}</Button>
                <Button variant="ghost" className="sql-ai-button" data-testid="open-ai" aria-label={copy.common.askAi} aria-pressed={inspector === 'assistant'} onClick={actions.onOpenAssistant}><Icon name="assistant"/>{copy.common.askAi}</Button>
                <Button variant="secondary" className="save-revision-button" data-testid="save-query" aria-label={copy.common.saveRevision} onClick={() => void actions.onSave()} disabled={Boolean(busy)}><Icon name="documents"/>{copy.common.save}</Button>
            </div>}
            <div className="editor-heading-actions">
                {experience === 'beginner' && <Button variant="primary" className="run-query-button compact-run-button" data-testid="run-statement" aria-label={copy.common.runStatement} onClick={() => void actions.onRun()} disabled={!trusted || Boolean(busy) || unsupportedParameters}><Icon name="play"/>{busy === 'run' || busy === 'script' ? copy.common.running : copy.common.run}</Button>}
                {experience === 'expert' && <>
                    {nativeParserEnabled && nativeParserStatus === 'unavailable' && <>
                        <span className="toolbar-small" role="status" title="Formatting remains available while the native parser is unavailable.">{copy.common.parserUnavailable}</span>
                        <Button variant="ghost" className="toolbar-small" onClick={() => editorRef.current?.retryNativeParser()}>{copy.common.retryParser}</Button>
                    </>}
                    <div className="formatter-control" role="group" aria-label={copy.common.formatSql}>
                        <span className="formatter-control-label">{copy.common.format}</span>
                        <Button
                            variant="ghost"
                            className="toolbar-small formatter-choice formatter-choice-wasm"
                            disabled={!nativeParserEnabled || nativeParserStatus !== 'ready'}
                            title={!nativeParserEnabled
                                ? 'Select WASM in the parser switch to enable this formatter.'
                                : nativeParserStatus === 'loading'
                                    ? 'The WASM parser is loading.'
                                    : nativeParserStatus === 'unavailable'
                                        ? 'The WASM parser is unavailable. Retry the parser to enable this formatter.'
                                        : hasSqlComments(active.sql)
                                            ? 'Formats with WASM when supported; SQL with comments falls back to Built-in Format to preserve them.'
                                            : 'Format SQL with the native ClickHouse WASM parser.'}
                            onClick={() => void actions.onFormat('wasm')}
                        >WASM</Button>
                        <Button
                            variant="ghost"
                            className="toolbar-small formatter-choice formatter-choice-builtin"
                            title="Format SQL with ClickStudio’s built-in formatter."
                            onClick={() => void actions.onFormat('builtin')}
                        >{copy.common.builtInFormatter}</Button>
                    </div>
                </>}
                {!detached && !panels.compactViewport && <Button variant="ghost" className="panel-window-button" aria-label={queryFloating ? 'Dock query panel' : 'Pop out query panel'} title={queryFloating ? 'Dock query panel' : 'Pop out query panel'} onClick={() => togglePanelFloating('query')}><Icon name={queryFloating ? 'dock' : 'popout'}/></Button>}
                {detached
                    ? <Button variant="ghost" className="panel-window-button" aria-label={copy.common.dockQueryEditor} title={copy.common.dockQueryEditor} onClick={actions.onDockDetached}><Icon name="dock"/></Button>
                    : !panels.compactViewport && <Button variant="ghost" className="panel-window-button" aria-label={copy.common.openQueryInNewWindow} title={copy.common.openQueryInNewWindow} onClick={actions.onOpenDetached}><Icon name="newWindow"/></Button>}
                {queryFloating && <Button variant="ghost" className="panel-window-button" aria-label={queryMode === 'maximized' ? 'Restore query panel' : 'Maximize query panel'} title={queryMode === 'maximized' ? 'Restore query panel' : 'Maximize query panel'} onClick={() => togglePanelMaximized('query')}><Icon name={queryMode === 'maximized' ? 'restore' : 'maximize'}/></Button>}
                <Button variant="ghost" className="panel-collapse-button" aria-label={panels.queryCollapsed ? copy.common.expandQuery : copy.common.collapseQuery} aria-expanded={!panels.queryCollapsed} aria-controls="sql-editor-content" title={panels.queryCollapsed ? copy.common.expandQuery : copy.common.collapseQuery} onClick={() => panels.setQueryCollapsed(value => !value)}><Icon className="panel-toggle-icon" name="chevron"/></Button>
            </div>
        </div>
        <div id="sql-editor-content" className="panel-content editor-content" hidden={panels.queryCollapsed}>
            <div className="editor-workspace-layout">
                <div className="editor-main-column">
                    {experience === 'beginner' && (!trusted || (!demoMode && !connection.manifest)) && <div className="beginner-connection-notice" role="status"><span>{demoMode ? 'Start the sample workspace to run this query.' : !connection.manifest ? trusted ? 'Retest this connection to refresh its feature checks.' : 'Test this connection to discover its ClickHouse features.' : 'Trust this connection to run SQL.'}</span><Button variant="secondary" className="toolbar-small" onClick={() => void actions.onConnectionAction()}>{demoMode ? 'Start exploring' : !connection.manifest ? trusted ? 'Retest connection' : 'Test connection' : 'Trust connection'}</Button></div>}
                    <div className="editor-frame"><SqlEditor key={active.id} ref={editorRef} value={active.sql} from={active.from} to={active.to} schema={trusted ? schema : undefined} dark={dark} nativeParserEnabled={nativeParserEnabled} parserStatus={nativeParserStatus} error={editorErrorContext?.error} errorRange={editorErrorRange} onChange={sql => actions.onPatch({ sql })} onSelection={(from, to) => actions.onPatch({ from, to })} onRun={wholeScript => void actions.onRun(wholeScript)} onNativeParserStatus={actions.onNativeParserStatus} onNativeParseSnapshot={actions.onNativeParseSnapshot}/></div>
                    {unsupportedParameters
                        ? <div className="callout mt-3" role="status">{connection.manifest?.parameters.reason ?? 'Query parameters are unavailable on this connection.'} Replace placeholders with SQL literals to run this query.</div>
                        : parameters.length > 0 && <div className="parameters-row"><div className="parameters-label"><span>INPUTS</span><strong>Query parameters</strong><small>Values are bound separately from the SQL text.</small></div>{parameters.map(parameter => <label className="parameter-field" key={parameter.name}><span>{parameter.name}<code>:{parameter.type}</code></span><input value={active.parameters[parameter.name] ?? ''} placeholder="Enter value" onChange={event => actions.onPatch({ parameters: { ...active.parameters, [parameter.name]: event.target.value } })}/></label>)}<span className="parameter-count">{parameters.filter(parameter => Boolean(active.parameters[parameter.name]?.trim())).length} / {parameters.length} ready</span></div>}
                    {experience === 'expert' && <div className="editor-footer"><span>{active.sql.length.toLocaleString()} {copy.common.characters} <span className="footer-dot">·</span> {active.sql.split('\n').length} {copy.common.lines}</span></div>}
                </div>
                {experience === 'expert' && <aside className="editor-control-rail" aria-label={copy.common.runActions}>
                    <div className="editor-rail-status"><div className="editor-mode-label"><span className="editor-language-dot"/>{copy.common.clickhouseSql}</div><span>{statementCount === undefined ? copy.common.incompleteSql : (statementCount === 1 ? copy.common.oneStatement : copy.common.manyStatements).replace('{count}', String(statementCount))}</span></div>
                    <div className="editor-actions">
                        <RunActionGroup copy={copy.common} runLabel={copy.common.runStatement} running={busy === 'run' || busy === 'script'} disabled={!trusted || Boolean(busy) || unsupportedParameters} onRun={() => void actions.onRun()} actions={[
                            { id: 'script', label: copy.common.runScript, disabled: !trusted || Boolean(busy) || unsupportedParameters || !connection.manifest?.scripts.available, title: actions.runActionTitle(connection.manifest?.scripts, 'script'), onSelect: () => void actions.onRun(true) },
                            { id: 'explain', label: copy.common.explain, disabled: !trusted || Boolean(busy) || unsupportedParameters || !connection.manifest?.explain.available, title: actions.runActionTitle(connection.manifest?.explain, 'explain'), onSelect: () => void actions.onRun(false, 'explain') },
                            { id: 'explain-plan', label: copy.common.explainPlan, disabled: !trusted || Boolean(busy) || unsupportedParameters || !(connection.manifest?.explainPlan ?? connection.manifest?.explain)?.available, title: actions.runActionTitle(connection.manifest?.explainPlan ?? connection.manifest?.explain, 'explain-plan'), onSelect: () => void actions.onRun(false, 'plan') },
                            { id: 'explain-pipeline', label: copy.common.explainPipeline, disabled: !trusted || Boolean(busy) || unsupportedParameters || !(connection.manifest?.explainPipeline ?? connection.manifest?.pipeline)?.available, title: actions.runActionTitle(connection.manifest?.explainPipeline ?? connection.manifest?.pipeline, 'explain-pipeline'), onSelect: () => void actions.onRun(false, 'pipeline') },
                            { id: 'explain-analyze', label: copy.common.explainAnalyze, disabled: !trusted || Boolean(busy) || unsupportedParameters || !connection.manifest?.explainAnalyze?.available, title: actions.runActionTitle(connection.manifest?.explainAnalyze, 'explain-analyze'), onSelect: () => void actions.onRun(false, 'analyze') },
                        ]}/>
                    </div>
                </aside>}
            </div>
        </div>
        {queryMode === 'floating' && !panels.queryCollapsed && <PanelResizeHandles onResize={(edge, event) => startPanelResize('query', edge, event)}/>}
    </section>;
}
