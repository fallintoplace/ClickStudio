import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import type { ClickHouseClient } from '@clickhouse/client';
import { executeTableBrowse } from '../../src/backend/database/clickhouse/table-browse.js';
import type { TableBrowseRequest } from '../../src/shared/database/browse/table-browse.js';

const request: TableBrowseRequest = {
    database: 'analytics',
    table: 'events',
    orderColumn: 'id',
    direction: 'asc',
    page: 1,
    filterColumn: 'event',
    filterValue: "can't",
};
test('table browser returns exactly 200 rows with a lookahead and bound SQL parameters', async () => {
    const statements: Array<Record<string, unknown>> = [];
    const client = {
        async query(options: Record<string, unknown>) {
            statements.push(options);
            return {
                json: async () => [
                    { name: 'id', type: 'UInt64' },
                    { name: 'event', type: 'String' },
                ],
            };
        },
        async exec(options: Record<string, unknown>) {
            statements.push(options);
            return {
                stream: Readable.from([
                    JSON.stringify(['id', 'event']) + '\n',
                    JSON.stringify(['UInt64', 'String']) + '\n',
                    ...Array.from(
                        { length: 201 },
                        (_, i) => JSON.stringify([String(i), 'safe']) + '\n',
                    ),
                ]),
            };
        },
    };
    const page = await executeTableBrowse(
        client as unknown as Pick<ClickHouseClient, 'query' | 'exec'>,
        request,
    );
    assert.equal(page.rows.length, 200);
    assert.equal(page.hasMore, true);
    assert.equal(page.page, 1);
    assert.equal(page.scope, 'live-table');
    assert.match(String(statements[1]?.query), /LIMIT 201 OFFSET 200/);
    assert.doesNotMatch(String(statements[1]?.query), /can't/);
    assert.deepEqual(statements[1]?.query_params, { browseValue: "can't" });
    assert.equal(
        (statements[1]?.clickhouse_settings as Record<string, unknown>).max_memory_usage,
        '268435456',
    );
    assert.equal((statements[1]?.clickhouse_settings as Record<string, unknown>).readonly, '1');
});
test('table browser rejects SQL requests for missing sort columns', async () => {
    const client = {
        async query() {
            return { json: async () => [{ name: 'id', type: 'UInt64' }] };
        },
        async exec() {
            throw new Error('Must not execute unverified SQL');
        },
    };
    await assert.rejects(
        () =>
            executeTableBrowse(client as unknown as Pick<ClickHouseClient, 'query' | 'exec'>, {
                ...request,
                orderColumn: 'unverified',
            }),
        /sort column/,
    );
});
