import type { QueryDocument } from '../../shared/types';
import { draftSaveStatus } from '../../shared/workspace-view';
import type { Draft, WorkspaceState } from '../workspace-state';
import { cx, Icon } from './ui';
import type { ReactNode, RefObject } from 'react';

type TabScrollState = {
    overflow: boolean;
    canScrollLeft: boolean;
    canScrollRight: boolean;
};

type WorkspaceDocumentTabsProps = {
    workspace: WorkspaceState;
    experience: 'beginner' | 'expert';
    activeId: string;
    connectionId: string;
    documents: QueryDocument[];
    documentsLoaded: boolean;
    documentsReadError: boolean;
    savingDraftIds: Record<string, boolean>;
    tabScrollerRef: RefObject<HTMLDivElement | null>;
    tabScrollState: TabScrollState;
    updateTabScrollState: () => void;
    scrollTabs: (direction: -1 | 1) => void;
    renamingTabId?: string;
    tabRenameValue: string;
    setTabRenameValue: (value: string) => void;
    beginTabRename: (draft: Draft) => void;
    finishTabRename: (draftId: string, value: string, restoreFocus?: boolean) => void;
    cancelTabRename: (draftId: string) => void;
    onActivate: (draftId: string) => void;
    onClose: (draftId: string) => void;
    actions: ReactNode;
};

export function WorkspaceDocumentTabs({
    workspace,
    experience,
    activeId,
    connectionId,
    documents,
    documentsLoaded,
    documentsReadError,
    savingDraftIds,
    tabScrollerRef,
    tabScrollState,
    updateTabScrollState,
    scrollTabs,
    renamingTabId,
    tabRenameValue,
    setTabRenameValue,
    beginTabRename,
    finishTabRename,
    cancelTabRename,
    onActivate,
    onClose,
    actions,
}: WorkspaceDocumentTabsProps) {
    const compactSingleTab = experience === 'beginner' && workspace.tabs.length === 1;
    return <div className={cx('document-tabs', tabScrollState.overflow && 'has-tab-overflow', compactSingleTab && 'is-compact-single')}>
        <div
            ref={tabScrollerRef}
            className="document-tabs-scroll"
            role="tablist"
            aria-label="SQL documents"
            onScroll={updateTabScrollState}
        >
            {workspace.tabs.map((draft, index) => <div
                key={draft.id}
                id={`document-tab-${draft.id}`}
                className={cx('document-tab', draft.id === activeId && 'is-active')}
                role="tab"
                aria-label={draft.name}
                aria-selected={draft.id === activeId}
                aria-controls="sql-document-panel"
                tabIndex={draft.id === activeId ? 0 : -1}
                onClick={() => onActivate(draft.id)}
                onKeyDown={event => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onActivate(draft.id);
                        return;
                    }
                    let nextIndex: number | undefined;
                    if (event.key === 'ArrowRight') nextIndex = (index + 1) % workspace.tabs.length;
                    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + workspace.tabs.length) % workspace.tabs.length;
                    else if (event.key === 'Home') nextIndex = 0;
                    else if (event.key === 'End') nextIndex = workspace.tabs.length - 1;
                    if (nextIndex === undefined) return;
                    event.preventDefault();
                    const nextDraft = workspace.tabs[nextIndex]!;
                    onActivate(nextDraft.id);
                    window.requestAnimationFrame(() => document.getElementById(`document-tab-${nextDraft.id}`)?.focus());
                }}
            >
                {renamingTabId === draft.id
                    ? <input
                        className="document-tab-rename"
                        aria-label={`Rename ${draft.name}`}
                        value={tabRenameValue}
                        autoFocus
                        onFocus={event => event.currentTarget.select()}
                        onClick={event => event.stopPropagation()}
                        onChange={event => setTabRenameValue(event.target.value)}
                        onBlur={event => finishTabRename(draft.id, event.currentTarget.value)}
                        onKeyDown={event => {
                            if (event.key === 'Enter') {
                                event.preventDefault();
                                finishTabRename(draft.id, event.currentTarget.value, true);
                            } else if (event.key === 'Escape') {
                                event.preventDefault();
                                cancelTabRename(draft.id);
                            }
                        }}
                    />
                    : <span
                        className="document-tab-name"
                        title={`Double-click to rename ${draft.name}`}
                        onDoubleClick={event => {
                            event.stopPropagation();
                            beginTabRename(draft);
                        }}
                    >{draft.name}</span>}
                {(() => {
                    const status = draftSaveStatus(draft, connectionId, documents.find(document => document.id === draft.serverId), {
                        saving: Boolean(savingDraftIds[draft.id]),
                        pending: !documentsLoaded,
                        readError: Boolean(documentsReadError),
                    });
                    const unsaved = ['local', 'changed', 'conflict', 'deleted', 'unavailable'].includes(status.state);
                    return unsaved ? <span className="tab-unsaved" title={status.label} aria-hidden="true"/> : null;
                })()}
                <button type="button" aria-label={`Close ${draft.name}`} title={`Close ${draft.name}`} onClick={event => {
                    event.stopPropagation();
                    onClose(draft.id);
                }}>×</button>
            </div>)}
        </div>
        <div className="document-tab-actions">
            {tabScrollState.overflow && <>
                <button
                    className="document-tabs-scroll-button is-left"
                    data-testid="scroll-sql-tabs-left"
                    type="button"
                    aria-label="Scroll SQL tabs left"
                    title="More SQL tabs to the left"
                    disabled={!tabScrollState.canScrollLeft}
                    onClick={() => scrollTabs(-1)}
                ><Icon name="chevron"/></button>
                <button
                    className="document-tabs-scroll-button is-right"
                    data-testid="scroll-sql-tabs-right"
                    type="button"
                    aria-label="Scroll SQL tabs right"
                    title="More SQL tabs to the right"
                    disabled={!tabScrollState.canScrollRight}
                    onClick={() => scrollTabs(1)}
                ><Icon name="chevron"/></button>
            </>}
            {actions}
        </div>
    </div>;
}
