import test from 'node:test';
import assert from 'node:assert/strict';
import { assistantRequestFrom } from '../../.core-build/src/backend/assistant/context/input.js';
import { MAX_SQL_CHARS } from '../../.core-build/src/shared/queries/execution/limits.js';

test('Assistant requests keep ordinary chat as the default action', () => {
    assert.deepEqual(assistantRequestFrom(undefined, undefined), { action: 'ask' });
    assert.deepEqual(assistantRequestFrom('ask', undefined), { action: 'ask' });
});

test('Repair requests carry SQL and errors without a retained run', () => {
    const repair = { sql: 'SELECT missing FROM demo.events', error: '[47] Unknown column missing' };
    assert.deepEqual(assistantRequestFrom('repair', repair), { action: 'repair', repair });
});

test('Repair requests reject missing, malformed and oversized failure context', () => {
    for (const repair of [
        undefined,
        null,
        [],
        {},
        { sql: '', error: 'Error' },
        { sql: 'SELECT 1', error: '' },
        { sql: 1, error: 'Error' },
        { sql: 'SELECT 1', error: {} },
        { sql: 'x'.repeat(MAX_SQL_CHARS + 1), error: 'Error' },
        { sql: 'SELECT 1', error: 'x'.repeat(3_001) },
    ])
        assert.throws(
            () => assistantRequestFrom('repair', repair),
            error => error.code === 'INVALID_REQUEST',
        );
});

test('The chat endpoint rejects unsupported actions', () => {
    for (const action of ['review', 'constructor', '__proto__', null, 1, {}])
        assert.throws(
            () => assistantRequestFrom(action, { sql: 'SELECT 1', error: 'Error' }),
            error => error.code === 'INVALID_REQUEST',
        );
});
