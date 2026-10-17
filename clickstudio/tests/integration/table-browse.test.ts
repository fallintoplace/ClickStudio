import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createClient } from '@clickhouse/client';
import { isRecord } from '../../src/shared/common/values.js';
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
    const client = createClient({ url: 'http://127.0.0.1:8123' });
    Object.defineProperty(client, 'query', {
        value: async (options: unknown) => {
            if (isRecord(options)) statements.push(options);
            return {
                json: async () => [
                    { name: 'id', type: 'UInt64' },
                    { name: 'event', type: 'String' },
                ],
            };
        },
    });
    Object.defineProperty(client, 'exec', {
        value: async (options: unknown) => {
            if (isRecord(options)) statements.push(options);
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
    });
    const page = await executeTableBrowse(client, request);
    await client.close();
    assert.equal(page.rows.length, 200);
    assert.equal(page.hasMore, true);
    assert.equal(page.page, 1);
    assert.equal(page.scope, 'live-table');
    assert.equal(page.totalColumns, 2);
    assert.equal(page.columnStart, 0);
    assert.match(page.draftSql, /LIMIT 200 OFFSET 200$/);
    assert.match(String(statements[1]?.query), /LIMIT 201 OFFSET 200/);
    assert.doesNotMatch(String(statements[1]?.query), /can't/);
    assert.deepEqual(statements[1]?.query_params, { browseValue: "can't" });
    const settings = statements[1]?.clickhouse_settings;
    assert.ok(isRecord(settings));
    assert.equal(settings.max_memory_usage, '268435456');
    assert.equal(settings.readonly, '1');
});
test('table browser rejects SQL requests for missing sort columns', async () => {
    const client = createClient({ url: 'http://127.0.0.1:8123' });
    Object.defineProperty(client, 'query', {
        value: async () => ({ json: async () => [{ name: 'id', type: 'UInt64' }] }),
    });
    Object.defineProperty(client, 'exec', {
        value: async () => {
            throw new Error('Must not execute unverified SQL');
        },
    });
    await assert.rejects(
        () => executeTableBrowse(client, { ...request, orderColumn: 'unverified' }),
        /sort column/,
    );
    await client.close();
});

test('table browser fetches only the selected column window from ClickHouse', async () => {
    const columns = Array.from({ length: 14 }, (_, index) => ({
        name: 'col_' + index,
        type: 'String',
    }));
    const client = createClient({ url: 'http://127.0.0.1:8123' });
    let executed = '';
    Object.defineProperty(client, 'query', {
        value: async () => ({ json: async () => columns }),
    });
    Object.defineProperty(client, 'exec', {
        value: async (options: { query: string }) => {
            executed = options.query;
            return {
                stream: Readable.from([
                    '["col_12","col_13"]\n',
                    '["String","String"]\n',
                    '["visible","also visible"]\n',
                ]),
            };
        },
    });
    const page = await executeTableBrowse(client, {
        database: 'analytics',
        table: 'events',
        orderColumn: 'col_0',
        direction: 'asc',
        page: 0,
        columnStart: 12,
    });
    await client.close();
    assert.match(executed, /^SELECT `col_12`, `col_13` FROM/);
    assert.doesNotMatch(executed, /SELECT \*/);
    assert.equal(page.totalColumns, 14);
    assert.equal(page.columnStart, 12);
    assert.deepEqual(page.rows, [['visible', 'also visible']]);
    assert.deepEqual(page.columns, columns.slice(12));
    assert.match(page.draftSql, /^SELECT `col_12`, `col_13` FROM/);
});
