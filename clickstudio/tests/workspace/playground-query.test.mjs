import test from 'node:test';
import assert from 'node:assert/strict';
import { PlaygroundError, queryPlayground } from '../../.workspace-build/web/playground.js';

test('Playground rejects output FORMAT with the exploration SQL message before sending a request', async () => {
    await assert.rejects(queryPlayground('SELECT 1 AS value FORMAT JSONEachRow'), error => {
        assert.ok(error instanceof PlaygroundError);
        assert.equal(error.code, 'READ_ONLY_SQL');
        assert.equal(error.message, 'FORMAT is not allowed in exploration SQL');
        return true;
    });
});
