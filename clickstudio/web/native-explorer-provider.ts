import {
    loadNativeExplorer,
    type NativeExplorerRequest,
    type NativeExplorerSnapshot,
} from '../shared/native-explorers';
import { api, isFrontendDemoPreview } from './api';
import {
    CLICKHOUSE_CLOUD_CONNECTION_ID,
    loadClickHouseCloudNativeExplorer,
} from './cloud-connection';
import { PLAYGROUND_CONNECTION_ID, queryPlaygroundWithParams } from './playground';

export function requestNativeExplorer(
    connectionId: string,
    request: NativeExplorerRequest,
    signal: AbortSignal,
): Promise<NativeExplorerSnapshot> {
    if (connectionId === CLICKHOUSE_CLOUD_CONNECTION_ID)
        return loadClickHouseCloudNativeExplorer(request, signal);
    if (isFrontendDemoPreview && connectionId === PLAYGROUND_CONNECTION_ID)
        return loadNativeExplorer(
            request,
            async (sql, parameters) => {
                const response = await queryPlaygroundWithParams(sql, parameters, signal);
                if (response.truncated)
                    throw new Error(
                        'The metadata response exceeded the Playground limit. Select a smaller database or table.',
                    );
                return response.rows.map(row =>
                    Object.fromEntries(
                        response.columns.map((column, index) => [column.name, row[index]]),
                    ),
                );
            },
            signal,
        );
    return api<NativeExplorerSnapshot>(
        `/connections/${encodeURIComponent(connectionId)}/native-explorer`,
        { method: 'POST', body: request, signal },
    );
}
