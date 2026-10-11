import type { CloudRequest } from '../../src/shared/database/connections/cloud-requests.js';

const request = (input: CloudRequest) => input;
request({ action: 'run', sql: 'SELECT 1' });
request({ action: 'native-explorer', kind: 'lineage', database: 'default' });
request({ action: 'native-explorer', kind: 'merges', database: 'default', table: 'events' });
// @ts-expect-error Run requests require SQL.
request({ action: 'run' });
// @ts-expect-error Table explorers require a table.
request({ action: 'native-explorer', kind: 'merges', database: 'default' });
// @ts-expect-error Profile requests require a supported query-log source.
request({ action: 'profile', queryId: 'query-id', source: 'symbolized' });
// @ts-expect-error Imports use multipart requests.
request({ action: 'import-commit' });
// @ts-expect-error Unknown actions are not part of the request contract.
request({ action: 'unknown' });
