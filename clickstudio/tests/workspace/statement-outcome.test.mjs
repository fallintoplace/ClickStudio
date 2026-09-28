import test from 'node:test';
import assert from 'node:assert/strict';
import { statementOutcome } from '../../.workspace-build/web/statement-outcome.js';

function run(sql, overrides = {}) {
    return { sql, rowCount: 0, columns: [], writtenRows: undefined, ...overrides };
}

test('An empty SELECT reports returned rows when its result columns exist', () => {
    assert.equal(statementOutcome(run('SELECT value FROM events', { columns: [{ name: 'value', type: 'UInt64' }] })), '0 rows returned');
});

test('An INSERT uses the known write count instead of the empty result count', () => {
    assert.equal(statementOutcome(run('INSERT INTO events VALUES (1), (2)', { writtenRows: 2 })), 'INSERT completed · 2 rows written');
});

test('An INSERT says when the write count is unavailable', () => {
    assert.equal(statementOutcome(run('INSERT INTO events SELECT * FROM source')), 'INSERT completed · row count unavailable');
});

test('A DELETE does not treat ClickHouse written_rows as affected rows', () => {
    assert.equal(statementOutcome(run('DELETE FROM events WHERE value = 1', { writtenRows: 0 })), 'DELETE completed');
});

test('A CREATE with no result set reports statement completion', () => {
    assert.equal(statementOutcome(run('CREATE TABLE events (value UInt64)', { writtenRows: 0 })), 'CREATE completed');
});

test('A commented statement still reports its command outcome', () => {
    assert.equal(statementOutcome(run('-- create an events table\nCREATE TABLE events (value UInt64)')), 'CREATE completed');
});
