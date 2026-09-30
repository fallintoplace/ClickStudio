import test from 'node:test';
import assert from 'node:assert/strict';
import { queryRows } from '../../api/cloud.ts';

test('Cloud reference queries raise the row cap without changing other inspector queries', async () => {
    const settings: Array<{ clickhouse_settings?: { max_result_rows?: string; max_result_bytes?: string } }> = [];
    const client = {
        async query(options: { clickhouse_settings?: { max_result_rows?: string; max_result_bytes?: string } }) {
            settings.push(options);
            return { json: async () => [] };
        },
    } as unknown as Parameters<typeof queryRows>[0];

    await queryRows(client, 'SELECT name FROM system.tables');
    await queryRows(client, 'SELECT name, type FROM system.documentation', {}, 12_000, 10, 6_000);

    assert.equal(settings[0]?.clickhouse_settings?.max_result_rows, '2000');
    assert.equal(settings[1]?.clickhouse_settings?.max_result_rows, '6000');
    assert.equal(settings[1]?.clickhouse_settings?.max_result_bytes, '2000000');
});
