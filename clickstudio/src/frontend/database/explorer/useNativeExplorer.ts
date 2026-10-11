import { useEffect, useState } from 'react';
import type {
    NativeExplorerRequest,
    NativeExplorerSnapshot,
} from '../../../shared/database/explorer/explorers';
import { message } from '../../common/requests/api';
import { requestNativeExplorer } from './native-explorer-provider';
import { startVisiblePolling } from '../../common/browser/visible-polling';

/** One in-flight inspection per scope; hidden or inactive panels do not poll. */
export function useNativeExplorer(
    connectionId: string,
    request: NativeExplorerRequest,
    active: boolean,
    live: boolean,
) {
    const kind = request.kind,
        database = request.database,
        table = request.kind === 'lineage' ? '' : request.table;
    const key = JSON.stringify([connectionId, kind, database, table]);
    const [revision, setRevision] = useState(0);
    const [state, setState] = useState<{
        key: string;
        snapshot?: NativeExplorerSnapshot;
        loading: boolean;
        error?: string;
    }>();
    useEffect(() => {
        if (!active) return;
        return startVisiblePolling(
            async signal => {
                setState(previous => ({
                    key,
                    snapshot: previous?.key === key ? previous.snapshot : undefined,
                    loading: true,
                }));
                try {
                    const snapshot = await requestNativeExplorer(
                        connectionId,
                        kind === 'lineage' ? { kind, database } : { kind, database, table },
                        signal,
                    );
                    if (!signal.aborted) setState({ key, snapshot, loading: false });
                } catch (error) {
                    if (!signal.aborted)
                        setState(previous => ({
                            key,
                            snapshot: previous?.key === key ? previous.snapshot : undefined,
                            loading: false,
                            error: message(error),
                        }));
                }
            },
            { intervalMs: live ? 5000 : undefined },
        );
    }, [connectionId, database, table, kind, key, active, live, revision]);
    const current = state?.key === key ? state : undefined;
    return {
        snapshot: active ? current?.snapshot : undefined,
        loading: active && (current?.loading ?? true),
        error: active ? current?.error : undefined,
        refresh: () => setRevision(value => value + 1),
    };
}
