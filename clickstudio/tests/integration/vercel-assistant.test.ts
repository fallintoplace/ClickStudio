import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../../api/assistant/sql.js';

const endpoint = 'https://clickstudio.example/api/assistant/sql';

function request(body: unknown, headers: Record<string, string> = {}) {
    return new Request(endpoint, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            origin: 'https://clickstudio.example',
            'x-clickstudio-intent': '1',
            'x-real-ip': '192.0.2.20',
            ...headers,
        },
        body: JSON.stringify(body),
    });
}

test('Vercel SQL generation requires a same-origin workspace request', async () => {
    const prior = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = '';
    try {
        const response = await handler.fetch(request({}, { origin: 'https://other.example' }));
        assert.equal(response.status, 403);
        assert.equal((await response.json() as { error: { code: string } }).error.code, 'ORIGIN');
    } finally {
        if (prior === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = prior;
    }
});

test('Vercel SQL generation reports a missing server-side API key', async () => {
    const prior = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = '';
    try {
        const response = await handler.fetch(request({}));
        assert.equal(response.status, 503);
        assert.equal((await response.json() as { error: { code: string } }).error.code, 'AI_UNAVAILABLE');
    } finally {
        if (prior === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = prior;
    }
});

test('Vercel SQL generation rejects an incomplete schema before contacting OpenAI', async () => {
    const prior = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'not-a-real-key';
    try {
        const response = await handler.fetch(request({ connectionId: 'cloud', question: 'List rows', sql: 'SELECT 1', schema: {} }));
        assert.equal(response.status, 400);
        assert.equal((await response.json() as { error: { code: string } }).error.code, 'INVALID_SCHEMA');
    } finally {
        if (prior === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = prior;
    }
});
