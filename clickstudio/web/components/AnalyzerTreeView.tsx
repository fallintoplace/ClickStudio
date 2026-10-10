import { useEffect, useMemo, useRef, useState } from 'react';
import { parseQueryTree, type QueryTree } from '../../shared/query-tree';
import type { Copy } from '../i18n';
import { api, message } from '../api';
import { QueryTreeGraph } from './QueryTreeGraph';

type LoadState = { key: string; loading: boolean; tree?: QueryTree; error?: string };

export function AnalyzerTreeView({
    active,
    available,
    unavailableReason,
    connectionId,
    sql,
    parameters,
    copy,
}: {
    active: boolean;
    available: boolean;
    unavailableReason?: string;
    connectionId: string;
    sql: string;
    parameters: Record<string, string>;
    copy: Copy['common'];
}) {
    const request = useMemo(
        () => ({
            sql,
            parameters: Object.fromEntries(
                Object.entries(parameters).sort(([left], [right]) => left.localeCompare(right)),
            ),
        }),
        [parameters, sql],
    );
    const requestKey = useMemo(
        () => JSON.stringify({ connectionId, ...request }),
        [connectionId, request],
    );
    const loadedKey = useRef<string | undefined>(undefined);
    const [state, setState] = useState<LoadState>();

    useEffect(() => {
        if (!active || !available || !sql.trim() || loadedKey.current === requestKey) return;
        const controller = new AbortController();
        loadedKey.current = undefined;
        setState({ key: requestKey, loading: true });
        void api<string[]>('/connections/' + encodeURIComponent(connectionId) + '/query-tree', {
            method: 'POST',
            body: request,
            signal: controller.signal,
        })
            .then(lines => {
                if (controller.signal.aborted) return;
                loadedKey.current = requestKey;
                setState({ key: requestKey, loading: false, tree: parseQueryTree(lines) });
            })
            .catch(error => {
                if (controller.signal.aborted) return;
                setState({ key: requestKey, loading: false, error: message(error) });
            });
        return () => controller.abort();
    }, [active, available, connectionId, request, requestKey, sql]);

    const current = state?.key === requestKey ? state : undefined;
    return (
        <div hidden={!active} className="analyzer-tree-view">
            {!available ? (
                <div className="pipeline-graph-empty" role="status">
                    {unavailableReason ?? copy.queryTreeUnavailable}
                </div>
            ) : current?.loading ? (
                <div className="pipeline-graph-empty" role="status">
                    {copy.queryTreeLoading}
                </div>
            ) : current?.error ? (
                <div className="pipeline-graph-empty" role="alert">
                    {current.error}
                </div>
            ) : current?.tree?.root ? (
                <QueryTreeGraph tree={current.tree} copy={copy} />
            ) : (
                <div className="pipeline-graph-empty" role="status">
                    {copy.queryTreeNoOutput}
                </div>
            )}
        </div>
    );
}
