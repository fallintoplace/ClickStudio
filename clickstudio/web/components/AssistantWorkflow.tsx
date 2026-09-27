import { useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { AssistantChat, AssistantChatTurn } from '../assistant-chat-state';
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
    editorProposalId?: string;
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
    onDecideProposal: (turnId: string, decision: 'accepted' | 'rejected') => void;
    onRunQuery: () => void;
    runDisabled: boolean;
};

function AssistantOutput({ mode, sql, turn, busy, editorProposalId, onDecideProposal, onRunQuery, runDisabled }: {
    mode: AssistantWorkflowProps['mode'];
    sql: string;
    turn: AssistantChatTurn;
    busy: boolean;
    editorProposalId?: string;
    onDecideProposal: AssistantWorkflowProps['onDecideProposal'];
    onRunQuery: () => void;
    runDisabled: boolean;
}) {
    const proposal = turn.proposal;
    if (turn.status === 'pending') return <div className="assistant-pending" role="status"><span className="loading-orbit"/>Thinking…</div>;
    if (turn.error) return <div className={cx('assistant-turn-error', turn.status === 'cancelled' && 'is-cancelled')} role={turn.status === 'failed' ? 'alert' : 'status'}>{turn.error}</div>;
    if (!proposal) return null;

    const beginner = mode === 'beginner';
    const currentProposal = proposal.id === editorProposalId;
    const diffInEditor = !beginner && currentProposal && proposal.decision === 'pending' &&
        (proposal.action === 'ask' || proposal.action === 'generate');
    const stale = proposal.decision === 'accepted' ? proposal.sql !== sql : proposal.baseSql !== sql;
    return <div className={cx('proposal-card', beginner && 'beginner-proposal-card')}>
        <div className="proposal-heading">
            {proposal.sql !== null && <span className={cx('proposal-quality', proposal.quality?.status)}>{proposal.quality?.score ?? '—'}<small>QUALITY</small></span>}
            <div><span className="eyebrow">{proposal.sql === null ? 'ANSWER' : `SQL PROPOSAL · ${proposal.decision.toUpperCase()}`}</span><strong>{proposal.summary}</strong></div>
        </div>
        {stale && <p className="assistant-stale-proposal" role="status">This response used an earlier SQL draft. It stays in the chat, but its SQL cannot be applied to the current draft.</p>}
        {proposal.clarification && <div className="callout">{proposal.clarification}</div>}
        {proposal.assumptions.map((item, index) => <p className="proposal-point" key={`${index}-${item}`}><span>ASSUMPTION</span>{item}</p>)}
        {proposal.caveats.map((item, index) => <p className="proposal-point" key={`${index}-${item}`}><span>NOTE</span>{item}</p>)}
        {proposal.findings.map((item, index) => <p className="proposal-finding" key={`${index}-${item.severity}-${item.message}`}><strong>{item.severity}</strong>{item.message}<small>{item.evidence}</small></p>)}
        {proposal.sql !== null && <>
            {diffInEditor
                ? <p className="proposal-review-hint">Review the SQL diff above the editor, then accept or reject it there.</p>
                : <><span className="eyebrow mt-4">PROPOSED SQL</span><pre className="proposal-sql">{proposal.sql}</pre></>}
            {proposal.decision === 'pending' && <>
                {stale && <div className="callout callout-error">The SQL draft changed. This proposal can no longer be applied.</div>}
                {!diffInEditor && <div className="proposal-buttons"><Button variant="secondary" onClick={() => onDecideProposal(turn.id, 'rejected')} disabled={busy || stale}>Reject</Button><Button variant="primary" onClick={() => onDecideProposal(turn.id, 'accepted')} disabled={busy || stale}>{beginner ? 'Use this query' : 'Apply to editor'}</Button></div>}
            </>}
            {beginner && proposal.decision === 'accepted' && <div className="beginner-run-ready"><span><span className="status-light is-trusted"/> Added to your SQL draft</span><Button variant="primary" onClick={onRunQuery} disabled={runDisabled || busy}><Icon name="play"/>{busy ? 'Starting…' : 'Run this query'}</Button></div>}
        </>}
    </div>;
}

export function AssistantWorkflow(props: AssistantWorkflowProps) {
    const { mode, sql, question, onQuestionChange, chats, activeChatId, turns, storageError, onNewChat, onSelectChat, onRenameChat, onDeleteChat,
        editorProposalId, busy, error, trusted, runId, includeRun, onIncludeRun, cancelable, phase, notice, onAskAI, onCancelRequest,
        schemaReady, schemaLoading, schemaStatus, onRefreshSchema, onDecideProposal, onRunQuery, runDisabled } = props;
    const transcriptViewport = useRef<HTMLDivElement>(null);
    const [renaming, setRenaming] = useState(false);
    const [renameValue, setRenameValue] = useState('');
    const activeChat = chats.find(chat => chat.id === activeChatId);

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
    const deleteChat = () => {
        const title = activeChat?.title || 'this chat';
        if (window.confirm(`Delete “${title}” and its conversation?`)) onDeleteChat(activeChatId);
    };
    const startRename = () => {
        setRenameValue(activeChat?.title ?? 'New chat');
        setRenaming(true);
    };

    return <section className="assistant-panel animate-enter" aria-label="Ask AI">
        {renaming
            ? <form className="assistant-chat-rename" aria-label="Rename conversation" onSubmit={event => { event.preventDefault(); if (!renameValue.trim()) return; onRenameChat(activeChatId, renameValue); setRenaming(false); }}>
                <label className="assistant-chat-rename-input"><span className="sr-only">Conversation name</span><input autoFocus aria-label="Conversation name" value={renameValue} maxLength={80} onChange={event => setRenameValue(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setRenaming(false); } }}/></label>
                <Button variant="primary" type="submit" disabled={!renameValue.trim()}>Save name</Button>
                <Button variant="ghost" onClick={() => setRenaming(false)}>Cancel</Button>
            </form>
            : <div className="assistant-chat-toolbar">
                <label className="assistant-chat-select-wrap"><span className="sr-only">Chat history</span><select className="assistant-chat-select" aria-label="Chat history" value={activeChatId} onChange={event => onSelectChat(event.target.value)}>
                    {[...chats].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).map(chat => <option key={chat.id} value={chat.id}>{chat.title}</option>)}
                </select><Icon name="chevron"/></label>
                <div className="assistant-chat-actions"><Button variant="ghost" className="assistant-rename-button" onClick={startRename} aria-label="Rename conversation" title="Rename conversation">Rename</Button><Button variant="secondary" onClick={onNewChat}><Icon name="plus"/>New chat</Button><Button variant="ghost" onClick={deleteChat} aria-label="Delete current chat">Delete</Button></div>
            </div>}
        {storageError && <div className="assistant-feedback callout callout-error" role="alert">{storageError}</div>}
        <div id={`assistant-chat-panel-${activeChatId}`} className="assistant-chat-panel" role="region" aria-label={`Conversation: ${activeChat?.title ?? 'New chat'}`}>
            <ScrollEdgeFrame<HTMLDivElement> className="assistant-transcript-frame">{ref => <div ref={element => { transcriptViewport.current = element; ref(element); }} className={cx('assistant-transcript', !turns.length && 'is-empty')} role="log" aria-label="Chat messages" aria-live="polite" aria-relevant="additions text">
                {!turns.length && <div className="assistant-empty-chat"><span className="assistant-glyph"><Icon name="assistant"/></span><strong>Start a conversation</strong><p>Ask about your query. Follow-ups keep this chat’s context.</p></div>}
                {turns.map(turn => <article className="assistant-turn" key={turn.id}>
                    <div className="assistant-user-message"><span>You</span><p>{turn.question}</p></div>
                    <div className="assistant-response"><span className="assistant-response-label">Assistant</span><AssistantOutput mode={mode} sql={sql} turn={turn} busy={busy} editorProposalId={editorProposalId} onDecideProposal={onDecideProposal} onRunQuery={onRunQuery} runDisabled={runDisabled}/></div>
                </article>)}
            </div>}</ScrollEdgeFrame>
        </div>
        <div className="assistant-composer-area">
            {error && <div className="assistant-feedback callout callout-error" role="alert">{error}</div>}
            {notice && <div className="assistant-feedback callout" role="status">{notice}</div>}
            {!trusted && <div className="assistant-feedback callout">Trust this connection before sharing its schema with the assistant.</div>}
            {!schemaReady && trusted && <div className="assistant-feedback callout assistant-schema-refresh"><span>{schemaStatus || 'Load the ClickHouse schema before asking the assistant.'}</span><Button variant="secondary" disabled={schemaLoading} onClick={onRefreshSchema}>{schemaLoading ? 'Loading…' : 'Refresh schema'}</Button></div>}
            <div className="assistant-chat-composer">
                <div className="assistant-composer-context"><span className="assistant-context-chip">Current SQL</span><span className="assistant-context-chip">Schema</span><label className="assistant-include-run" title="Send its SQL, retained rows when available, and any error."><input type="checkbox" checked={includeRun} onChange={event => onIncludeRun(event.target.checked)} disabled={!runId}/><span>Include latest run</span></label></div>
                <ScrollEdgeFrame<HTMLTextAreaElement> className="assistant-question-frame">{ref => <textarea ref={ref} id="assistant-question" className="field-textarea" aria-label="Ask AI" value={question} onChange={event => onQuestionChange(event.target.value)} onKeyDown={sendOnEnter} placeholder="Message… (Enter to send)" rows={2}/>}</ScrollEdgeFrame>
                <div className="assistant-composer-footer"><span>Shift+Enter for a new line</span>{busy ? cancelable ? <Button variant="danger" onClick={onCancelRequest} aria-label="Stop assistant response" title="Stop generating">Stop</Button> : <Button variant="secondary" disabled>{phase === 'deciding' ? 'Applying…' : 'Working…'}</Button> : <Button variant="primary" disabled={!trusted || !schemaReady || !question.trim()} onClick={ask}><Icon name="send"/>Send</Button>}</div>
                <details className="assistant-disclosure"><summary>Privacy and review</summary><p>Your messages and current SQL and schema are sent with each follow-up. The latest run is included only when selected. Chat history, including shared run context, is saved in this browser. Review every SQL proposal before applying it; proposals are never run automatically.</p></details>
            </div>
        </div>
    </section>;
}
