import type { ReplicationSnapshot } from '../shared/replication';
import type { WorkloadSnapshot, WorkloadWindow } from '../shared/workload';
import { api } from './api';
import { CLICKHOUSE_CLOUD_CONNECTION_ID, loadClickHouseCloudReplication, loadClickHouseCloudWorkload } from './cloud-connection';

export function loadWorkload(connectionId: string, minutes: WorkloadWindow, signal: AbortSignal) {
    if (connectionId === CLICKHOUSE_CLOUD_CONNECTION_ID) return loadClickHouseCloudWorkload(minutes, signal);
    return api<WorkloadSnapshot>(`/connections/${encodeURIComponent(connectionId)}/workload?minutes=${minutes}`, { signal });
}

export function loadReplication(connectionId: string, signal: AbortSignal) {
    if (connectionId === CLICKHOUSE_CLOUD_CONNECTION_ID) return loadClickHouseCloudReplication(signal);
    return api<ReplicationSnapshot>(`/connections/${encodeURIComponent(connectionId)}/replication`, { signal });
}
