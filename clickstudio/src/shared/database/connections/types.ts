import type { QueryLogSource } from '../explorer/activity/workload.js';
import type { FlamegraphSource } from '../../queries/inspection/flamegraph.js';
import type { Limits } from '../../queries/execution/settings.js';

export type Capability = {
    available: boolean;
    reason?: string;
};

export interface Manifest {
    version: 1;
    serverVersion: string;
    testedAt: string;
    schema: Capability;
    progress: Capability;
    cancellation: Capability;
    explain: Capability;
    explainPlan?: Capability;
    explainAnalyze?: Capability;
    /** Server-side semantic tree produced by EXPLAIN QUERY TREE. */
    queryTree?: Capability;
    /** Trace symbolization form used for profiler samples. */
    traceLogSource?: FlamegraphSource;
    /**
     * Running EXPLAIN PIPELINE as a query is separate from loading structured pipeline evidence.
     */
    explainPipeline?: Capability;
    pipeline: Capability;
    queryLog: Capability;
    queryLogSource?: QueryLogSource;
    traceLog?: Capability;
    replication?: Capability;
    documentation: Capability;
    import: Capability;
    scripts: Capability;
    parameters: Capability;
}

export interface Connection {
    dataSource?: 'clickhouse' | 'fixture';
    id: string;
    name: string;
    host: string;
    database: string;
    username: string;
    readonly: boolean;
    limits: Limits;
    manifest?: Manifest;
}
