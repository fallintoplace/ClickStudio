import type { QueryDriver } from '../queries/execution/runs.js';
import { type ImportDriver } from '../database/imports/imports.js';
import type { ClickHouseDriver } from '../database/clickhouse/client.js';
import type { TableBrowseRequest, TableBrowsePage } from '../../shared/database/browse/table-browse.js';

export type Driver = { browseTable?: (id: string, input: TableBrowseRequest, signal?: AbortSignal) => Promise<TableBrowsePage> } &
    QueryDriver &
    ImportDriver &
    Pick<
        ClickHouseDriver,
        | 'connection'
        | 'executableFunctions'
        | 'connections'
        | 'test'
        | 'targets'
        | 'database'
        | 'tablePermissions'
        | 'createTable'
        | 'dropTable'
        | 'dropDatabase'
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
