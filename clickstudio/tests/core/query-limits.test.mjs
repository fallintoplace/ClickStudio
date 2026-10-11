import test from 'node:test';
import assert from 'node:assert/strict';
import { runRequest } from '../../.core-build/src/backend/system/requests/validation.js';
import { fixture, owner, until } from './helpers.mjs';

test('SQL validation accepts 200,000 characters even when UTF-8 requires more bytes', () => {
    const sql = "SELECT '" + 'é'.repeat(199_991) + "'";
    assert.equal(sql.length, 200_000);
    assert.ok(Buffer.byteLength(sql) > 200_000);
    const input = {
        clientRequestId: 'request',
        connectionId: 'local',
        sql,
        sourceFrom: 0,
        sourceTo: sql.length,
    };
    assert.equal(runRequest(input).sql, sql);
    assert.equal(runRequest(input).sourceTo, 200_000);
    assert.throws(() => runRequest({ ...input, sql: sql + ' ' }), { code: 'INVALID_REQUEST' });
    assert.throws(() => runRequest({ ...input, sourceTo: 200_001 }), { code: 'INVALID_REQUEST' });
});

test('Result pages accept 1,000 rows and reject larger counts', async t => {
    const f = fixture({
        execute: async () => ({
            columns: [{ name: 'value', type: 'String' }],
            rows: Array.from({ length: 450 }, (_, index) => [String(index)]),
            truncated: false,
        }),
    });
    t.after(() => f.runs.close());
    const run = f.runs.submit(owner, f.request());
    await f.runs.wait(owner, run.id);
    assert.equal(f.runs.page(owner, run.id, 0, 1_000).rows.length, 450);
    const first = f.runs.page(owner, run.id);
    assert.equal(first.rows.length, 200);
    assert.equal(first.nextOffset, 200);
    const second = f.runs.page(owner, run.id, first.nextOffset);
    assert.equal(second.rows.length, 200);
    assert.deepEqual(second.rows[0], ['200']);
    assert.equal(second.nextOffset, 400);
    for (const count of [0, 1_001, 1.5, NaN])
        assert.throws(() => f.runs.page(owner, run.id, 0, count), { code: 'INVALID_PAGE' });
});

test('Scripts accept 50 statements and reject the 51st before executing', async t => {
    const f = fixture();
    t.after(() => f.runs.close());
    const sql = Array.from({ length: 50 }, () => 'SELECT 1;').join('\n');
    assert.throws(() => f.runs.submitScript(owner, f.request({ sql: sql + '\nSELECT 1;' })), {
        code: 'SCRIPT_SIZE',
    });
    assert.equal(f.calls.length, 0);
    const script = f.runs.submitScript(owner, f.request({ sql }));
    assert.equal(script.statements.length, 50);
    await until(() => f.runs.getScript(owner, script.id).status === 'succeeded');
    assert.equal(f.calls.length, 50);
});
