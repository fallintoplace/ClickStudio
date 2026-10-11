import test from 'node:test';
import assert from 'node:assert/strict';
import { documentFailureNotice } from '../../.workspace-build/src/frontend/workspace/layout/notifications/workspace-notification-policy.js';

for (const operation of ['save', 'restore']) {
    test(`${operation} rejection preserves the draft and uses a timed error`, () => {
        for (const status of [400, 401, 403, 404, 422, 429]) {
            const notice = documentFailureNotice('query.sql', operation, { status });
            assert.equal(notice.tone, 'error');
            assert.equal(notice.timeoutMs, 8000);
            assert.match(notice.message, /Your edits are still in the draft/);
            assert.ok(notice.message.includes('query.sql'));
        }
    });

    test(`${operation} response loss does not claim the write failed`, () => {
        for (const error of [{}, { status: 408 }, { status: 500 }, { status: 503 }]) {
            const notice = documentFailureNotice('query.sql', operation, error);
            assert.equal(notice.tone, 'warning');
            assert.equal(notice.timeoutMs, null);
            assert.match(notice.message, /Couldn’t confirm/);
        }
    });

    test(`${operation} revision conflict stays visible with a recovery instruction`, () => {
        const notice = documentFailureNotice('query.sql', operation, {
            status: 409,
            code: 'REVISION_CONFLICT',
        });
        assert.equal(notice.tone, 'warning');
        assert.equal(notice.timeoutMs, null);
        assert.match(notice.message, /changed elsewhere/);
        assert.match(notice.message, /Review the latest version/);
    });
}
