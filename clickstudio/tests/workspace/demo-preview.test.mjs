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
