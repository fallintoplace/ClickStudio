import { useLayoutEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
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
    const { mode, sql, question, onQuestionChange, chats, activeChatId, turns, storageError, onNewChat, onSelectChat, onDeleteChat,
        editorProposalId, busy, error, trusted, runId, includeRun, onIncludeRun, cancelable, phase, notice, onAskAI, onCancelRequest,
        schemaReady, schemaLoading, schemaStatus, onRefreshSchema, onDecideProposal, onRunQuery, runDisabled } = props;
    const transcriptViewport = useRef<HTMLDivElement>(null);
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
    const moveChatTab = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
        const nextIndex = event.key === 'ArrowRight' ? (index + 1) % chats.length
            : event.key === 'ArrowLeft' ? (index - 1 + chats.length) % chats.length
                : event.key === 'Home' ? 0 : event.key === 'End' ? chats.length - 1 : undefined;
        if (nextIndex === undefined) return;
        event.preventDefault();
        const chatId = chats[nextIndex]?.id;
        if (!chatId) return;
        onSelectChat(chatId);
        window.requestAnimationFrame(() => document.getElementById(`assistant-chat-tab-${chatId}`)?.focus());
    };
    const deleteChat = () => {
        const title = activeChat?.title || 'this chat';
        if (window.confirm(`Delete “${title}” and its conversation?`)) onDeleteChat(activeChatId);
    };

    return <section className="assistant-panel animate-enter" aria-label="Ask AI">
        <div className="assistant-safety"><span className="assistant-glyph"><Icon name="assistant"/></span><div><strong>Ask AI</strong><p>Ask about your SQL or results, request a query, or get help fixing and improving one.</p></div></div>
        {storageError && <div className="callout callout-error" role="alert">{storageError}</div>}
        <div className="assistant-chat-toolbar">
            <ScrollEdgeFrame<HTMLDivElement> className="assistant-chat-tabs-frame">{ref => <div ref={ref} className="assistant-chat-tabs" role="tablist" aria-label="AI chats">
                {chats.map((chat, index) => <button key={chat.id} id={`assistant-chat-tab-${chat.id}`} type="button" role="tab" aria-selected={chat.id === activeChatId} aria-controls={chat.id === activeChatId ? `assistant-chat-panel-${chat.id}` : undefined} tabIndex={chat.id === activeChatId ? 0 : -1} onClick={() => onSelectChat(chat.id)} onKeyDown={event => moveChatTab(event, index)} title={chat.title}>
                    <span>{chat.title}</span>{chat.turns.length > 0 && <small>{chat.turns.length}</small>}
                </button>)}
            </div>}</ScrollEdgeFrame>
            <div className="assistant-chat-actions"><Button variant="secondary" onClick={onNewChat}>New chat</Button><Button variant="ghost" onClick={deleteChat} aria-label="Delete current chat">Delete</Button></div>
        </div>
        <div id={`assistant-chat-panel-${activeChatId}`} className="assistant-chat-panel" role="tabpanel" aria-labelledby={`assistant-chat-tab-${activeChatId}`}>
            <ScrollEdgeFrame<HTMLDivElement> className="assistant-transcript-frame">{ref => <div ref={element => { transcriptViewport.current = element; ref(element); }} className="assistant-transcript" role="log" aria-label="Chat messages" aria-live="polite">
                {!turns.length && <div className="assistant-empty-chat"><span className="assistant-glyph"><Icon name="assistant"/></span><strong>Start a conversation</strong><p>Ask a question, then send follow-ups here. Each message uses the latest SQL and schema.</p></div>}
                {turns.map(turn => <article className="assistant-turn" key={turn.id}>
                    <div className="assistant-user-message"><span>You</span><p>{turn.question}</p></div>
                    <div className="assistant-response"><span className="assistant-response-label">Assistant</span><AssistantOutput mode={mode} sql={sql} turn={turn} busy={busy} editorProposalId={editorProposalId} onDecideProposal={onDecideProposal} onRunQuery={onRunQuery} runDisabled={runDisabled}/></div>
                </article>)}
            </div>}</ScrollEdgeFrame>
        </div>
        <div className="field-label"><label htmlFor="assistant-question">MESSAGE</label><ScrollEdgeFrame<HTMLTextAreaElement> className="assistant-question-frame">{ref => <textarea ref={ref} id="assistant-question" className="field-textarea" aria-label="Ask AI" value={question} onChange={event => onQuestionChange(event.target.value)} onKeyDown={sendOnEnter} placeholder="Ask a follow-up… (Enter to send, Shift+Enter for a new line)" rows={3}/>}</ScrollEdgeFrame></div>
        <label className="include-result"><input type="checkbox" checked={includeRun} onChange={event => onIncludeRun(event.target.checked)} disabled={!runId}/><span><strong>Include latest run</strong><small>Send its SQL, retained rows when available, and any error.</small></span></label>
        <div className="flex flex-wrap items-center justify-end gap-2"><Button variant="primary" disabled={!trusted || !schemaReady || busy || !question.trim()} onClick={ask}>{busy ? phase === 'preparing' ? 'Preparing run…' : phase === 'deciding' ? 'Saving…' : 'Thinking…' : 'Send'}</Button>{cancelable && <Button variant="secondary" onClick={onCancelRequest}>Cancel</Button>}</div>
        {error && <div className="callout callout-error" role="alert">{error}</div>}
        {notice && <div className="callout" role="status">{notice}</div>}
        <p className="assistant-generation-disclosure">Your messages, SQL, and any run context you chose to share are sent with each follow-up. Current SQL and schema are refreshed for each message; the latest run is included only when selected. Chat history, including shared run context, is saved in this browser. Review every SQL proposal before applying it; proposals are never run automatically.</p>
        {!trusted && <div className="callout">Trust this connection before sharing its schema with the assistant.</div>}
        {!schemaReady && trusted && <div className="callout assistant-schema-refresh"><span>{schemaStatus || 'Load the ClickHouse schema before asking the assistant.'}</span><Button variant="secondary" disabled={schemaLoading} onClick={onRefreshSchema}>{schemaLoading ? 'Loading…' : 'Refresh schema'}</Button></div>}
    </section>;
}
