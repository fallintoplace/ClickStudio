import type { Proposal } from '../../shared/types';
import { ScrollEdgeFrame } from './ScrollEdgeShadows';
import { Button, cx, Icon } from './ui';

export type AssistantWorkflowProps = {
    mode: 'beginner' | 'expert';
    sql: string;
    question: string;
    onQuestionChange: (question: string) => void;
    proposal?: Proposal;
    busy: boolean;
    cancelable: boolean;
    phase?: 'preparing' | 'generating' | 'deciding';
    error: string;
    notice: string;
    trusted: boolean;
    runId?: string;
    includeRun: boolean;
    onIncludeRun: (include: boolean) => void;
    onAskAI: () => void;
    onCancelRequest: () => void;
    schemaReady: boolean;
    schemaLoading: boolean;
    schemaStatus: string;
    onRefreshSchema: () => void;
    onDecideProposal: (decision: 'accepted' | 'rejected') => void;
    onRunQuery: () => void;
    runDisabled: boolean;
};

function AssistantOutput({ mode, sql, proposal, busy, error, onDecideProposal, onRunQuery, runDisabled }: Pick<AssistantWorkflowProps, 'mode' | 'sql' | 'proposal' | 'busy' | 'error' | 'onDecideProposal' | 'onRunQuery' | 'runDisabled'>) {
    const beginner = mode === 'beginner';
    const diffInEditor = !beginner && (proposal?.action === 'ask' || proposal?.action === 'generate');
    return <>
        {error && <div className="callout callout-error" role="alert">{error}</div>}
        {proposal && <div className={cx('proposal-card animate-enter', beginner && 'beginner-proposal-card')}>
            <div className="proposal-heading">{proposal.sql !== null && <span className={cx('proposal-quality', proposal.quality?.status)}>{proposal.quality?.score ?? '—'}<small>QUALITY</small></span>}<div><span className="eyebrow">{proposal.sql === null ? 'ANSWER' : `SQL PROPOSAL · ${proposal.decision.toUpperCase()}`}</span><strong>{proposal.summary}</strong></div></div>
            {proposal.clarification && <div className="callout">{proposal.clarification}</div>}
            {proposal.assumptions.map(item => <p className="proposal-point" key={item}><span>ASSUMPTION</span>{item}</p>)}
            {proposal.caveats.map(item => <p className="proposal-point" key={item}><span>NOTE</span>{item}</p>)}
            {proposal.findings.map(item => <p className="proposal-finding" key={`${item.severity}-${item.message}`}><strong>{item.severity}</strong>{item.message}<small>{item.evidence}</small></p>)}
            {proposal.sql !== null && <>
                {diffInEditor
                    ? proposal.decision === 'pending' && <p className="proposal-review-hint">Review the SQL diff above the editor, then accept or reject it there.</p>
                    : <><span className="eyebrow mt-4">PROPOSED SQL</span><pre className="proposal-sql">{proposal.sql}</pre></>}
                {proposal.decision === 'pending' && <>
                    {proposal.baseSql !== sql && <div className="callout callout-error">The SQL draft changed. Refresh the context before applying this proposal.</div>}
                    {!diffInEditor && <div className="proposal-buttons"><Button variant="secondary" onClick={() => onDecideProposal('rejected')} disabled={busy}>Reject</Button><Button variant="primary" onClick={() => onDecideProposal('accepted')} disabled={busy || proposal.baseSql !== sql}>{beginner ? 'Use this query' : 'Apply to editor'}</Button></div>}
                </>}
                {beginner && proposal.decision === 'accepted' && <div className="beginner-run-ready"><span><span className="status-light is-trusted"/> Added to your SQL draft</span><Button variant="primary" onClick={onRunQuery} disabled={runDisabled || busy}><Icon name="play"/>{busy ? 'Starting…' : 'Run this query'}</Button></div>}
            </>}
        </div>}
    </>;
}

export function AssistantWorkflow(props: AssistantWorkflowProps) {
    const { mode, sql, question, onQuestionChange, proposal, busy, error, trusted, runId, includeRun, onIncludeRun,
        cancelable, phase, notice, onAskAI, onCancelRequest, schemaReady, schemaLoading, schemaStatus, onRefreshSchema, onDecideProposal, onRunQuery, runDisabled } = props;
    const output = <AssistantOutput mode={mode} sql={sql} proposal={proposal} busy={busy} error={error} onDecideProposal={onDecideProposal} onRunQuery={onRunQuery} runDisabled={runDisabled}/>;
    const ask = () => { void onAskAI(); };
    return <section className="assistant-panel animate-enter" aria-label="Ask AI">
        <div className="assistant-safety"><span className="assistant-glyph"><Icon name="assistant"/></span><div><strong>Ask AI</strong><p>Ask about your SQL or results, request a query, or get help fixing and improving one.</p></div></div>
        <div className="field-label"><label htmlFor="assistant-question">YOUR QUESTION</label><ScrollEdgeFrame<HTMLTextAreaElement> className="assistant-question-frame">{ref => <textarea ref={ref} id="assistant-question" className="field-textarea" aria-label="Ask AI" value={question} onChange={event => onQuestionChange(event.target.value)} placeholder="For example: explain this query, help fix this error, or show event counts by day…" rows={4}/>}</ScrollEdgeFrame></div>
        <label className="include-result"><input type="checkbox" checked={includeRun} onChange={event => onIncludeRun(event.target.checked)} disabled={!runId}/><span><strong>Include latest run</strong><small>Send its SQL, retained rows when available, and any error.</small></span></label>
        <div className="flex flex-wrap items-center justify-end gap-2"><Button variant="primary" disabled={!trusted || !schemaReady || busy || !question.trim()} onClick={ask}>{busy ? phase === 'preparing' ? 'Preparing run…' : phase === 'deciding' ? 'Saving…' : 'Thinking…' : 'Ask AI'}</Button>{cancelable && <Button variant="secondary" onClick={onCancelRequest}>Cancel</Button>}</div>
        {notice && <div className="callout" role="status">{notice}</div>}
        <p className="assistant-generation-disclosure">Your question, current SQL, and available schema are sent to OpenAI. The latest run’s SQL, retained rows when available, and error are included only when selected. Any SQL proposal must be reviewed before it is applied, and is never run automatically.</p>
        {!trusted && <div className="callout">Trust this connection before sharing its schema with the assistant.</div>}
        {!schemaReady && trusted && <div className="callout assistant-schema-refresh"><span>{schemaStatus || 'Load the ClickHouse schema before asking the assistant.'}</span><Button variant="secondary" disabled={schemaLoading} onClick={onRefreshSchema}>{schemaLoading ? 'Loading…' : 'Refresh schema'}</Button></div>}
        {output}
    </section>;
}
