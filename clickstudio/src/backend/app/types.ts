import type { QueryDriver } from '../queries/execution/runs.js';
import { type ImportDriver } from '../database/imports/imports.js';
import { ClickHouseDriver } from '../database/clickhouse/client.js';

export type Driver = QueryDriver &
    ImportDriver &
    Pick<
        ClickHouseDriver,
        | 'connection'
        | 'connections'
        | 'test'
        | 'targets'
        | 'database'
        | 'createTable'
        | 'dropTable'
        | 'profileEvidence'
        | 'profilePipeline'
        | 'profileFlamegraph'
        | 'workload'
        | 'replication'
        | 'queryTree'
        | 'tableParts'
        | 'nativeExplorer'
        | 'searchDocumentation'
        | 'documentationEntry'
        | 'close'
    >;
