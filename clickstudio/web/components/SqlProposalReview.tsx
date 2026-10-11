import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { syntaxHighlighting } from '@codemirror/language';
import { sql } from '@codemirror/lang-sql';
import { getChunks, unifiedMergeView } from '@codemirror/merge';
import type { ProposalDecisionAction } from '../../shared/assistant-types';
import type { Proposal } from '../../shared/types';
import { clickhouse, sqlEditorTheme, sqlHighlightStyle } from './SqlEditor';
import { Button, Spinner } from './ui';

export function SqlProposalReview({
    proposal,
    currentSql,
    dark,
    busy,
    error,
    onDecide,
}: {
    proposal: Proposal & { sql: string };
    currentSql: string;
    dark: boolean;
    busy: boolean;
    error: string;
    onDecide: (decision: ProposalDecisionAction) => Promise<void>;
}) {
    const element = useRef<HTMLDivElement>(null);
    const { id, baseSql, sql: proposedSql } = proposal;
    useEffect(() => {
        if (!element.current) return;
        const editor = new EditorView({
            parent: element.current,
            state: EditorState.create({
                doc: proposedSql,
                extensions: [
                    lineNumbers(),
                    sql({ dialect: clickhouse }),
                    syntaxHighlighting(sqlHighlightStyle),
                    sqlEditorTheme(dark),
                    EditorView.theme({
                        '&.cm-merge-b .cm-changedLine': {
                            backgroundColor: 'var(--sql-diff-added-background)',
                        },
                        '.cm-deletedChunk': {
                            backgroundColor: 'var(--sql-diff-removed-background)',
                        },
                        '&.cm-merge-b .cm-changedLineGutter': {
                            backgroundColor: 'var(--sql-diff-added)',
                        },
                        '&.cm-merge-b .cm-deletedLineGutter': {
                            backgroundColor: 'var(--sql-diff-removed)',
                        },
                        '.cm-deletedLine del': { textDecoration: 'none' },
                    }),
                    EditorState.readOnly.of(true),
                    EditorView.editable.of(false),
                    EditorView.contentAttributes.of({
                        role: 'textbox',
                        'aria-label': 'Proposed SQL changes',
                        'aria-readonly': 'true',
                        tabindex: '0',
                    }),
                    unifiedMergeView({
                        original: baseSql,
                        mergeControls: false,
                        highlightChanges: false,
                    }),
                ],
            }),
        });
        const firstChange = getChunks(editor.state)?.chunks[0];
        if (firstChange && firstChange.fromB > 0)
            editor.dispatch({
                effects: EditorView.scrollIntoView(
                    Math.min(firstChange.fromB, proposedSql.length),
                    { y: 'center' },
                ),
            });
        return () => editor.destroy();
    }, [id, baseSql, proposedSql, dark]);
    let blocked = '';
    if (baseSql !== currentSql) blocked = 'The query changed. Request a new proposal.';
    else if (proposal.quality?.status === 'fail')
        blocked = 'This proposal did not pass SQL checks.';
    return (
        <div className="sql-proposal-review" data-testid="sql-proposal-review">
            <div className="sql-editor sql-review-editor" ref={element} />
            {(error || blocked) && (
                <div className="sql-review-error" role="alert">
                    {error || blocked}
                </div>
            )}
            <div className="sql-review-actions" aria-label="Review SQL changes">
                {busy && <Spinner label="Updating proposal" />}
                <Button
                    variant="secondary"
                    className="toolbar-small"
                    aria-label="Reject SQL changes"
                    disabled={busy}
                    onClick={() => void onDecide('rejected')}
                >
                    Reject
                </Button>
                <Button
                    variant="primary"
                    className="toolbar-small"
                    aria-label="Accept SQL changes"
                    disabled={busy || Boolean(blocked)}
                    onClick={() => void onDecide('accepted')}
                >
                    Accept
                </Button>
            </div>
        </div>
    );
}
