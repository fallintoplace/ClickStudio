import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { QueryDocument, Run, Schema } from '../shared/types';
import { sameSavedContent } from '../shared/workspace-view';
import { api, message } from './api';
import type { WorkspaceState } from './workspace-state';
import { startVisiblePolling } from './visible-polling';

export function useWorkspaceData({
    connectionId,
    trusted,
    activeServerId,
    setWorkspace,
    workspaceRef,
    setError,
}: {
    connectionId: string;
    trusted: boolean;
    activeServerId?: string;
    setWorkspace: Dispatch<SetStateAction<WorkspaceState>>;
    workspaceRef: { current: WorkspaceState };
    setError: (message: string) => void;
}) {
    const [schema, setSchema] = useState<Schema>();
    const [schemaLoading, setSchemaLoading] = useState(false);
    const [schemaLoadingMore, setSchemaLoadingMore] = useState(false);
    const [schemaError, setSchemaError] = useState('');
    const [documents, setDocuments] = useState<QueryDocument[]>([]);
    const [documentsLoaded, setDocumentsLoaded] = useState(false);
    const [documentsReadError, setDocumentsReadError] = useState(false);
    const [documentRevisions, setDocumentRevisions] = useState<QueryDocument[]>([]);
    const [revisionsDocumentId, setRevisionsDocumentId] = useState<string>();
    const [revisionLoading, setRevisionLoading] = useState(false);
    const [revisionError, setRevisionError] = useState('');
    const [history, setHistory] = useState<Run[]>([]);
    const trustedRef = useRef(trusted);
    trustedRef.current = trusted;
    const schemaRequestRef = useRef(0);
    const historyRequestRef = useRef(0);
    const documentsRequestRef = useRef(0);
    const revisionsRequestRef = useRef(0);
    const invalidateRequests = useCallback(() => {
        schemaRequestRef.current++;
        historyRequestRef.current++;
        documentsRequestRef.current++;
        revisionsRequestRef.current++;
    }, []);

    const loadHistory = useCallback(async (signal?: AbortSignal) => {
        const requestId = ++historyRequestRef.current;
        try {
            const next = await api<Run[]>(`/runs?connectionId=${encodeURIComponent(connectionId)}`, { signal });
            if (!signal?.aborted && historyRequestRef.current === requestId) setHistory(next);
        } catch (caught) {
            if (!signal?.aborted && historyRequestRef.current === requestId) throw caught;
        }
    }, [connectionId]);

    const loadDocuments = useCallback(async () => {
        const requestId = ++documentsRequestRef.current;
        try {
            const next = await api<QueryDocument[]>(`/documents?trash=true&connectionId=${encodeURIComponent(connectionId)}`);
            if (documentsRequestRef.current === requestId) {
                setDocuments(next);
                setWorkspace(current => ({
                    ...current,
                    tabs: current.tabs.map(draft => {
                        const saved = next.find(document => document.id === draft.serverId);
                        return saved && draft.baseRevision !== saved.revision && sameSavedContent(draft, saved)
                            ? { ...draft, baseRevision: saved.revision }
                            : draft;
                    }),
                }));
                setDocumentsReadError(false);
            }
        } catch (caught) {
            if (documentsRequestRef.current === requestId) {
                setDocumentsReadError(true);
                throw caught;
            }
        } finally {
            if (documentsRequestRef.current === requestId) setDocumentsLoaded(true);
        }
    }, [connectionId, setWorkspace]);

    const loadDocumentRevisions = useCallback(async (documentId = activeServerId) => {
        if (!documentId) {
            revisionsRequestRef.current++;
            setRevisionsDocumentId(undefined);
            setDocumentRevisions([]);
            setRevisionError('Save this query before opening version history.');
            setRevisionLoading(false);
            return;
        }
        const requestId = ++revisionsRequestRef.current;
        setRevisionsDocumentId(documentId);
        setDocumentRevisions([]);
        setRevisionError('');
        setRevisionLoading(true);
        try {
            const next = await api<QueryDocument[]>(`/documents/${encodeURIComponent(documentId)}/revisions`);
            const currentDraft = workspaceRef.current.tabs.find(draft => draft.id === workspaceRef.current.activeId);
            if (revisionsRequestRef.current === requestId && currentDraft?.serverId === documentId)
                setDocumentRevisions([...next].sort((left, right) => right.revision - left.revision));
        } catch (caught) {
            if (revisionsRequestRef.current === requestId) setRevisionError(message(caught));
        } finally {
            if (revisionsRequestRef.current === requestId) setRevisionLoading(false);
        }
    }, [activeServerId, workspaceRef]);

    const loadSchema = useCallback(async (refresh = false) => {
        const requestId = ++schemaRequestRef.current;
        setSchemaLoadingMore(false);
        if (!trustedRef.current) {
            setSchema(undefined);
            setSchemaError('');
            setSchemaLoading(false);
            return undefined;
        }
        setSchemaLoading(true);
        setSchemaError('');
        try {
            const next = await api<Schema>(`/connections/${encodeURIComponent(connectionId)}/schema${refresh ? '?refresh=true' : ''}`);
            if (schemaRequestRef.current === requestId && trustedRef.current) {
                setSchema(next);
                return next;
            }
        } catch (caught) {
            if (schemaRequestRef.current === requestId && trustedRef.current) setSchemaError(message(caught));
        } finally {
            if (schemaRequestRef.current === requestId) setSchemaLoading(false);
        }
        return undefined;
    }, [connectionId]);

    const loadMoreSchema = useCallback(async () => {
        const current = schema;
        if (!current?.pagination || schemaLoadingMore || connectionId !== 'clickhouse-cloud' || !trustedRef.current) return undefined;
        const requestId = ++schemaRequestRef.current;
        setSchemaLoadingMore(true);
        setSchemaError('');
        try {
            const params = new URLSearchParams();
            if (current.pagination.databases !== undefined) params.set('databaseOffset', String(current.pagination.databases));
            if (current.pagination.tables !== undefined) params.set('tableOffset', String(current.pagination.tables));
            if (current.pagination.columns !== undefined) params.set('columnOffset', String(current.pagination.columns));
            const next = await api<Schema>(`/connections/${encodeURIComponent(connectionId)}/schema?${params}`);
            if (schemaRequestRef.current !== requestId || !trustedRef.current) return undefined;
            const tableKey = (table: Schema['tables'][number]) => `${table.database}\u0000${table.name}`;
            const columnKey = (column: Schema['columns'][number]) => `${column.database}\u0000${column.table}\u0000${column.name}`;
            const merge = <T,>(left: T[], right: T[], key: (value: T) => string) => {
                const values = new Map(left.map(value => [key(value), value]));
                for (const value of right) values.set(key(value), value);
                return [...values.values()];
            };
            const merged: Schema = {
                ...next,
                databases: [...new Set([...(current.databases ?? []), ...(next.databases ?? [])])],
                tables: merge(current.tables, next.tables, tableKey),
                columns: merge(current.columns, next.columns, columnKey),
                dictionaries: current.dictionaries ?? next.dictionaries,
                warnings: [...new Set([...current.warnings, ...next.warnings])],
                metadataWarnings: [...new Set([...(current.metadataWarnings ?? []), ...(next.metadataWarnings ?? [])])],
                truncated: next.truncated,
            };
            setSchema(merged);
            return merged;
        } catch (caught) {
            if (schemaRequestRef.current === requestId && trustedRef.current) setSchemaError(message(caught));
            return undefined;
        } finally {
            if (schemaRequestRef.current === requestId) setSchemaLoadingMore(false);
        }
    }, [connectionId, schema, schemaLoadingMore]);

    useEffect(() => {
        let initialHistoryLoad = true;
        const stopHistoryPolling = startVisiblePolling(async signal => {
            try {
                await loadHistory(signal);
            } catch (caught) {
                if (initialHistoryLoad && !signal.aborted) setError(message(caught));
            } finally {
                if (!signal.aborted) initialHistoryLoad = false;
            }
        }, { intervalMs: 15000 });
        void loadDocuments().catch(caught => setError(message(caught)));
        if (trusted) void loadSchema();
        else {
            schemaRequestRef.current++;
            setSchema(undefined);
            setSchemaError('');
            setSchemaLoading(false);
            setSchemaLoadingMore(false);
        }
        return () => {
            stopHistoryPolling();
            invalidateRequests();
        };
    }, [invalidateRequests, loadDocuments, loadHistory, loadSchema, setError, trusted]);

    return {
        schema,
        schemaLoading,
        schemaError,
        documents,
        setDocuments,
        documentsLoaded,
        documentsReadError,
        documentRevisions,
        revisionsDocumentId,
        revisionLoading,
        revisionError,
        history,
        loadHistory,
        loadDocuments,
        loadDocumentRevisions,
        loadSchema,
        schemaLoadingMore,
        loadMoreSchema,
    };
}
