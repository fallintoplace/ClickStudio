import type { AssistantAction, Proposal } from '../../shared/types';
import { Button, cx, Icon } from './ui';
import type { AssistantContext } from '../workspace-types';

const assistantActionOptions = [
    { value: 'generate', label: 'Write SQL', description: 'Build a query from a question.' },
    { value: 'explain', label: 'Explain SQL', description: 'Understand the current query.' },
    { value: 'repair', label: 'Fix an error', description: 'Diagnose and repair a query.' },
    { value: 'review', label: 'Review SQL', description: 'Check the query for issues.' },
    { value: 'performance', label: 'Tune performance', description: 'Find ways to make it faster.' },
    { value: 'result', label: 'Explain results', description: 'Summarize the selected result.' },
] as const satisfies readonly { value: AssistantAction; label: string; description: string }[];

function AssistantFlowSteps({ context, proposal }: { context?: AssistantContext; proposal?: Proposal }) {
    const currentStep = proposal ? 3 : context ? 2 : 1;
    const steps = ['Ask', 'Review', 'Use'];
    return <ol className="assistant-flow-steps" aria-label="AI assistant steps">
        {steps.map((step, index) => {
            const stepNumber = index + 1;
            return <li key={step} className={cx(stepNumber < currentStep && 'is-complete', stepNumber === currentStep && 'is-current')} aria-current={stepNumber === currentStep ? 'step' : undefined}>
                <span>{String(stepNumber).padStart(2, '0')}</span><strong>{step}</strong>
            </li>;
        })}
    </ol>;
}

export type AssistantWorkflowProps = {
    mode: 'beginner' | 'expert';
    sql: string;
    action: AssistantAction;
    onActionChange: (action: AssistantAction) => void;
    question: string;
    onQuestionChange: (question: string) => void;
    context?: AssistantContext;
    proposal?: Proposal;
    busy: boolean;
    error: string;
    trusted: boolean;
    runId?: string;
    includeResult: boolean;
    onIncludeResult: (include: boolean) => void;
    onPreview: () => void;
    onGenerateSql: () => void;
    schemaReady: boolean;
    schemaLoading: boolean;
    schemaStatus: string;
    onRefreshSchema: () => void;
    onRequestProposal: () => void;
    onDecideProposal: (decision: 'accepted' | 'rejected') => void;
    onRunQuery: () => void;
    runDisabled: boolean;
};

function AssistantOutput({ mode, sql, context, proposal, busy, error, onRequestProposal, onDecideProposal, onRunQuery, runDisabled }: Pick<AssistantWorkflowProps, 'mode' | 'sql' | 'context' | 'proposal' | 'busy' | 'error' | 'onRequestProposal' | 'onDecideProposal' | 'onRunQuery' | 'runDisabled'>) {
    const beginner = mode === 'beginner';
    const diffInEditor = !beginner && proposal?.action === 'generate';
    return <>
        {error && <div className="callout callout-error" role="alert">{error}</div>}
        {context && <div className="context-preview animate-enter">
            <div className="assistant-context-heading"><span className="eyebrow">CONTEXT PREVIEW</span><small>Review what will be used</small></div>
            {context.summary.map(item => <p key={item}><span>✓</span>{item}</p>)}
            <Button variant="primary" className="w-full" disabled={busy} onClick={onRequestProposal}>{busy ? 'Preparing proposal…' : 'Ask AI for a proposal'}</Button>
        </div>}
        {proposal && <div className={cx('proposal-card animate-enter', beginner && 'beginner-proposal-card')}>
            <div className="proposal-heading"><span className={cx('proposal-quality', proposal.quality?.status)}>{proposal.quality?.score ?? '—'}<small>QUALITY</small></span><div><span className="eyebrow">PROPOSAL · {proposal.decision.toUpperCase()}</span><strong>{proposal.summary}</strong></div></div>
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

export function AssistantWorkflow({ mode, sql, action, onActionChange, question, onQuestionChange, context, proposal, busy, error, trusted, runId, includeResult, onIncludeResult, onPreview, onGenerateSql, schemaReady, schemaLoading, schemaStatus, onRefreshSchema, onRequestProposal, onDecideProposal, onRunQuery, runDisabled }: AssistantWorkflowProps) {
    const beginner = mode === 'beginner';
    const output = <AssistantOutput mode={mode} sql={sql} context={context} proposal={proposal} busy={busy} error={error} onRequestProposal={onRequestProposal} onDecideProposal={onDecideProposal} onRunQuery={onRunQuery} runDisabled={runDisabled}/>;

    if (beginner) return <section className="assistant-panel beginner-ai-panel animate-enter" aria-label="Ask AI to write a query">
        <div className="assistant-safety"><span className="assistant-glyph"><Icon name="assistant"/></span><div><strong>Start with a question</strong><p>Review the ClickHouse context and proposed SQL before adding it to your draft.</p></div></div>
        <AssistantFlowSteps context={context} proposal={proposal}/>
        <label className="field-label" htmlFor="beginner-query-prompt">YOUR QUESTION<textarea id="beginner-query-prompt" className="field-textarea" aria-label="Describe your data question" value={question} onChange={event => onQuestionChange(event.target.value)} placeholder="For example: show event counts by day" rows={4}/></label>
        <div className="flex flex-wrap items-center justify-end gap-2"><Button variant="secondary" disabled={!trusted || busy || !question.trim()} onClick={onPreview}>{busy ? 'Preparing…' : context ? 'Refresh preview' : 'Review context'}</Button></div>
        {!trusted && <div className="callout">Trust this connection to include its schema.</div>}
        <div className="assistant-actions">{output}</div>
    </section>;

    if (action === 'generate') return <section className="assistant-panel assistant-generate-panel animate-enter" aria-label="Generate SQL with AI">
        <div className="assistant-safety"><span className="assistant-glyph"><Icon name="assistant"/></span><div><strong>Write SQL</strong><p>Describe what you need. Review the diff before adding it to your draft.</p></div></div>
        <label className="field-label" htmlFor="expert-sql-prompt">YOUR QUESTION<textarea id="expert-sql-prompt" className="field-textarea" aria-label="YOUR QUESTION" value={question} onChange={event => onQuestionChange(event.target.value)} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); if (trusted && schemaReady && question.trim() && !busy) onGenerateSql(); } }} placeholder="For example: show event counts by day" rows={4}/></label>
        <div className="flex flex-wrap items-center justify-end gap-2"><Button variant="primary" disabled={!trusted || !schemaReady || busy || !question.trim()} onClick={onGenerateSql}>{busy ? 'Generating SQL…' : 'Generate SQL'}</Button></div>
        <p className="assistant-generation-disclosure">Your question, current SQL, and available schema are sent to OpenAI to draft SQL. The query is not run automatically.</p>
        {!trusted && <div className="callout">Trust this connection before generating SQL from its schema.</div>}
        {!schemaReady && trusted && <div className="callout assistant-schema-refresh"><span>{schemaStatus || 'Load the ClickHouse schema before generating SQL.'}</span><Button variant="secondary" disabled={schemaLoading} onClick={onRefreshSchema}>{schemaLoading ? 'Loading…' : 'Refresh schema'}</Button></div>}
        <AssistantOutput mode={mode} sql={sql} context={undefined} proposal={proposal} busy={busy} error={error} onRequestProposal={onRequestProposal} onDecideProposal={onDecideProposal} onRunQuery={onRunQuery} runDisabled={runDisabled}/>
    </section>;

    return <section className="assistant-panel">
        <div className="assistant-safety"><span className="assistant-glyph"><Icon name="assistant"/></span><div><strong>ClickHouse-aware help for your SQL</strong><p>Choose a task, preview the context, then shape the proposal for your draft.</p></div></div>
        <AssistantFlowSteps context={context} proposal={proposal}/>
        <fieldset className="assistant-task-picker">
            <legend>Choose a task</legend>
            <div>{assistantActionOptions.map(option => <label key={option.value} className="assistant-task-option">
                <input type="radio" name="assistant-task" value={option.value} checked={action === option.value} onChange={() => onActionChange(option.value)}/>
                <span><strong>{option.label}</strong><small>{option.description}</small></span>
            </label>)}</div>
        </fieldset>
        <label className="field-label">YOUR QUESTION OR FOCUS<textarea className="field-textarea" value={question} onChange={event => onQuestionChange(event.target.value)} placeholder="Describe what you want to understand or improve…" rows={3}/></label>
        <label className="include-result"><input type="checkbox" checked={includeResult} onChange={event => onIncludeResult(event.target.checked)} disabled={!runId}/><span><strong>Include selected result</strong><small>Its retained rows will appear in the context preview.</small></span></label>
        <div className="assistant-actions"><div className="flex flex-wrap items-center justify-end gap-2"><Button variant="secondary" disabled={!trusted || busy} onClick={onPreview}>{busy && !context ? 'Preparing context…' : context ? 'Refresh context preview' : 'Preview context'}</Button></div>{output}</div>
    </section>;
}
