/** Deterministic LIVE SQL fixture evaluation. Not a benchmark of model quality. */
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/backend/system/settings/config.js';
import { ClickHouseDriver } from '../src/backend/database/clickhouse/client.js';
import { MemoryStore } from '../src/backend/system/storage/store.js';
import { RunService } from '../src/backend/queries/execution/runs.js';
const cases = [
    {
        name: 'calendar bucketing',
        sql: "SELECT toDate(toStartOfMonth(toDate('2024-02-29'))) AS bucket",
        rows: [['2024-02-01']],
    },
    {
        name: 'nullable aggregation',
        sql: 'SELECT count(x), sum(x) FROM (SELECT CAST(NULL AS Nullable(UInt64)) AS x UNION ALL SELECT 7)',
        rows: [['1', '7']],
    },
    {
        name: 'array values',
        sql: 'SELECT arrayMap(x -> x*2, [1,2,3]) AS doubled',
        rows: [[[2, 4, 6]]],
    },
    {
        name: 'UInt64 precision',
        sql: "SELECT toUInt64('18446744073709551615')",
        rows: [['18446744073709551615']],
    },
];
const config = loadConfig();
if (config.demo) throw new Error('Evaluations require live ClickHouse, never demo fixtures');
const driver = new ClickHouseDriver(config),
    runs = new RunService(new MemoryStore(), driver, (p, c) => driver.connection(p, c));
const owner = { id: 'evaluation-owner', role: 'owner' } as const,
    connectionId = config.profiles[0]!.id;
let failed = 0;
try {
    runs.trust(owner, connectionId, true);
    await driver.test(connectionId);
    for (const fixture of cases) {
        try {
            const run = runs.submit(owner, {
                clientRequestId: randomUUID(),
                connectionId,
                sql: fixture.sql,
            });
            const finished = await runs.wait(owner, run.id);
            assert.equal(finished.status, 'succeeded');
            assert.deepEqual(runs.result(owner, run.id).rows, fixture.rows);
            console.log('PASS', fixture.name);
        } catch {
            failed++;
            console.error('FAIL', fixture.name);
        }
    }
} finally {
    await runs.close();
    await driver.close();
}
process.exitCode = failed ? 1 : 0;
