import { randomUUID } from 'node:crypto';
import type { ClickHouseClient } from '@clickhouse/client';
import type { TableBrowseRequest, TableBrowsePage } from '../../../shared/database/browse/table-browse.js';
import {
    BROWSE_PAGE_ROWS, BrowseValidationError, buildTableBrowseSql,
} from '../../../shared/database/browse/table-browse.js';
import { collectCompactStream } from './result-stream.js';
import { AppError } from '../../system/requests/errors.js';

const BROWSE_TIMEOUT_MS = 20_000;
const BROWSE_BYTES = 2_000_000;

/** Stateless, bounded table exploration. The original SQL run is never rewritten. */
export async function executeTableBrowse(
    client: Pick<ClickHouseClient, 'query' | 'exec'>,
    request: TableBrowseRequest,
    signal?: AbortSignal,
): Promise<TableBrowsePage> {
    const queryId = 'clickstudio-browse-' + randomUUID();
    const abort = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(BROWSE_TIMEOUT_MS)])
        : AbortSignal.timeout(BROWSE_TIMEOUT_MS);
    const settings = {
        readonly: '1' as const,
        max_execution_time: 18,
        max_threads: 2,
        max_memory_usage: '268435456',
        max_rows_to_read: '100000000',
        max_bytes_to_read: '2000000000',
        max_result_bytes: String(BROWSE_BYTES),
        result_overflow_mode: 'throw' as const,
    };
    const metadata = await client.query({
        query: 'SELECT name, type FROM system.columns WHERE database = {browseDb:String} ' +
            'AND table = {browseTable:String} ORDER BY position LIMIT 501',
        query_params: { browseDb: request.database, browseTable: request.table },
        format: 'JSONEachRow',
        abort_signal: abort,
        clickhouse_settings: { ...settings, max_result_rows: '501' },
    });
    const columns = await metadata.json<{ name: string; type: string }>();
    if (!columns.length)
        throw new BrowseValidationError('Table columns are unavailable for browsing.');
    const { sql, parameters } = buildTableBrowseSql(request, columns);
    const response = await client.exec({
        query: sql + '\nFORMAT JSONCompactEachRowWithNamesAndTypes',
        query_params: parameters,
        query_id: queryId,
        abort_signal: abort,
        clickhouse_settings: {
            ...settings,
            max_result_rows: '0',
            output_format_json_quote_64bit_integers: 1,
            output_format_json_quote_decimals: 1,
        },
    });
    const result = await collectCompactStream(response.stream, {
        rows: BROWSE_PAGE_ROWS + 1,
        bytes: BROWSE_BYTES,
    });
    if (result.truncated)
        throw new AppError(413, 'BROWSE_PAGE_TOO_WIDE',
            'This page exceeds 2 MB. Narrow the table query or inspect fewer rows.');
    return {
        columns: result.columns,
        rows: result.rows.slice(0, BROWSE_PAGE_ROWS),
        page: request.page,
        hasMore: result.rows.length > BROWSE_PAGE_ROWS,
        queryId,
        scope: 'live-table',
        warning: 'Live OFFSET pages are bounded to 25 pages. Duplicate sort values or table changes may overlap or skip rows.',
    };
}
