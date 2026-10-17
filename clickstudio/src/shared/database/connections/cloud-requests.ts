import type { SqlFunctionInput, SqlFunctionDropInput } from '../functions/sql-functions.js';
import type { FlamegraphSource } from '../../queries/inspection/flamegraph.js';
import type { NativeExplorerRequest } from '../explorer/explorers.js';
import type { CreateTableColumn } from '../tables/create-table.js';
import type { QueryLogSource, WorkloadWindow } from '../explorer/activity/workload.js';
import type { TableBrowseRequest } from '../browse/table-browse.js';

export const CLOUD_ACTIONS = {
    functions: 'functions',
    executableFunctions: 'executable-functions',
    createFunction: 'create-function',
    dropFunction: 'drop-function',
    test: 'test',
    schema: 'schema',
    queryTree: 'query-tree',
    progress: 'progress',
    cancel: 'cancel',
    profile: 'profile',
    pipeline: 'pipeline',
    flamegraph: 'flamegraph',
    documentationSearch: 'documentation-search',
    documentationEntry: 'documentation-entry',
    nativeExplorer: 'native-explorer',
    tableParts: 'table-parts',
    tablePermissions: 'table-permissions',
    run: 'run',
    fullExport: 'full-export',
    browseTable: 'browse-table',
    workload: 'workload',
    replication: 'replication',
    createTable: 'create-table',
    dropTable: 'drop-table',
    dropDatabase: 'drop-database',
    importStatus: 'import-status',
    importCommit: 'import-commit',
} as const;
export type CloudAction = (typeof CLOUD_ACTIONS)[keyof typeof CLOUD_ACTIONS];
export type CloudCredentials = {
    host: string;
    database: string;
    username: string;
    password: string;
};

type QueryInput = { sql: string; parameters?: Record<string, string> };
type CloudRequestPayloads = {
    [CLOUD_ACTIONS.functions]: object;
    [CLOUD_ACTIONS.executableFunctions]: object;
    [CLOUD_ACTIONS.createFunction]: SqlFunctionInput;
    [CLOUD_ACTIONS.dropFunction]: SqlFunctionDropInput;
    [CLOUD_ACTIONS.test]: object;
    [CLOUD_ACTIONS.schema]: {
        databaseOffset?: number;
        tableOffset?: number;
        columnOffset?: number;
    };
    [CLOUD_ACTIONS.queryTree]: QueryInput;
    [CLOUD_ACTIONS.progress]: { queryId: string };
    [CLOUD_ACTIONS.cancel]: { queryId: string };
    [CLOUD_ACTIONS.profile]: { queryId: string; source: QueryLogSource };
    [CLOUD_ACTIONS.pipeline]: QueryInput;
    [CLOUD_ACTIONS.flamegraph]: {
        queryId: string;
        startDate: string;
        endDate: string;
        source: FlamegraphSource;
    };
    [CLOUD_ACTIONS.documentationSearch]: { query: string; category: string };
    [CLOUD_ACTIONS.documentationEntry]: { name: string; type: string; serverVersion?: string };
    [CLOUD_ACTIONS.nativeExplorer]: NativeExplorerRequest;
    [CLOUD_ACTIONS.tableParts]: { database: string; table: string };
    [CLOUD_ACTIONS.tablePermissions]: { database: string; table?: string };
    [CLOUD_ACTIONS.run]: QueryInput & { sessionId?: string; queryId?: string };
    [CLOUD_ACTIONS.fullExport]: QueryInput & { previewLimit?: string };
    [CLOUD_ACTIONS.browseTable]: TableBrowseRequest;
    [CLOUD_ACTIONS.workload]: { minutes: WorkloadWindow; source: QueryLogSource };
    [CLOUD_ACTIONS.replication]: object;
    [CLOUD_ACTIONS.createTable]: {
        database: string;
        name: string;
        columns: CreateTableColumn[];
        orderBy: string;
    };
    [CLOUD_ACTIONS.dropTable]: { database: string; table: string; confirmation: string };
    [CLOUD_ACTIONS.dropDatabase]: { database: string; confirmation: string };
    [CLOUD_ACTIONS.importStatus]: {
        queryId: string;
        table: string;
        rows: number;
        deduplicationToken?: string;
    };
};
type JsonCloudAction = Exclude<CloudAction, typeof CLOUD_ACTIONS.importCommit>;
export type CloudRequest = {
    [Action in JsonCloudAction]: {
        action: Action;
        credentials?: CloudCredentials;
    } & CloudRequestPayloads[Action];
}[JsonCloudAction];
