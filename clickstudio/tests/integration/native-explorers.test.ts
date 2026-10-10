import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../server/app.js';
import { loadConfig } from '../../server/config.js';
import { MemoryStore } from '../../core/store.js';

test('Native explorers require trust and validate bounded, fixed request types', async t => {
    const service = createApp(loadConfig({ DEMO_MODE: 'true' }), { store: new MemoryStore() });
    const server = service.app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const post = (path: string, body: unknown) =>
        fetch(`${origin}/api${path}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-clickstudio-intent': '1' },
            body: JSON.stringify(body),
        });
    t.after(async () => {
        await service.close();
        server.closeAllConnections();
        await new Promise<void>(resolve => server.close(() => resolve()));
    });
    const request = { kind: 'lineage', database: 'demo' };
    assert.equal((await post('/connections/demo/native-explorer', request)).status, 403);
    await post('/connections/demo/trust', { trusted: true, confirmation: 'demo' });
    for (const body of [
        { ...request, kind: 'sql' },
        { ...request, database: 'x'.repeat(129) },
        { kind: 'merges', database: 'demo' },
    ])
        assert.equal((await post('/connections/demo/native-explorer', body)).status, 400);
    for (const kind of ['lineage', 'merges', 'mutations']) {
        const response = await post('/connections/demo/native-explorer', {
            kind,
            database: 'demo',
            table: 'events',
        });
        assert.equal(response.status, 200);
        const snapshot = await response.json();
        assert.equal(snapshot.kind, kind);
        assert.equal(snapshot.source, 'fixture');
    }
    await post('/connections/demo/trust', { trusted: false, confirmation: 'demo' });
    assert.equal((await post('/connections/demo/native-explorer', request)).status, 403);
});

test(
    'LIVE ClickHouse: native metadata queries work with the configured reader',
    { skip: process.env.CLICKHOUSE_INTEGRATION !== '1' },
    async t => {
        const { ClickHouseDriver } = await import('../../server/clickhouse.js');
        const config = loadConfig(),
            driver = new ClickHouseDriver(config);
        t.after(() => driver.close());
        const connection = config.profiles[0]!;
        const schema = await driver.schema(connection.id);
        const table = schema.tables.find(
            item => item.database === connection.database && item.engine.endsWith('MergeTree'),
        );
        assert.ok(table, 'Integration setup includes a MergeTree table');
        const graph = await driver.nativeExplorer(connection.id, {
            kind: 'lineage',
            database: table.database,
        });
        assert.equal(graph.kind, 'lineage');
        assert.equal(graph.source, 'clickhouse');
        assert.equal(
            graph.notes.some(note => note.includes('Refresh telemetry is unavailable')),
            false,
        );
        for (const kind of ['merges', 'mutations'] as const) {
            const snapshot = await driver.nativeExplorer(connection.id, {
                kind,
                database: table.database,
                table: table.name,
            });
            assert.equal(snapshot.kind, kind);
            assert.equal(snapshot.source, 'clickhouse');
        }
    },
);
