import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import type { QueryDocument } from '../shared/types';
import { api } from './api';
import type { Draft, WorkspaceState } from './workspace-state';
import type { BusyAction, Inspector } from './workspace-types';

type SaveDraftOptions = Readonly<{
    active: Draft;
    busy: BusyAction;
    connectionId: string;
    workspaceRef: { current: WorkspaceState };
    inspectorRef: { current: Inspector };
    perform: (task: () => Promise<void>, kind?: BusyAction) => Promise<void>;
    updateDraft: (id: string, change: (draft: Draft) => Draft) => void;
    setSavingDraftIds: Dispatch<SetStateAction<Record<string, boolean>>>;
    setDocuments: Dispatch<SetStateAction<QueryDocument[]>>;
    setNotice: (notice: string) => void;
    loadDocumentRevisions: (documentId: string) => Promise<void>;
}>;

export function useWorkspaceDocumentSave({
    active,
    busy,
    connectionId,
    workspaceRef,
    inspectorRef,
    perform,
    updateDraft,
    setSavingDraftIds,
    setDocuments,
    setNotice,
    loadDocumentRevisions,
}: SaveDraftOptions) {
    const saveRunningRef = useRef(false);
    const queuedSaveDraftsRef = useRef(new Map<string, Draft>());
    const inFlightSaveDraftsRef = useRef(new Map<string, Draft>());
    const saveDraftRef = useRef<(draft?: Draft) => Promise<void>>(async () => {});

    const savePayload = (draft: Draft) => ({
        name: draft.name.trim(),
        sql: draft.sql,
        connectionId,
        baseRevision: draft.baseRevision,
        parameters: draft.parameters,
        chart: draft.chart,
        runId: draft.activeRunId,
        parentDocumentId: draft.parentDocumentId,
        kind: draft.kind,
        metric: draft.metric,
        dependencies: draft.dependencies,
    });
    const sameSaveRequest = (left: Draft, right: Draft) => JSON.stringify(savePayload(left)) === JSON.stringify(savePayload(right));
    const saveDraft = (requestedDraft?: Draft): Promise<void> => {
        const currentActive = workspaceRef.current.tabs.find(draft => draft.id === workspaceRef.current.activeId) ?? active;
        const requested = requestedDraft ?? currentActive;
        const resolveDraft = () => {
            const current = workspaceRef.current.tabs.find(draft => draft.id === requested.id);
            return current
                ? { ...current, ...(requested.name !== current.name ? { name: requested.name } : {}) }
                : requested;
        };
        const target = resolveDraft();
        const inFlight = inFlightSaveDraftsRef.current.get(target.id);
        const queued = queuedSaveDraftsRef.current.get(target.id);
        if ((inFlight && sameSaveRequest(target, inFlight)) || (queued && sameSaveRequest(target, queued))) return Promise.resolve();
        if (busy || saveRunningRef.current) {
            queuedSaveDraftsRef.current.set(target.id, target);
            return Promise.resolve();
        }

        saveRunningRef.current = true;
        inFlightSaveDraftsRef.current.set(target.id, target);
        return perform(async () => {
            const draft = resolveDraft();
            const payload = savePayload(draft);
            if (!payload.name) throw new Error('Enter a query name before saving.');
            setSavingDraftIds(current => ({ ...current, [draft.id]: true }));
            try {
                const saved = await api<QueryDocument>(draft.serverId ? `/documents/${encodeURIComponent(draft.serverId)}` : '/documents', {
                    method: draft.serverId ? 'PUT' : 'POST',
                    body: payload,
                });
                updateDraft(draft.id, current => ({
                    ...current,
                    ...(current.name.trim() === draft.name ? { name: saved.name } : {}),
                    serverId: saved.id,
                    baseRevision: saved.revision,
                }));
                setDocuments(current => [saved, ...current.filter(document => document.id !== saved.id)]);
                setNotice(`Saved ${saved.name} · revision ${saved.revision}`);
                if (draft.serverId && inspectorRef.current === 'revisions') void loadDocumentRevisions(saved.id);
            } finally {
                setSavingDraftIds(current => ({ ...current, [draft.id]: false }));
            }
        }, 'save').finally(() => {
            saveRunningRef.current = false;
            inFlightSaveDraftsRef.current.delete(target.id);
        });
    };
    saveDraftRef.current = saveDraft;

    useEffect(() => {
        if (busy) return;
        const next = queuedSaveDraftsRef.current.values().next().value as Draft | undefined;
        if (!next) return;
        queuedSaveDraftsRef.current.delete(next.id);
        void saveDraftRef.current(next);
    }, [busy]);

    useEffect(() => {
        const saveOnShortcut = (event: KeyboardEvent) => {
            if (event.defaultPrevented || !(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== 's') return;
            event.preventDefault();
            void saveDraftRef.current();
        };
        window.addEventListener('keydown', saveOnShortcut);
        return () => window.removeEventListener('keydown', saveOnShortcut);
    }, []);

    return saveDraft;
}
