import test from 'node:test';
import assert from 'node:assert/strict';
import { queryRows } from '../../api/cloud.js';
import {
    connectClickHouseCloud,
    disconnectClickHouseCloud,
} from '../../src/frontend/common/requests/sources/cloud-connection.js';

test('Cloud connections advertise their query budget while inspector requests keep their larger row cap', async t => {
    t.mock.method(globalThis, 'fetch', async () =>
        Response.json({ host: 'service.clickhouse.cloud:8443', serverVersion: '25.1' }),
    );
    t.after(() => disconnectClickHouseCloud());
    const connection = await connectClickHouseCloud({
        host: 'service.clickhouse.cloud:8443',
        database: 'default',
        username: 'reader',
        password: 'fixture-password',
    });
    assert.equal(connection.id, 'clickhouse-cloud');
    assert.deepEqual(connection.limits, {
        rows: 1000,
        bytes: 2000000,
        seconds: 45,
        memory: 536870912,
        threads: 4,
    });

    const requests: Array<{ clickhouse_settings?: Record<string, unknown> }> = [];
    const client = {
        async query(options: { clickhouse_settings?: Record<string, unknown> }) {
            requests.push(options);
            return { json: async () => [] };
        },
    } as unknown as Parameters<typeof queryRows>[0];
    await queryRows(client, 'SELECT name FROM system.tables');
    const defaults = requests[0]?.clickhouse_settings;
    assert.equal(defaults?.max_result_rows, '2000');
    assert.equal(defaults?.max_result_bytes, String(connection.limits.bytes));
    assert.equal(defaults?.max_execution_time, connection.limits.seconds);
    assert.equal(defaults?.max_threads, connection.limits.threads);
    assert.equal(defaults?.result_overflow_mode, 'throw');

    await queryRows(client, 'SELECT name FROM system.documentation', {}, 12_000, 10, 6_000);
    assert.equal(requests[1]?.clickhouse_settings?.max_result_rows, '6000');
    assert.equal(requests[1]?.clickhouse_settings?.max_execution_time, 10);
    assert.equal(requests[1]?.clickhouse_settings?.max_result_bytes, '2000000');
});
