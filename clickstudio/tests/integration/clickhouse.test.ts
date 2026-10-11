import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@clickhouse/client';
import { loadConfig } from '../../src/backend/system/settings/config.js';
import { ClickHouseDriver } from '../../src/backend/database/clickhouse/client.js';
import { MemoryStore } from '../../src/backend/system/storage/store.js';
import { RunService } from '../../src/backend/queries/execution/runs.js';
const enabled = process.env.CLICKHOUSE_INTEGRATION === '1';
const owner = { id: 'integration-owner', role: 'owner' } as const;
test(
    'LIVE ClickHouse: typed values, bounds, scripts and explicit cancellation',
    { skip: !enabled },
    async t => {
        const config = loadConfig(),
            driver = new ClickHouseDriver(config),
            store = new MemoryStore();
        const service = new RunService(store, driver, (p, c) => driver.connection(p, c));
        t.after(async () => {
            await service.close();
            await driver.close();
        });
        const connectionId = config.profiles[0]!.id;
        service.trust(owner, connectionId, true);
        const connection = await driver.test(connectionId);
        assert.notEqual(connection.manifest?.serverVersion, 'unknown');
        assert.ok((await driver.schema(connectionId)).tables.length > 0);
        const input = (
            sql: string,
            limits?: {
                rows?: number;
                seconds?: number;
            },
        ) => ({ clientRequestId: randomUUID(), connectionId, sql, limits });
        const exact = service.submit(
            owner,
            input(
                "SELECT toUInt64('18446744073709551615') AS large, toDecimal128('12345678901234567890.12',2) AS decimal, CAST(NULL AS Nullable(String)) AS absent, ['a','b'] AS nested",
            ),
        );
        assert.equal((await service.wait(owner, exact.id)).status, 'succeeded');
        assert.deepEqual(service.result(owner, exact.id).rows[0], [
            '18446744073709551615',
            '12345678901234567890.12',
            null,
            ['a', 'b'],
        ]);
        const bounded = service.submit(
            owner,
            input('SELECT number FROM numbers(100)', { rows: 5 }),
        );
        assert.equal((await service.wait(owner, bounded.id)).status, 'truncated');
        assert.equal(service.result(owner, bounded.id).rows.length, 5);
        const slow = service.submit(
            owner,
            input('SELECT sum(sin(number)) FROM numbers(100000000)', { seconds: 10 }),
        );
        await service.cancel(owner, slow.id);
        assert.equal((await service.wait(owner, slow.id)).status, 'cancelled');
        const duplicate = input('SELECT 1');
        assert.equal(service.submit(owner, duplicate).id, service.submit(owner, duplicate).id);
    },
);

test(
    'LIVE ClickHouse: MergeTree CTAS copies every source column and row',
    { skip: !enabled },
    async () => {
        const config = loadConfig();
        const profile = config.profiles[0]!;
        const database = `\`${profile.database.replaceAll('`', '``')}\``;
        const suffix = randomUUID().replaceAll('-', '');
        const source = `${database}.\`clickstudio_copy_source_${suffix}\``;
        const target = `${database}.\`clickstudio_copy_target_${suffix}\``;
        const client = createClient({
            url: profile.url,
            username: process.env.CLICKHOUSE_ADMIN_USER ?? 'default',
            password: process.env.CLICKHOUSE_ADMIN_PASSWORD ?? '',
            request_timeout: 30_000,
        });
        try {
            await client.command({
                query: `CREATE TABLE ${source} (country String, place String, latitude Float64, longitude Float64) ENGINE = MergeTree ORDER BY country`,
            });
            await client.insert({
                table: source,
                format: 'JSONEachRow',
                values: [
                    { country: 'Poland', place: 'Warsaw', latitude: 52.2297, longitude: 21.0122 },
                    { country: 'Japan', place: 'Tokyo', latitude: 35.6762, longitude: 139.6503 },
                ],
            });
            await client.command({
                query: `CREATE TABLE ${target} ENGINE = MergeTree ORDER BY tuple() AS SELECT * FROM ${source}`,
            });
            const result = await client.query({
                query: `SELECT * FROM ${target} ORDER BY country`,
                format: 'JSONEachRow',
            });
            const rows = await result.json<Record<string, unknown>>();
            assert.deepEqual(rows, [
                { country: 'Japan', place: 'Tokyo', latitude: 35.6762, longitude: 139.6503 },
                { country: 'Poland', place: 'Warsaw', latitude: 52.2297, longitude: 21.0122 },
            ]);
        } finally {
            try {
                await Promise.all([
                    client.command({ query: `DROP TABLE IF EXISTS ${target}` }),
                    client.command({ query: `DROP TABLE IF EXISTS ${source}` }),
                ]);
            } finally {
                await client.close();
            }
        }
    },
);
