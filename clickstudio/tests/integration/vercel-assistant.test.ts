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

test('Vercel assistant returns a requested table proposal with example geography rows', async () => {
    const priorKey = process.env.OPENAI_API_KEY;
    const priorFetch = globalThis.fetch;
    const sql = "CREATE TABLE default.geography_copy ENGINE = MergeTree ORDER BY country AS SELECT 'Poland' AS country, 'Warsaw' AS city, 52.2297 AS latitude, 21.0122 AS longitude UNION ALL SELECT 'Japan', 'Tokyo', 35.6762, 139.6503";
    const content = JSON.stringify({
        sql,
        summary: 'Created a starter geography table with sample rows.',
        assumptions: [],
        tables: [],
        caveats: ['These are example rows, not data copied from an existing table.'],
        clarification: null,
        findings: [],
    });
    process.env.OPENAI_API_KEY = 'test-key';
    globalThis.fetch = async (_input, init) => {
        const payload = JSON.parse(String(init?.body)) as { instructions?: string };
        assert.doesNotMatch(payload.instructions ?? '', /SQL must be SELECT\/WITH only/i);
        assert.match(payload.instructions ?? '', /fixed list of SQL statement types/i);
        assert.match(payload.instructions ?? '', /If a requested source table is absent.*do not query or claim data from the missing source/i);
        return Response.json({ id: 'resp_interview', status: 'completed', output_text: content, output: [] });
    };
    try {
        const response = await handler.fetch(request({
            connectionId: 'clickhouse-cloud',
            question: 'Create a new table called geography_copy with sample geography rows.',
            sql: 'SELECT 1',
            database: 'default',
            schema: {
                fetchedAt: '2026-09-27T00:00:00.000Z',
                tables: [{ database: 'default', name: 'clickstudio_demo_events', engine: 'MergeTree' }],
                columns: [{ database: 'default', table: 'clickstudio_demo_events', name: 'day', type: 'Date' }],
                truncated: false,
            },
        }));
        assert.equal(response.status, 201);
        const proposal = await response.json() as { sql: string; caveats: string[] };
        assert.equal(proposal.sql, sql);
        assert.match(proposal.caveats[0] ?? '', /example rows/i);
    } finally {
        globalThis.fetch = priorFetch;
        if (priorKey === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = priorKey;
    }
});

test('Vercel assistant instructs a full table copy when the source is present', async () => {
    const priorKey = process.env.OPENAI_API_KEY;
    const priorFetch = globalThis.fetch;
    const sql = 'CREATE TABLE default.geography_copy ENGINE = MergeTree ORDER BY tuple() AS SELECT * FROM default.geography';
    const content = JSON.stringify({
        sql,
        summary: 'Copies every geography column and row into geography_copy.',
        assumptions: [],
        tables: ['default.geography'],
        caveats: [],
        clarification: null,
        findings: [],
    });
    process.env.OPENAI_API_KEY = 'test-key';
    globalThis.fetch = async (_input, init) => {
        const payload = JSON.parse(String(init?.body)) as { instructions?: string };
        assert.match(payload.instructions ?? '', /copy a named source table.*all rows and columns/i);
        assert.match(payload.instructions ?? '', /CREATE TABLE target ENGINE = MergeTree ORDER BY tuple\(\) AS SELECT \* FROM source statement/i);
        assert.match(payload.instructions ?? '', /Do not omit the ENGINE clause/i);
        assert.match(payload.instructions ?? '', /do not answer with a standalone SELECT/i);
        return Response.json({ id: 'resp_table_copy', status: 'completed', output_text: content, output: [] });
    };
    try {
        const response = await handler.fetch(request({
            connectionId: 'clickhouse-cloud',
            question: 'Create a new table called geography_copy using the geography data in this connection. Include all rows and columns from the source table.',
            sql: 'SELECT 1',
            database: 'default',
            schema: {
                fetchedAt: '2026-09-27T00:00:00.000Z',
                tables: [{ database: 'default', name: 'geography', engine: 'MergeTree' }],
                columns: [
                    { database: 'default', table: 'geography', name: 'country', type: 'String' },
                    { database: 'default', table: 'geography', name: 'place', type: 'String' },
                    { database: 'default', table: 'geography', name: 'latitude', type: 'Float64' },
                    { database: 'default', table: 'geography', name: 'longitude', type: 'Float64' },
                ],
                truncated: false,
            },
        }));
        assert.equal(response.status, 201);
        const proposal = await response.json() as { sql: string; quality: { status: string } };
        assert.equal(proposal.sql, sql);
        assert.equal(proposal.quality.status, 'pass');
    } finally {
        globalThis.fetch = priorFetch;
        if (priorKey === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = priorKey;
    }
});
