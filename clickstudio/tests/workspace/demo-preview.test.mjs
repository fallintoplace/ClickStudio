import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoPreviewApi } from '../../.workspace-build/web/demo-preview.js';

test('Static preview scripts keep semicolons inside strings and comments', async () => {
    const api = new DemoPreviewApi();
    const sql =
        "SELECT 'first;value' AS label;\n-- the ; here is a comment\nSELECT 2 /* and ; this is a block comment */";
    const script = await api.request('/scripts', { method: 'POST', body: { sql } });

    assert.equal(script.statements.length, 2);
    assert.deepEqual(
        script.statements.map(statement => statement.sql),
        [
            "SELECT 'first;value' AS label",
            '-- the ; here is a comment\nSELECT 2 /* and ; this is a block comment */',
        ],
    );
    for (const statement of script.statements)
        assert.equal(sql.slice(statement.from, statement.to), statement.sql);
});

test('New offline examples reopen with fixture rows matching their result columns', async () => {
    const api = new DemoPreviewApi();
    const documents = await api.request('/documents?connectionId=demo');
    const byId = new Map(documents.map(document => [document.id, document]));
    const cases = [
        ['preview-starter-monthly-revenue', ['month', 'completed_orders', 'revenue']],
        [
            'preview-starter-channel-conversion',
            ['channel', 'sessions', 'conversions', 'conversion_rate_pct'],
        ],
        [
            'preview-starter-signup-cohorts',
            ['cohort_month', 'plan', 'new_users', 'average_lifetime_value'],
        ],
        [
            'preview-starter-product-page-conversion',
            ['page_path', 'page_views', 'purchasers', 'conversion_rate_pct'],
        ],
    ];

    for (const [id, expectedColumns] of cases) {
        const document = byId.get(id);
        assert.ok(document, `missing offline example ${id}`);
        assert.ok(document.runId, `${id} should retain a sample run`);
        const result = await api.request(`/runs/${document.runId}/result?count=100`);
        assert.deepEqual(
            result.columns.map(column => column.name),
            expectedColumns,
        );
        assert.ok(result.rows.length > 0, `${id} should have sample rows`);
    }
});

test('Sample EXPLAIN ANALYZE is retained as a fixture result and never evaluates submitted SQL', async () => {
    const api = new DemoPreviewApi();
    const run = await api.request('/runs', {
        method: 'POST',
        body: { connectionId: 'demo', kind: 'analyze', sql: 'SELECT fixture_error()' },
    });
    assert.equal(run.kind, 'analyze');
    const result = await api.request(`/runs/${run.id}/result?count=10`);
    assert.match(result.rows[0][0], /Query summary:/);
    assert.match(run.warnings.join(' '), /do not evaluate the SQL/i);
});

test('Sample MergeTree parts are partitioned and unavailable for unknown tables', async () => {
    const api = new DemoPreviewApi();
    const snapshot = await api.request('/connections/demo/table-parts', {
        method: 'POST',
        body: { database: 'demo', table: 'events' },
    });
    assert.equal(snapshot.database, 'demo');
    assert.equal(snapshot.table, 'events');
    assert.equal(snapshot.parts.length, 42);
    assert.equal(new Set(snapshot.parts.map(part => part.partition)).size, 6);
    assert.equal(snapshot.totalParts, '42');
    assert.equal(snapshot.activeParts, '36');
    assert.equal(snapshot.inactiveParts, '6');
    assert.equal(
        snapshot.parts.some(part => !part.active),
        true,
    );
    assert.ok(
        snapshot.parts.every(
            part => part.diskName === 'default' && part.minBlockNumber && part.maxBlockNumber,
        ),
    );
    assert.equal(snapshot.truncated, false);
    await assert.rejects(
        api.request('/connections/demo/table-parts', {
            method: 'POST',
            body: { database: 'demo', table: 'daily_rollup' },
        }),
    );
});

test('Static routing preserves method guards, decoded paths, and unknown-route fallbacks', async () => {
    const api = new DemoPreviewApi();
    for (const [path, method] of [
        ['/connections/demo/trust', 'GET'],
        ['/connections/demo/table-parts', 'GET'],
        ['/connections/demo/native-explorer', 'GET'],
        ['/connections/demo/query-tree', 'GET'],
        ['/connections/unknown/schema', 'GET'],
        ['/connections/clickhouse-cloud/schema', 'POST'],
        ['/connections/clickhouse-cloud/documentation', 'POST'],
        ['/scripts', 'GET'],
        ['/runs', 'DELETE'],
        ['/documents/missing/unknown', 'GET'],
        ['/unknown', 'GET'],
        ['/%73ession', 'GET'],
    ])
        assert.deepEqual(await api.request(path, { method }), {}, `${method} ${path}`);
    assert.equal((await api.request('/session/', { method: 'DELETE' })).demo, true);
    assert.equal(
        (await api.request('/connections/demo/schema', { method: 'POST' })).connectionId,
        'demo',
    );
    assert.deepEqual(await api.request('/connections/demo/import-targets', { method: 'DELETE' }), [
        'demo.interview_imports',
    ]);
    assert.deepEqual(await api.request('/connections/playground/import-targets'), []);
    assert.equal((await api.request('/connections//%64emo/schema/')).connectionId, 'demo');
});

test('Static routing keeps trust and provider errors ahead of request validation', async () => {
    const api = new DemoPreviewApi();
    await api.request('/connections/demo/trust', { method: 'POST', body: { trusted: false } });
    await assert.rejects(
        api.request('/connections/demo/native-explorer', {
            method: 'POST',
            body: {},
        }),
        /Trust this connection/,
    );
    await api.request('/connections/demo/trust', { method: 'POST', body: { trusted: true } });
    await assert.rejects(
        api.request('/connections/demo/native-explorer', {
            method: 'POST',
            body: {},
        }),
        /A database is required/,
    );
    await assert.rejects(api.request('/connections/demo/workload?minutes=99'), /minutes must be/);
    await assert.rejects(
        api.request('/connections/playground/workload'),
        /Observability system-table access/,
    );
    await assert.rejects(
        api.request('/connections/playground/query-tree', {
            method: 'POST',
            body: { sql: 'SELECT 1', parameters: { n: '1' } },
        }),
        /Remove query parameters/,
    );
    await assert.rejects(
        api.request('/connections/clickhouse-cloud/documentation/search'),
        /Reconnect to ClickHouse Cloud/,
    );
});

test('Cancelled static requests stop before changing documents or connection trust', async () => {
    const api = new DemoPreviewApi();
    await api.request('/connections/demo/trust', { method: 'POST', body: { trusted: false } });
    const before = await api.request('/documents');
    const controller = new AbortController();
    const reason = new Error('Cancelled before dispatch');
    controller.abort(reason);
    for (const [path, body] of [
        ['/documents', { name: 'Cancelled document', sql: 'SELECT 2' }],
        ['/connections/demo/trust', { trusted: true }],
    ])
        await assert.rejects(
            api.request(path, {
                method: 'POST',
                body,
                signal: controller.signal,
            }),
            error => error === reason,
        );
    assert.deepEqual(await api.request('/documents'), before);
    assert.equal((await api.request('/connections'))[0].trusted, false);
});

test('Static saved versions preserve revision conflicts and trash restoration', async () => {
    const api = new DemoPreviewApi();
    const first = await api.request('/documents', {
        method: 'POST',
        body: { name: 'Versioned', sql: 'SELECT 1', connectionId: 'demo' },
    });
    const second = await api.request(`/documents/${first.id}`, {
        method: 'PUT',
        body: {
            name: 'Versioned',
            sql: 'SELECT 2',
            connectionId: 'demo',
            baseRevision: first.revision,
        },
    });
    await assert.rejects(
        api.request(`/documents/${first.id}/restore-revision`, {
            method: 'POST',
            body: { revision: first.revision, baseRevision: first.revision },
        }),
        /A newer version exists/,
    );
    await assert.rejects(
        api.request(`/documents/${first.id}/restore-revision`, {
            method: 'POST',
            body: { revision: 0, baseRevision: second.revision },
        }),
        /Choose a valid saved version/,
    );
    const restored = await api.request(`/documents/${first.id}/restore-revision`, {
        method: 'POST',
        body: { revision: first.revision, baseRevision: second.revision },
    });
    assert.equal(restored.sql, first.sql);
    assert.equal(restored.revision, second.revision + 1);
    await api.request(`/documents/${first.id}`, { method: 'DELETE' });
    assert.ok((await api.request('/documents?trash=true')).some(item => item.id === first.id));
    await api.request(`/documents/${first.id}/restore`, { method: 'POST' });
    assert.ok(
        (await api.request('/documents')).some(item => item.id === first.id && !item.deletedAt),
    );
    assert.deepEqual(
        (await api.request(`/documents/${first.id}/revisions`)).map(item => item.revision),
        [3, 2, 1],
    );
});

test('Static import commits once and rejects duplicate or unknown mappings', async () => {
    const api = new DemoPreviewApi();
    const preview = await api.request('/imports/preview', {
        method: 'POST',
        body: { name: 'events.csv', format: 'csv', source: 'day,events\n2026-10-10,2' },
    });
    for (const fields of [{ day: 'day', events: 'day' }, { missing: 'day' }, { day: 'unknown' }])
        await assert.rejects(
            api.request(`/imports/${preview.id}/mapping`, {
                method: 'POST',
                body: { connectionId: 'demo', table: 'demo.interview_imports', fields },
            }),
            /mapped once|unknown source/,
        );
    const mapping = await api.request(`/imports/${preview.id}/mapping`, {
        method: 'POST',
        body: {
            connectionId: 'demo',
            table: 'demo.interview_imports',
            fields: { day: 'day', events: 'events' },
        },
    });
    const first = await api.request(`/imports/${mapping.id}/commit`, { method: 'POST' });
    const second = await api.request(`/imports/${mapping.id}/commit`, { method: 'POST' });
    assert.deepEqual(second, first);
    assert.equal(first.rows, 1);
    assert.equal(first.status, 'succeeded');
    const schema = await api.request('/connections/demo/schema');
    assert.equal(schema.tables.find(table => table.name === 'interview_imports').rowEstimate, '1');
    await api.request(`/imports/${preview.id}`, { method: 'DELETE' });
    await assert.rejects(
        api.request(`/imports/${mapping.id}/commit`, { method: 'POST' }),
        /Mapping not found/,
    );
    assert.deepEqual(
        await api.request(`/imports/${first.id}/reconcile`, { method: 'POST' }),
        first,
    );
});

function previewStorage(t) {
    const values = new Map();
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: key => values.get(key) ?? null,
            setItem: (key, value) => values.set(key, value),
        },
    });
    t.after(() => {
        if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
        else delete globalThis.localStorage;
    });
    return values;
}

test('Static preview restores saved execution and document history after invalid entries', async t => {
    const storage = previewStorage(t);
    const api = new DemoPreviewApi();
    const run = await api.request('/runs', { method: 'POST', body: { sql: 'SELECT 7' } });
    const document = await api.request('/documents', {
        method: 'POST',
        body: { name: 'Retained', sql: 'SELECT 7', connectionId: 'demo', runId: run.id },
    });
    await api.request(`/documents/${document.id}`, { method: 'DELETE' });
    const [key, value] = [...storage.entries()][0];
    const state = JSON.parse(value);
    state.sequence = 0;
    state.runs.unshift(null, {});
    state.results.unshift(null, {});
    state.scripts.unshift(null, {});
    state.documents.unshift(null, {});
    state.revisions.unshift(null, ['invalid', {}], ['invalid', [null, { revision: -1 }]]);
    storage.set(key, JSON.stringify(state));
    const reopened = new DemoPreviewApi();
    assert.equal((await reopened.request(`/runs/${run.id}`)).sql, run.sql);
    assert.ok((await reopened.request(`/runs/${run.id}/result`)).rows.length);
    assert.ok(
        (await reopened.request('/documents?trash=true')).some(item => item.id === document.id),
    );
    assert.equal(
        (await reopened.request(`/documents/${document.id}/revisions`))[0].sql,
        document.sql,
    );
    const next = await reopened.request('/runs', { method: 'POST', body: { sql: 'SELECT 8' } });
    assert.ok(next.sequence > run.sequence);
});

test('Static preview expires restored Playground results without losing run history', async t => {
    const storage = previewStorage(t);
    const api = new DemoPreviewApi();
    const run = await api.request('/runs', { method: 'POST', body: { sql: 'SELECT 7' } });
    const [key, value] = [...storage.entries()][0];
    const state = JSON.parse(value);
    const storedRun = state.runs.find(item => item.id === run.id);
    storedRun.connectionId = 'playground';
    storedRun.resultState = 'reopenable';
    state.results.find(item => item.runId === run.id).expiresAt = '2000-01-01T00:00:00.000Z';
    storage.set(key, JSON.stringify(state));
    const reopened = new DemoPreviewApi();
    assert.equal((await reopened.request(`/runs/${run.id}`)).resultState, 'expired');
    await assert.rejects(reopened.request(`/runs/${run.id}/result`), /no longer available/);
    assert.ok(
        (await reopened.request('/runs?connectionId=playground')).some(item => item.id === run.id),
    );
});
