import { RunComparisonLauncher } from './RunComparison';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { ProfilePipeline, Proposal, QueryDocument, QueryProfile, Run, Schema } from '../../shared/types';
import type { AssistantChat, AssistantChatTurn } from '../assistant-chat-state';
import { AssistantWorkflow } from './AssistantWorkflow';
import { Button, cx, formatBytes, Icon, inspectorLabel, Status } from './ui';
import type { IconName } from './ui';
import type { Connected, Inspector } from '../workspace-types';
import type { NativeParseSnapshot, NativeParserStatus } from '../../shared/native-parser';
import { NativeParserInspector } from './NativeParserInspector';
import { ObjectExplorer } from './ObjectExplorer';
import { ReferenceExplorer } from './ReferenceExplorer';
import type { Copy } from '../i18n';

export type InspectorPaneProps = {
    copy: Copy['common'];
    inspector: Inspector;
    setInspector: (inspector: Inspector) => void;
    connection: Connected;
    schema?: Schema;
    schemaLoading: boolean;
    schemaError: string;
    search: string;
    setSearch: (search: string) => void;
    history: Run[];
    documents: QueryDocument[];
    revisions: QueryDocument[];
    revisionsDocumentId?: string;
    revisionLoading: boolean;
    revisionError: string;
    currentRevision?: number;
    unsavedDraft: boolean;
    canRestoreRevision: boolean;
    run?: Run;
    profile?: QueryProfile;
    comparisonProfiles?: Readonly<Record<string, QueryProfile>>;
    comparisonPipelines?: Readonly<Record<string, ProfilePipeline>>;
    pipeline?: ProfilePipeline;
    onRefreshSchema: () => void;
    onRefreshHistory: () => void;
    onInsert: (value: string) => void;
    onOpenSqlDraft: (name: string, sql: string, run: boolean) => void;
    onOpenImport: () => void;
    onExportResult: () => void;
    exportDisabled: boolean;
    onOpenRun: (run: Run) => void;
    onOpenDocument: (document: QueryDocument) => void;
    onLoadProfile: () => void;
    onLoadPipeline: () => void;
    onOpenGraph: () => void;
    connectionId: string;
    sql: string;
    trusted: boolean;
    runId?: string;
    onRefreshDocuments: () => void;
    onRefreshRevisions: () => void;
    onRestoreRevision: (revision: QueryDocument) => void;
    assistantQuestion: string;
    onAssistantQuestion: (question: string) => void;
    assistantChats: readonly AssistantChat[];
    activeAssistantChatId: string;
    assistantTurns: readonly AssistantChatTurn[];
    assistantChatStorageError: string;
    onNewAssistantChat: () => void;
    onSelectAssistantChat: (chatId: string) => void;
    onRenameAssistantChat: (chatId: string, title: string) => void;
    onDeleteAssistantChat: (chatId: string) => void;
    assistantProposal?: Proposal;
    assistantBusy: boolean;
    assistantCancelable: boolean;
    assistantPhase?: 'preparing' | 'generating' | 'deciding';
    assistantError: string;
    assistantNotice: string;
    nativeParserEnabled: boolean;
    nativeParserStatus: NativeParserStatus;
    nativeParseSnapshot?: NativeParseSnapshot;
    onRetryParser: () => void;
    includeRun: boolean;
    onIncludeRun: (include: boolean) => void;
    onAskAI: (schema?: Schema, serverVersion?: string, database?: string) => void;
    onCancelAssistantRequest: () => void;
    onDecideProposal: (turnId: string, decision: 'accepted' | 'rejected') => void;
    onRunQuery: (sql: string) => void;
    runDisabled: (sql: string) => boolean;
    expert?: boolean;
    drawer?: boolean;
    onClose?: () => void;
};

const inspectorTabs = [
    { id: 'schema', icon: 'schema' },
    { id: 'history', icon: 'history' },
    { id: 'documents', icon: 'documents' },
    { id: 'revisions', icon: 'history' },
    { id: 'parser', icon: 'parser' },
    { id: 'details', icon: 'details' },
    { id: 'pipeline', icon: 'pipeline' },
    { id: 'assistant', icon: 'assistant' },
] as const satisfies readonly { id: Inspector; icon: IconName }[];

export function InspectorPane({ comparisonProfiles, comparisonPipelines, copy, inspector, setInspector, connection, schema, schemaLoading, schemaError, search, setSearch, history, documents, revisions, revisionsDocumentId, revisionLoading, revisionError, currentRevision, unsavedDraft, canRestoreRevision, run, profile, pipeline, onRefreshSchema, onRefreshHistory, onInsert, onOpenSqlDraft, onOpenImport, onExportResult, exportDisabled, onOpenRun, onOpenDocument, onLoadProfile, onLoadPipeline, onOpenGraph, connectionId, sql, trusted, runId, onRefreshDocuments, onRefreshRevisions, onRestoreRevision, assistantQuestion, onAssistantQuestion, assistantChats, activeAssistantChatId, assistantTurns, assistantChatStorageError, onNewAssistantChat, onSelectAssistantChat, onRenameAssistantChat, onDeleteAssistantChat, assistantProposal, assistantBusy, assistantCancelable, assistantPhase, assistantError, assistantNotice, nativeParserEnabled, nativeParserStatus, nativeParseSnapshot, onRetryParser, includeRun, onIncludeRun, onAskAI, onCancelAssistantRequest, onDecideProposal, onRunQuery, runDisabled, expert = false, drawer = false, onClose }: InspectorPaneProps) {
    const visibleDocuments = documents.filter(document => document.connectionId === connectionId && !document.deletedAt);
    const [selectedRevisionNumber, setSelectedRevisionNumber] = useState<number>();
    const [referenceTarget, setReferenceTarget] = useState<{ name: string; type: string }>();
    const firstRevisionNumber = revisions[0]?.revision;
    useEffect(() => { setSelectedRevisionNumber(currentRevision ?? firstRevisionNumber); }, [revisionsDocumentId, currentRevision, firstRevisionNumber]);
    const selectedRevision = revisions.find(revision => revision.revision === selectedRevisionNumber) ?? revisions[0];
    const closeButton = drawer && <Button variant="ghost" className="icon-only" aria-label="Close inspector" onClick={onClose}><Icon name="close"/></Button>;
    const title = inspector === 'schema' ? copy.objects : inspector === 'reference' ? copy.reference : inspector === 'documents' ? copy.queries : inspectorLabel(inspector);

    const objectDrawer = drawer && inspector === 'schema';
    useEffect(() => { setReferenceTarget(undefined); }, [connection.id]);
    const openReference = (name: string, type: string) => { setReferenceTarget({ name, type }); setInspector('reference'); };
    const clearReferenceTarget = useCallback(() => setReferenceTarget(undefined), []);

    return <aside className={cx('inspector-pane', expert && 'is-expert-browser', expert && (inspector === 'schema' || inspector === 'reference' || inspector === 'documents') && 'is-browser-tab-selected', drawer && 'is-drawer animate-drawer', objectDrawer && 'is-object-drawer')}>
        <header className="inspector-header"><div><span className="eyebrow">{expert ? copy.browse : copy.workspaceInspector}</span><h2>{title}</h2></div>{closeButton}</header>
        {expert ? <nav className="inspector-tabs is-browser-tabs" aria-label={copy.workspaceBrowser}>
            <button type="button" aria-label={copy.objects} aria-pressed={inspector === 'schema'} onClick={() => setInspector('schema')}><Icon name="schema"/><span>{copy.objects}</span></button>
            <button type="button" aria-label={copy.reference} aria-pressed={inspector === 'reference'} onClick={() => { setReferenceTarget(undefined); setInspector('reference'); }}><Icon name="reference"/><span>{copy.reference}</span></button>
            <button type="button" aria-label={copy.queries} aria-pressed={inspector === 'documents'} onClick={() => setInspector('documents')}><Icon name="documents"/><span>{copy.queries}</span></button>
            <InspectorMoreMenu copy={copy} inspector={inspector} onSelect={setInspector} items={inspectorTabs.filter(item => item.id === 'history' || item.id === 'revisions' || item.id === 'parser' || Boolean(run) && (item.id === 'details' || item.id === 'pipeline'))} />
        </nav> : <nav className="inspector-tabs is-browser-tabs" aria-label={copy.workspaceBrowser}>
            <button type="button" aria-label={copy.objects} aria-pressed={inspector === 'schema'} onClick={() => setInspector('schema')}><Icon name="schema"/><span>{copy.objects}</span></button>
            <button type="button" aria-label={copy.reference} aria-pressed={inspector === 'reference'} onClick={() => { setReferenceTarget(undefined); setInspector('reference'); }}><Icon name="reference"/><span>{copy.reference}</span></button>
            <InspectorMoreMenu copy={copy} inspector={inspector} onSelect={setInspector} items={inspectorTabs.filter(item => item.id === 'history' || item.id === 'documents' || item.id === 'revisions')} />
        </nav>}
        <div className={cx('inspector-content', inspector === 'assistant' && 'is-assistant-content')}>
            {inspector === 'schema' && <ObjectExplorer key={connection.id} copy={copy} connection={connection} schema={schema} schemaLoading={schemaLoading} schemaError={schemaError} search={search} setSearch={setSearch} trusted={trusted} onRefreshSchema={onRefreshSchema} onInsert={onInsert} compact={drawer} onOpenSqlDraft={onOpenSqlDraft} onOpenReference={openReference}/>}
            {inspector === 'reference' && <ReferenceExplorer copy={copy} connection={connection} trusted={trusted} target={referenceTarget} onTargetHandled={clearReferenceTarget} onInsert={onInsert}/>}
            {inspector === 'history' && <section className="inspector-section"><div className="schema-heading"><span>RECENT RUNS</span><RunComparisonLauncher connectionId={connectionId} trusted={trusted} history={history} initialRun={run} profiles={comparisonProfiles} pipelines={comparisonPipelines} queryLogAvailable={connection.manifest?.queryLog.available === true}/><Button variant="ghost" className="toolbar-small" onClick={onRefreshHistory}>↻ Refresh</Button></div>{history.length ? history.slice(0, 30).map(item => <button type="button" className="history-card" key={item.id} onClick={() => onOpenRun(item)}><span className={cx('run-state-mark', `state-${item.status}`)}/><span className="history-card-copy"><strong>{item.sql.replace(/\s+/g, ' ').slice(0, 58)}</strong><small>{new Date(item.createdAt).toLocaleString()} <i>·</i> {Math.round(item.elapsedMs)} ms <i>·</i> {item.rowCount.toLocaleString()} rows</small></span><span className="history-open">↗</span></button>) : <div className="inspector-empty"><Icon name="history"/><strong>No runs yet</strong><p>Your recent ClickHouse executions appear here.</p></div>}</section>}
            {inspector === 'documents' && <section className="inspector-section"><div className="schema-heading"><span>SAVED DOCUMENTS</span><Button variant="ghost" className="toolbar-small" onClick={onRefreshDocuments}>↻ Refresh</Button></div>{visibleDocuments.length ? visibleDocuments.map(document => <button type="button" className="document-card" key={document.id} onClick={() => onOpenDocument(document)}><span className="file-type-icon small">SQL</span><span><strong>{document.name}</strong><small>revision {document.revision} · {new Date(document.updatedAt).toLocaleDateString()}</small></span><span className="history-open">↗</span></button>) : <div className="inspector-empty"><Icon name="documents"/><strong>Nothing saved yet</strong><p>Save the current query to keep a named revision on this connection.</p></div>}</section>}
            {inspector === 'revisions' && <section className="inspector-section revision-history-section">
                <div className="schema-heading"><span>{revisionsDocumentId ? revisions.find(revision => revision.revision === currentRevision)?.name ?? 'QUERY VERSIONS' : 'QUERY VERSIONS'}</span><Button variant="ghost" className="toolbar-small" onClick={onRefreshRevisions} disabled={revisionLoading || !revisionsDocumentId}>{revisionLoading ? 'Loading…' : 'Refresh'}</Button></div>
                <p className="revision-history-help">Browse saved versions. Restoring one creates a new version.</p>
                {revisionError && <div className="callout callout-error" role="alert">{revisionError}</div>}
                {revisionLoading && !revisions.length && <div className="inspector-empty"><span className="loading-orbit"/><p>Loading saved versions…</p></div>}
                {!revisionLoading && !revisionError && !revisions.length && <div className="inspector-empty"><Icon name="history"/><strong>No saved versions</strong><p>Save this query to start a version history.</p></div>}
                {revisions.length > 0 && <>
                    <div className="revision-list" aria-label="Saved query versions">
                        {revisions.map(revision => <button type="button" key={`${revision.id}-${revision.revision}`} className={cx('revision-item', selectedRevision?.revision === revision.revision && 'is-selected')} aria-pressed={selectedRevision?.revision === revision.revision} onClick={() => setSelectedRevisionNumber(revision.revision)}>
                            <span className="revision-item-mark"><Icon name="history"/></span><span className="revision-item-copy"><strong>Version {revision.revision}{revision.revision === currentRevision && <em>Current</em>}</strong><small>{new Date(revision.updatedAt).toLocaleString()}</small></span><span className="history-open">›</span>
                        </button>)}
                    </div>
                    {selectedRevision && <div className="revision-preview"><div className="revision-preview-heading"><span>VERSION {selectedRevision.revision}</span>{selectedRevision.revision !== currentRevision && <Button variant="secondary" className="toolbar-small" title={canRestoreRevision ? 'Restore this version as a new latest version' : 'Restore the saved query before restoring a version'} disabled={revisionLoading || !canRestoreRevision} onClick={() => onRestoreRevision(selectedRevision)}>Restore</Button>}</div><pre aria-label={`SQL from version ${selectedRevision.revision}`}>{selectedRevision.sql}</pre>{unsavedDraft && <small className="revision-unsaved-note">Restoring replaces the current draft. You’ll be asked to confirm.</small>}</div>}
                </>}
            </section>}
            {inspector === 'parser' && <NativeParserInspector enabled={nativeParserEnabled} status={nativeParserStatus} snapshot={nativeParseSnapshot} onRetry={onRetryParser}/>}
            {inspector === 'details' && <RunDetails run={run} profile={profile} onLoad={onLoadProfile} unavailableReason={connection.manifest?.queryLog.available === false ? connection.manifest.queryLog.reason : undefined}/>}
            {inspector === 'pipeline' && <PipelineView run={run} profile={profile} pipeline={pipeline} onLoad={onLoadPipeline} onOpenGraph={onOpenGraph} available={connection.manifest?.pipeline.available !== false} unavailableReason={connection.manifest?.pipeline.available === false ? connection.manifest.pipeline.reason : undefined}/>}
            {inspector === 'assistant' && <AssistantWorkflow mode={expert ? 'expert' : 'beginner'} sql={sql} question={assistantQuestion} onQuestionChange={onAssistantQuestion} chats={assistantChats} activeChatId={activeAssistantChatId} turns={assistantTurns} storageError={assistantChatStorageError} onNewChat={onNewAssistantChat} onSelectChat={onSelectAssistantChat} onRenameChat={onRenameAssistantChat} onDeleteChat={onDeleteAssistantChat} editorProposalId={assistantProposal?.id} busy={assistantBusy} cancelable={assistantCancelable} phase={assistantPhase} error={assistantError} notice={assistantNotice} trusted={trusted} runId={runId} includeRun={includeRun} onIncludeRun={onIncludeRun} onAskAI={() => onAskAI(schema, connection.manifest?.serverVersion, connection.database)} onCancelRequest={onCancelAssistantRequest} schemaReady={Boolean(schema) && !schemaLoading && !schemaError} schemaLoading={schemaLoading} schemaStatus={schemaError} onRefreshSchema={onRefreshSchema} onDecideProposal={onDecideProposal} onRunQuery={onRunQuery} runDisabled={runDisabled}/>}
        </div>
        <footer className="inspector-footer">{expert && <div className="inspector-footer-actions"><Button variant="secondary" className="toolbar-small" onClick={onOpenImport}>{copy.import}</Button><Button variant="secondary" className="toolbar-small" onClick={onExportResult} disabled={exportDisabled}>{copy.export}</Button></div>}<div className="inspector-footer-meta"><span className="connection-readonly"><Icon name={connection.readonly ? 'lock' : 'database'}/> {connection.readonly ? copy.readOnly : 'Read/write'}</span><span title={`${connection.name} · ${connection.database}`}>{connection.name} <i>·</i> {connection.database}</span></div></footer>
    </aside>;
}

function InspectorMoreMenu({ copy, inspector, onSelect, items }: { copy: Copy['common']; inspector: Inspector; onSelect: (inspector: Inspector) => void; items: Array<{ id: Inspector; icon: IconName }> }) {
    const [open, setOpen] = useState(false);
    const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
    const active = items.some(item => item.id === inspector);

    useEffect(() => {
        if (!open) return;
        const closeOutside = (event: PointerEvent) => {
            if (!root.current?.contains(event.target as Node)) setOpen(false);
        };
        const closeOnEscape = (event: globalThis.KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            setOpen(false);
            trigger.current?.focus();
        };
        const frame = window.requestAnimationFrame(() => menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus());
        document.addEventListener('pointerdown', closeOutside);
        document.addEventListener('keydown', closeOnEscape);
        return () => {
            window.cancelAnimationFrame(frame);
            document.removeEventListener('pointerdown', closeOutside);
            document.removeEventListener('keydown', closeOnEscape);
        };
    }, [open]);

    const moveMenuFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
        if (!items.length) return;
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'ArrowDown' ? (current + 1) % items.length
            : event.key === 'ArrowUp' ? (current - 1 + items.length) % items.length
                : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : undefined;
        if (next === undefined) return;
        event.preventDefault();
        items[next]?.focus();
    };

    return <div className="inspector-more" ref={root}>
        <button ref={trigger} data-testid="workspace-panels" type="button" className={cx('inspector-more-trigger', active && 'is-active')} aria-label={copy.workspacePanels} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)}>{copy.more} <Icon name="chevron"/></button>
        {open && <div className="inspector-more-menu" role="menu" aria-label={copy.workspacePanels} ref={menu} onKeyDown={moveMenuFocus}>{items.map(item => <button key={item.id} data-testid={`workspace-panel-${item.id}`} type="button" role="menuitem" aria-pressed={inspector === item.id} onClick={() => { onSelect(item.id); setOpen(false); }}><Icon name={item.icon}/><span>{item.id === 'schema' ? copy.objects : item.id === 'documents' ? copy.queries : item.id === 'history' ? copy.history : inspectorLabel(item.id)}</span></button>)}</div>}
    </div>;
}

function RunDetails({ run, profile, onLoad, unavailableReason }: { run?: Run; profile?: QueryProfile; onLoad: () => void; unavailableReason?: string }) {
    if (!run) return <div className="inspector-empty">Run a query to see execution details.</div>;
    const summary = profile?.summary;
    const items: Array<[string, string]> = [['Query ID', run.queryId], ['Duration', `${Math.round(summary?.durationMs ?? run.elapsedMs)} ms`], ['Rows read', summary?.readRows ? Number(summary.readRows).toLocaleString() : '—'], ['Bytes read', summary?.readBytes ? formatBytes(summary.readBytes) : '—'], ['Memory', summary?.memory ? formatBytes(summary.memory) : '—'], ['Rows returned', run.rowCount.toLocaleString()], ['Executed as', run.executedAs], ['Server', run.serverVersion ?? '—']];
    return <section className="inspector-section"><div className="run-detail-hero"><span className="eyebrow">LATEST EXECUTION</span><Status run={run}/><strong>{run.queryId}</strong><small>{new Date(run.createdAt).toLocaleString()}</small></div><div className="run-fact-list">{items.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong>{label === 'Query ID' && <button title="Copy query ID" onClick={() => void navigator.clipboard.writeText(value)}><Icon name="copy"/></button>}</div>)}</div>{run.error && <div className="callout callout-error">{run.error.code}: {run.error.message}</div>}{unavailableReason ? <p className="profile-note">{unavailableReason}</p> : <Button variant="secondary" className="w-full mt-4" onClick={onLoad}>Load query log evidence</Button>}{profile?.notice && <p className="profile-note">{profile.notice}</p>}</section>;
}

function PipelineView({ run, profile, pipeline, onLoad, onOpenGraph, available, unavailableReason }: { run?: Run; profile?: QueryProfile; pipeline?: ProfilePipeline; onLoad: () => void; onOpenGraph: () => void; available: boolean; unavailableReason?: string }) {
    if (!run) return <div className="inspector-empty">Run a query to inspect its execution pipeline.</div>;
    const stages = pipeline?.nodes ?? profile?.pipeline.nodes ?? [];
    return <section className="inspector-section"><div className="schema-heading"><span>EXECUTION PIPELINE</span><Button variant="ghost" className="toolbar-small" onClick={onLoad} disabled={!available} title={unavailableReason}>Load evidence</Button></div>{pipeline?.notice && <p className="profile-note">{pipeline.notice}</p>}{stages.length ? <><Button variant="secondary" className="w-full" onClick={onOpenGraph}>Open operator graph in Insights</Button><div className="pipeline-list">{stages.map((stage, index) => <article className={`pipeline-stage stage-${stage.status}`} key={stage.id}><span className="pipeline-stage-index">{String(index + 1).padStart(2, '0')}</span><span className="pipeline-connector"/><span className="pipeline-stage-body"><strong>{stage.label}</strong><small>{stage.detail ?? stage.kind} · {stage.status}</small><span>{[stage.durationMs === undefined ? '' : `${Math.round(stage.durationMs)} ms`, stage.rows ? `${stage.rows} rows` : '', stage.bytes ? `${stage.bytes} bytes` : ''].filter(Boolean).join(' · ') || 'No stage-level measurements'}</span></span><span className="stage-evidence">{stage.status}</span></article>)}</div></> : <div className="inspector-empty"><Icon name="pipeline"/><strong>{available ? 'Pipeline evidence is not loaded' : 'Pipeline evidence is unavailable'}</strong><p>{unavailableReason ?? 'Available ClickHouse versions can return an EXPLAIN PIPELINE graph.'}</p></div>}</section>;
}
