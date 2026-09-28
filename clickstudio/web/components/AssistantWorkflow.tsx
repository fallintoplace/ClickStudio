import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { diffLines } from 'diff';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { statementOutline, type SqlOperation } from '../../shared/editor-tools';
import type { Proposal, ProposalAlternative } from '../../shared/types';
import type { AssistantChat, AssistantChatTurn } from '../assistant-chat-state';
import { AssistantChatHistory } from './AssistantChatHistory';
import { ScrollEdgeFrame } from './ScrollEdgeShadows';
import { Button, cx, Icon } from './ui';

export type AssistantWorkflowProps = {
    mode: 'beginner' | 'expert';
    sql: string;
    question: string;
    onQuestionChange: (question: string) => void;
    chats: readonly AssistantChat[];
    activeChatId: string;
    turns: readonly AssistantChatTurn[];
    storageError: string;
    onNewChat: () => void;
    onSelectChat: (chatId: string) => void;
    onRenameChat: (chatId: string, title: string) => void;
    onDeleteChat: (chatId: string) => void;
    busy: boolean;
    cancelable: boolean;
    phase?: 'preparing' | 'generating' | 'deciding';
    error: string;
    notice: string;
    trusted: boolean;
    database: string;
    serverLabel: string;
    schemaFetchedAt?: string;
    onAskAI: () => void;
    onCancelRequest: () => void;
    schemaReady: boolean;
    schemaLoading: boolean;
    schemaStatus: string;
    onRefreshSchema: () => void;
    onDecideProposal: (turnId: string, decision: 'accepted' | 'rejected') => void;
    onRunQuery: (sql: string) => void;
    runDisabled: (sql: string) => boolean;
};

type SqlDiffRow = { kind: 'added' | 'removed' | 'context'; text: string; oldLine?: number; newLine?: number };
type SqlDiffChange = ReturnType<typeof diffLines>[number];

function sqlDiffRows(changes: readonly SqlDiffChange[]): SqlDiffRow[] {
    let oldLine = 1;
    let newLine = 1;
    return changes.flatMap(change => {
        const lines = change.value.split('\n');
        if (lines.at(-1) === '') lines.pop();
        const kind = change.added ? 'added' : change.removed ? 'removed' : 'context';
        return lines.map(text => {
            const row: SqlDiffRow = {
                kind,
                text: text.replace(/\r$/, ''),
                ...(kind === 'added' ? {} : { oldLine }),
                ...(kind === 'removed' ? {} : { newLine }),
            };
            if (kind !== 'added') oldLine++;
            if (kind !== 'removed') newLine++;
            return row;
        });
    });
}

function AssistantSqlProposalDiff({ proposal, currentSql, busy, mode, turnId, onDecideProposal }: {
    proposal: Proposal;
    currentSql: string;
    busy: boolean;
    mode: AssistantWorkflowProps['mode'];
    turnId: string;
    onDecideProposal: AssistantWorkflowProps['onDecideProposal'];
}) {
    const pending = proposal.decision === 'pending';
    const [open, setOpen] = useState(pending);
    const changes = useMemo(() => diffLines(proposal.baseSql, proposal.sql ?? ''), [proposal.baseSql, proposal.sql]);
    const { added, removed } = useMemo(() => changes.reduce((counts, change) => {
        const lines = change.value.split('\n').length - Number(change.value.endsWith('\n'));
        if (change.added) counts.added += lines;
        if (change.removed) counts.removed += lines;
        return counts;
    }, { added: 0, removed: 0 }), [changes]);
    const rows = useMemo(() => open ? sqlDiffRows(changes) : [], [changes, open]);
    const stale = pending && proposal.baseSql !== currentSql;
    const unsafe = proposal.quality?.status === 'fail';
    const inspectOnly = proposal.action === 'review' || proposal.action === 'explain';
    const status = proposal.decision === 'pending' ? 'Needs review' : proposal.decision === 'accepted' ? 'Applied' : 'Rejected';
    const reviewMessage = stale
        ? 'The SQL draft changed. Ask again to review the current draft.'
        : unsafe
            ? 'A required check failed. This proposal can’t be applied.'
            : inspectOnly
                ? 'This reply is for review only and can’t be applied.'
            : 'Applying updates your draft only. Press Run when you are ready to execute it.';

    return <div className="assistant-sql-review">
        <details className="sql-proposal-diff" data-testid="sql-proposal-diff" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
            <summary className="sql-proposal-diff-toggle">
                <span className="sql-proposal-diff-title"><span className="eyebrow">SQL DIFF</span><span className={cx('sql-proposal-review-status', `is-${proposal.decision}`)}>{status}</span></span>
                <span className="sql-proposal-diff-count" aria-label={`${added} lines added, ${removed} lines removed`}><span className="is-added"><i>+{added}</i> added</span><span className="is-removed"><i>−{removed}</i> removed</span></span>
                <span className="sql-proposal-diff-chevron" aria-hidden="true">⌄</span>
            </summary>
            <ScrollEdgeFrame<HTMLPreElement> className="sql-proposal-diff-scroll-frame">{ref => <pre ref={ref} className="sql-proposal-diff-code" aria-label="Line-by-line SQL changes"><code>{rows.map((row, index) => <span className={`sql-proposal-diff-line is-${row.kind}`} key={`${row.kind}-${index}`}><span className="sql-proposal-diff-gutter">{row.oldLine ?? ''} {row.newLine ?? ''}</span><span className="sql-proposal-diff-sign">{row.kind === 'added' ? '+' : row.kind === 'removed' ? '−' : ' '}</span><span>{row.text || ' '}</span></span>)}</code></pre>}</ScrollEdgeFrame>
        </details>
        {pending && <footer className="sql-proposal-diff-footer"><span className={cx((stale || unsafe || inspectOnly) && 'is-blocked')}>{reviewMessage}</span><div><Button variant="secondary" onClick={() => onDecideProposal(turnId, 'rejected')} disabled={busy}>Reject</Button>{!inspectOnly && <Button variant="primary" onClick={() => onDecideProposal(turnId, 'accepted')} disabled={busy || stale || unsafe}>{mode === 'beginner' ? 'Use this query' : 'Apply to draft'}</Button>}</div></footer>}
    </div>;
}

function normalizeCitationMarkdown(text: string, sources: readonly { url: string }[]) {
    return sources.reduce((normalized, source) => {
        let url: URL;
        try { url = new URL(source.url); } catch { return normalized; }
        if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return normalized;
        const canonicalUrl = url.href;
        const escapedUrl = canonicalUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const nestedCitation = new RegExp(String.raw`\[([^\]]+)\]\\?\(\s*\[\s*${escapedUrl}\s*\]\(\s*${escapedUrl}\s*\)\s*\)`, 'g');
        return normalized.replace(nestedCitation, (_match, label: string) => `[${label}](${canonicalUrl})`);
    }, text);
}

function AssistantMarkdown({ text, sources, className, testId }: {
    text: string;
    sources: readonly { url: string }[];
    className: string;
    testId?: string;
}) {
    return <div className={className} data-testid={testId}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children, ...props }) => <a {...props} href={href} target="_blank" rel="noreferrer">{children}</a> }}>{normalizeCitationMarkdown(text, sources)}</ReactMarkdown>
    </div>;
}

const operationLabels: Record<SqlOperation, string> = {
    read: 'Read',
    insert: 'Insert',
    update: 'Update',
    delete: 'Delete',
    schema: 'Schema',
    unknown: 'Unknown',
};

function AssistantExecutionOption({ title, summary, sql, accepted, busy, runDisabled, onRunQuery, alternative = false }: {
    title: string;
    summary?: string;
    sql: string;
    accepted: boolean;
    busy: boolean;
    runDisabled: (sql: string) => boolean;
    onRunQuery: (sql: string) => void;
    alternative?: boolean;
}) {
    const outline = useMemo(() => statementOutline(sql), [sql]);
    const statements = outline.statements;
    const needsConfirmation = statements.length > 1 && statements.some(statement => statement.operation !== 'read');
    const hasUpdateBeforeDelete = statements.some((statement, index) => statement.operation === 'update' && statements.slice(index + 1).some(next => next.operation === 'delete'));
    const firstOperation = statements[0]?.operation;
    const [confirming, setConfirming] = useState(false);
    const runBlocked = !accepted || busy || runDisabled(sql) || Boolean(outline.error) || !statements.length || statements.length > 50;
    const operations = [...new Set(statements.filter(statement => statement.operation !== 'read').map(statement => operationLabels[statement.operation].toUpperCase()))];
    const confirmationText = hasUpdateBeforeDelete
        ? `This submits all ${statements.length} statements in order. It submits UPDATE before DELETE, so the DELETE may remove rows changed by the UPDATE. ClickHouse mutations can finish asynchronously.`
        : `This submits all ${statements.length} statements in order, including ${operations.join(', ') || 'unknown operations'} that may change data or schema.`;

    return <section className="assistant-execution-option" aria-label={`Execution plan: ${title}`} data-testid="assistant-execution-option">
        <header className="assistant-execution-heading">
            <div><span className="eyebrow">{alternative ? 'ALTERNATIVE' : statements.length > 1 ? 'SCRIPT PLAN' : 'RECOMMENDED OPTION'}</span><strong>{title}</strong>{summary && <p>{summary}</p>}</div>
            <span className="assistant-execution-count">{statements.length} {statements.length === 1 ? 'statement' : 'statements'}{statements.length > 1 ? ' · runs in order' : ''}</span>
        </header>
        {outline.error && <p className="assistant-execution-error" role="alert">Could not split this SQL safely: {outline.error}</p>}
        {!outline.error && !statements.length && <p className="assistant-execution-error" role="alert">There are no SQL statements to run.</p>}
        <ol className="assistant-execution-steps" aria-label="Statements in execution order">
            {statements.slice(0, 50).map((statement, index) => <li key={`${statement.from}-${index}`} data-operation={statement.operation}>
                <div className="assistant-execution-step-heading"><span className="assistant-execution-number">{index + 1}</span><span className={cx('assistant-operation-badge', `is-${statement.operation}`)}>{operationLabels[statement.operation]}</span><span className="assistant-execution-label">{statement.label || 'SQL statement'}</span></div>
                <pre><code>{statement.sql}</code></pre>
                {accepted && statements.length > 1 && statement.operation !== 'read' && <Button variant="secondary" onClick={() => onRunQuery(statement.sql)} disabled={busy || runDisabled(statement.sql)} aria-label={`Run only statement ${index + 1}: ${operationLabels[statement.operation]}`}>Run only {operationLabels[statement.operation]}</Button>}
            </li>)}
        </ol>
        {statements.length > 50 && <p className="assistant-execution-error" role="status">Showing the first 50 of {statements.length} statements. Scripts with more than 50 statements cannot run as one script.</p>}
        {accepted && <footer className="assistant-execution-actions">
            {confirming ? <div className="assistant-execution-confirmation" role="group" aria-label="Confirm running the full option">
                <p role="alert">{confirmationText}</p>
                <div><Button variant="secondary" onClick={() => setConfirming(false)}>Cancel</Button><Button variant="danger" onClick={() => { setConfirming(false); onRunQuery(sql); }} disabled={runBlocked}>Confirm and run all</Button></div>
            </div> : <Button variant={needsConfirmation ? 'secondary' : 'primary'} onClick={() => needsConfirmation ? setConfirming(true) : onRunQuery(sql)} disabled={runBlocked} aria-label={alternative ? `Run alternative: ${title}` : statements.length > 1 ? `Run all ${statements.length} statements` : `Run recommended option: ${title}`}><Icon name="play"/>{needsConfirmation ? `Review run of ${statements.length} statements` : alternative ? `Run this alternative` : statements.length > 1 ? `Run all ${statements.length} statements` : firstOperation === 'read' ? 'Run query' : firstOperation ? `Run ${operationLabels[firstOperation]}` : 'Run SQL'}</Button>}
        </footer>}
    </section>;
}

function AssistantOutput({ mode, sql, turn, busy, onDecideProposal, onRunQuery, runDisabled }: {
    mode: AssistantWorkflowProps['mode'];
    sql: string;
    turn: AssistantChatTurn;
    busy: boolean;
    onDecideProposal: AssistantWorkflowProps['onDecideProposal'];
    onRunQuery: (sql: string) => void;
    runDisabled: (sql: string) => boolean;
}) {
    const proposal = turn.proposal;
    const proposalSql = proposal?.sql ?? null;
    const mainOutline = useMemo(() => proposalSql === null ? undefined : statementOutline(proposalSql), [proposalSql]);
    if (turn.status === 'pending') return <div className="assistant-pending" role="status"><span className="loading-orbit"/>Thinking…</div>;
    if (turn.error) return <div className={cx('assistant-turn-error', turn.status === 'cancelled' && 'is-cancelled')} role={turn.status === 'failed' ? 'alert' : 'status'}>{turn.error}</div>;
    if (!proposal) return null;

    const alternatives: ProposalAlternative[] = proposal.alternatives ?? [];
    const beginner = mode === 'beginner';
    const proposalIsScript = (mainOutline?.statements.length ?? 0) > 1;
    const proposalHasNonReadStatement = mainOutline?.statements.some(statement => statement.operation !== 'read') ?? false;
    const proposalHasNoStatements = proposalSql !== null && mainOutline?.statements.length === 0;
    const showExecutionOptions = proposalSql !== null && (proposalIsScript || alternatives.length > 0 || proposalHasNonReadStatement || Boolean(mainOutline?.error) || proposalHasNoStatements);
    const stale = proposal.decision === 'accepted' && proposalSql !== sql;
    const sources = (proposal.sources ?? []).flatMap(source => {
        try {
            const url = new URL(source.url);
            return url.protocol === 'http:' || url.protocol === 'https:' ? [{ ...source, url: url.href, label: source.title || url.hostname }] : [];
        } catch { return []; }
    });
    return <div className={cx('proposal-card', beginner && 'beginner-proposal-card')}>
        <div className="proposal-heading">
            {proposalSql !== null && <span className={cx('proposal-quality', proposal.quality?.status)} title="Automated SQL checks, not a guarantee that the query returns the right answer." aria-label={`Automated SQL check score: ${proposal.quality?.score ?? 'unavailable'}`}>{proposal.quality?.score ?? '—'}<small>CHECKS</small></span>}
            <div><span className="eyebrow">{proposalSql === null ? 'ANSWER' : `SQL PROPOSAL · ${proposal.decision.toUpperCase()}`}</span><AssistantMarkdown text={proposal.summary} sources={sources} className={proposalSql === null ? 'assistant-answer-markdown' : 'assistant-proposal-summary'} testId={proposalSql === null ? 'assistant-answer-markdown' : 'assistant-proposal-summary'}/></div>
        </div>
        {stale && <p className="assistant-stale-proposal" role="status">This accepted query comes from an earlier SQL draft. Running it uses the SQL shown here.</p>}
        {proposal.clarification && <div className="callout"><AssistantMarkdown text={proposal.clarification} sources={sources} className="assistant-proposal-markdown"/></div>}
        {proposal.findings.map((item, index) => <div className="proposal-finding" key={`${index}-${item.severity}-${item.message}`}><strong>{item.severity}</strong><AssistantMarkdown text={item.message} sources={sources} className="assistant-proposal-markdown"/><AssistantMarkdown text={item.evidence} sources={sources} className="assistant-proposal-markdown assistant-proposal-finding-evidence"/></div>)}
        {(proposal.assumptions.length > 0 || proposal.caveats.length > 0 || sources.length > 0) && <details className="assistant-supporting-details">
            <summary>Assumptions, notes and sources <span>{proposal.assumptions.length + proposal.caveats.length + sources.length}</span></summary>
            <div className="assistant-supporting-details-content">
                {proposal.assumptions.map((item, index) => <div className="proposal-point" key={`${index}-${item}`}><span>ASSUMPTION</span><AssistantMarkdown text={item} sources={sources} className="assistant-proposal-markdown"/></div>)}
                {proposal.caveats.map((item, index) => <div className="proposal-point" key={`${index}-${item}`}><span>NOTE</span><AssistantMarkdown text={item} sources={sources} className="assistant-proposal-markdown"/></div>)}
                {sources.length > 0 && <div className="assistant-web-sources"><span className="eyebrow">WEB SOURCES</span><ul>{sources.map(source => <li key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.label}</a></li>)}</ul></div>}
            </div>
        </details>}
        {proposalSql !== null && <>
            <AssistantSqlProposalDiff key={`${proposal.id}:${proposal.decision}`} proposal={proposal} currentSql={sql} busy={busy} mode={mode} turnId={turn.id} onDecideProposal={onDecideProposal}/>
            {showExecutionOptions && <div className="assistant-execution-options">
                <AssistantExecutionOption key={`${proposal.id}:recommended`} title={alternatives.length ? 'Recommended option' : proposalIsScript ? 'Script plan' : 'SQL action'} sql={proposalSql} accepted={proposal.decision === 'accepted'} busy={busy} runDisabled={runDisabled} onRunQuery={onRunQuery}/>
                {alternatives.map((option, index) => <AssistantExecutionOption key={`${proposal.id}:alternative:${index}`} title={option.title} summary={option.summary} sql={option.sql} accepted={proposal.decision === 'accepted'} busy={busy} runDisabled={runDisabled} onRunQuery={onRunQuery} alternative/>)}
            </div>}
            {beginner && proposal.decision === 'accepted' && !showExecutionOptions && <div className="beginner-run-ready"><span><span className="status-light is-trusted"/> {stale ? 'Accepted from an earlier draft' : 'Added to your SQL draft'}</span><Button variant={stale ? 'secondary' : 'primary'} title={stale ? 'Runs the SQL saved in this older assistant proposal.' : undefined} onClick={() => onRunQuery(proposalSql)} disabled={runDisabled(proposalSql) || busy}><Icon name="play"/>{busy ? 'Starting…' : stale ? 'Run older query' : 'Run this query'}</Button></div>}
        </>}
    </div>;
}

export function AssistantWorkflow(props: AssistantWorkflowProps) {
    const { mode, sql, question, onQuestionChange, chats, activeChatId, turns, storageError, onNewChat, onSelectChat, onRenameChat, onDeleteChat,
        busy, error, trusted, cancelable, phase, notice, onAskAI, onCancelRequest,
        database, serverLabel, schemaFetchedAt,
        schemaReady, schemaLoading, schemaStatus, onRefreshSchema, onDecideProposal, onRunQuery, runDisabled } = props;
    const transcriptViewport = useRef<HTMLDivElement>(null);
    const activeChat = chats.find(chat => chat.id === activeChatId);
    const schemaTime = schemaFetchedAt ? new Date(schemaFetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : undefined;

    useLayoutEffect(() => {
        const viewport = transcriptViewport.current;
        if (viewport) viewport.scrollTop = viewport.scrollHeight;
    }, [activeChatId, turns]);

    const ask = () => { void onAskAI(); };
    const sendOnEnter = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            if (!busy && question.trim()) ask();
        }
    };
    return <section className="assistant-panel animate-enter" aria-label="Ask AI">
        <AssistantChatHistory chats={chats} activeChatId={activeChatId} onNewChat={onNewChat} onSelectChat={onSelectChat} onRenameChat={onRenameChat} onDeleteChat={onDeleteChat}/>
        {storageError && <div className="assistant-feedback callout callout-error" role="alert">{storageError}</div>}
        <div id={`assistant-chat-panel-${activeChatId}`} className="assistant-chat-panel" role="region" aria-label={`Conversation: ${activeChat?.title ?? 'New chat'}`}>
            <ScrollEdgeFrame<HTMLDivElement> className="assistant-transcript-frame">{ref => <div ref={element => { transcriptViewport.current = element; ref(element); }} className={cx('assistant-transcript', !turns.length && 'is-empty')} role="log" aria-label="Chat messages" aria-live="polite" aria-relevant="additions text">
                {!turns.length && <div className="assistant-empty-chat"><span className="assistant-glyph"><Icon name="assistant"/></span><strong>Start a conversation</strong><p>Ask about your query. Follow-ups keep this chat’s context.</p></div>}
                {turns.map(turn => <article className="assistant-turn" key={turn.id}>
                    <div className="assistant-user-message"><span>You</span><p>{turn.question}</p></div>
                    <div className="assistant-response"><span className="assistant-response-label">Assistant</span><AssistantOutput mode={mode} sql={sql} turn={turn} busy={busy} onDecideProposal={onDecideProposal} onRunQuery={onRunQuery} runDisabled={runDisabled}/></div>
                </article>)}
            </div>}</ScrollEdgeFrame>
        </div>
        <div className="assistant-composer-area">
            {error && <div className="assistant-feedback callout callout-error" role="alert">{error}</div>}
            {notice && <div className="assistant-feedback callout" role="status">{notice}</div>}
            {!trusted && <div className="assistant-feedback callout">Trust this connection before sharing its schema with the assistant.</div>}
            {!schemaReady && trusted && <div className="assistant-feedback callout assistant-schema-refresh"><span>{schemaStatus || 'Load the ClickHouse schema before asking the assistant.'}</span><Button variant="secondary" disabled={schemaLoading} onClick={onRefreshSchema}>{schemaLoading ? 'Loading…' : 'Refresh schema'}</Button></div>}
            {trusted && <div className="assistant-context-meta" aria-label="Ask AI context"><span>Database <strong>{database}</strong></span><i>·</i><span>{serverLabel}</span>{schemaTime && <span className="assistant-context-schema">Schema refreshed {schemaTime}</span>}</div>}
            <div className="assistant-chat-composer">
                <ScrollEdgeFrame<HTMLTextAreaElement> className="assistant-question-frame">{ref => <textarea ref={ref} id="assistant-question" className="field-textarea" aria-label="Ask AI" value={question} onChange={event => onQuestionChange(event.target.value)} onKeyDown={sendOnEnter} placeholder="Message… (Enter to send)" rows={2}/>}</ScrollEdgeFrame>
                <div className="assistant-composer-footer"><span>Shift+Enter for a new line</span>{busy ? cancelable ? <Button variant="danger" onClick={onCancelRequest} aria-label="Stop assistant response" title="Stop generating">Stop</Button> : <Button variant="secondary" disabled>{phase === 'deciding' ? 'Applying…' : 'Working…'}</Button> : <Button variant="primary" disabled={!trusted || !schemaReady || !question.trim()} onClick={ask}><Icon name="send"/>Send</Button>}</div>
                <details className="assistant-disclosure"><summary>What gets sent and saved?</summary><p>Your message, chat history, current SQL, and schema are sent to OpenAI. The latest completed run’s SQL, saved rows, and any error are included when available. The assistant may search the web; sources appear with its answer. This chat is saved in this browser. SQL suggestions never run automatically.</p></details>
            </div>
        </div>
    </section>;
}
