import test from 'node:test';
import assert from 'node:assert/strict';
import { APIConnectionTimeoutError } from 'openai';
import handler from '../../api/assistant/sql.js';

const endpoint = 'https://clickstudio.example/api/assistant/sql';

function request(body: unknown, headers: Record<string, string> = {}, signal?: AbortSignal) {
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
        signal,
    });
}

function assistantBody() {
    return {
        connectionId: 'clickhouse-cloud',
        question: 'Explain this SQL.',
        sql: 'SELECT 1',
        schema: { fetchedAt: new Date().toISOString(), tables: [], columns: [], truncated: false },
    };
}

test('Vercel SQL generation requires a same-origin workspace request', async () => {
    const prior = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = '';
    try {
        const response = await handler.fetch(request({}, { origin: 'https://other.example' }));
        assert.equal(response.status, 403);
        assert.equal(((await response.json()) as { error: { code: string } }).error.code, 'ORIGIN');
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
        assert.equal(
            ((await response.json()) as { error: { code: string } }).error.code,
            'AI_UNAVAILABLE',
        );
    } finally {
        if (prior === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = prior;
    }
});

test('Vercel assistant reports OpenAI request timeouts with a distinct 504 error', async t => {
    const priorKey = process.env.OPENAI_API_KEY;
    const priorFetch = globalThis.fetch;
    process.env.OPENAI_API_KEY = 'test-key';
    globalThis.fetch = async input => {
        if (String(input).endsWith('/responses/input_tokens'))
            return Response.json({ object: 'response.input_tokens', input_tokens: 200 });
        throw new APIConnectionTimeoutError();
    };
    t.after(() => {
        globalThis.fetch = priorFetch;
        if (priorKey === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = priorKey;
    });

    const response = await handler.fetch(request(assistantBody()));
    assert.equal(response.status, 504);
    assert.deepEqual(await response.json(), {
        error: {
            code: 'AI_TIMEOUT',
            message:
                'The assistant took too long to respond. Try splitting the request into shorter questions. No SQL was applied or run.',
        },
    });
});

test('Vercel assistant keeps non-timeout provider failures as 502 errors', async t => {
    const priorKey = process.env.OPENAI_API_KEY;
    const priorFetch = globalThis.fetch;
    process.env.OPENAI_API_KEY = 'test-key';
    globalThis.fetch = async input => {
        if (String(input).endsWith('/responses/input_tokens'))
            return Response.json({ object: 'response.input_tokens', input_tokens: 200 });
        return Response.json({ error: { message: 'Provider unavailable.' } }, { status: 500 });
    };
    t.after(() => {
        globalThis.fetch = priorFetch;
        if (priorKey === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = priorKey;
    });

    const response = await handler.fetch(request(assistantBody()));
    assert.equal(response.status, 502);
    assert.equal(
        ((await response.json()) as { error: { code: string } }).error.code,
        'AI_PROVIDER_ERROR',
    );
});

test('Vercel assistant keeps malformed structured output separate from timeout errors', async t => {
    const priorKey = process.env.OPENAI_API_KEY;
    const priorFetch = globalThis.fetch;
    process.env.OPENAI_API_KEY = 'test-key';
    globalThis.fetch = async input => {
        if (String(input).endsWith('/responses/input_tokens'))
            return Response.json({ object: 'response.input_tokens', input_tokens: 200 });
        return Response.json({
            id: 'resp_invalid_json',
            status: 'completed',
            output_text: '{',
            output: [],
        });
    };
    t.after(() => {
        globalThis.fetch = priorFetch;
        if (priorKey === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = priorKey;
    });

    const response = await handler.fetch(request(assistantBody()));
    assert.equal(response.status, 502);
    assert.equal(
        ((await response.json()) as { error: { code: string } }).error.code,
        'AI_PROVIDER_ERROR',
    );
});

test('Vercel assistant accepts larger table lists with matching structured-output limits', async t => {
    const priorKey = process.env.OPENAI_API_KEY;
    const priorFetch = globalThis.fetch;
    process.env.OPENAI_API_KEY = 'test-key';
    t.after(() => {
        globalThis.fetch = priorFetch;
        if (priorKey === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = priorKey;
    });

    for (const count of [51, 500]) {
        const tables = Array.from({ length: count }, (_, index) => `default.table_${index}`);
        const content = {
            sql: null,
            alternatives: [],
            summary: 'Review these tables.',
            assumptions: [],
            tables,
            caveats: [],
            clarification: null,
            findings: [],
        };
        const schemas: unknown[] = [];
        globalThis.fetch = async (input, init) => {
            const payload = JSON.parse(String(init?.body)) as {
                text: { format: { schema: { properties: { tables: unknown } } } };
            };
            schemas.push(payload.text.format.schema.properties.tables);
            if (String(input).endsWith('/responses/input_tokens'))
                return Response.json({ object: 'response.input_tokens', input_tokens: 200 });
            return Response.json({
                id: `resp_${count}_tables`,
                status: 'completed',
                output_text: JSON.stringify(content),
                output: [],
            });
        };

        const response = await handler.fetch(
            request({
                ...assistantBody(),
                schema: {
                    fetchedAt: new Date().toISOString(),
                    tables: tables.map(name => ({
                        database: 'default',
                        name: name.slice('default.'.length),
                        engine: 'MergeTree',
                    })),
                    columns: [],
                    truncated: false,
                },
            }),
        );
        assert.equal(response.status, 201);
        const proposal = (await response.json()) as { tables: string[]; sql: string | null };
        assert.deepEqual(proposal.tables, tables);
        assert.equal(proposal.sql, null);
        assert.deepEqual(
            schemas,
            Array.from({ length: 2 }, () => ({
                type: 'array',
                items: { type: 'string' },
                maxItems: 500,
            })),
        );
    }
});

test('Vercel assistant rejects table lists beyond the supported limit', async t => {
    const priorKey = process.env.OPENAI_API_KEY;
    const priorFetch = globalThis.fetch;
    process.env.OPENAI_API_KEY = 'test-key';
    globalThis.fetch = async input => {
        if (String(input).endsWith('/responses/input_tokens'))
            return Response.json({ object: 'response.input_tokens', input_tokens: 200 });
        const content = {
            sql: null,
            alternatives: [],
            summary: 'Review these tables.',
            assumptions: [],
            tables: Array.from({ length: 501 }, (_, index) => `default.table_${index}`),
            caveats: [],
            clarification: null,
            findings: [],
        };
        return Response.json({
            id: 'resp_oversized_tables',
            status: 'completed',
            output_text: JSON.stringify(content),
            output: [],
        });
    };
    t.after(() => {
        globalThis.fetch = priorFetch;
        if (priorKey === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = priorKey;
    });

    const response = await handler.fetch(request(assistantBody()));
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), {
        error: { code: 'AI_OUTPUT', message: 'Invalid tables' },
    });
});

test('Vercel assistant keeps caller cancellation separate from its timeout response', async t => {
    const priorKey = process.env.OPENAI_API_KEY;
    const priorFetch = globalThis.fetch;
    const controller = new AbortController();
    let markProviderStarted: () => void = () => {};
    const providerStarted = new Promise<void>(resolve => {
        markProviderStarted = resolve;
    });
    process.env.OPENAI_API_KEY = 'test-key';
    globalThis.fetch = async (input, init) => {
        if (String(input).endsWith('/responses/input_tokens'))
            return Response.json({ object: 'response.input_tokens', input_tokens: 200 });
        markProviderStarted();
        const signal = init?.signal;
        if (!signal) throw new Error('Expected an abort signal for the OpenAI request.');
        return await new Promise<Response>((_resolve, reject) => {
            if (signal.aborted) reject(signal.reason);
            else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
    };
    t.after(() => {
        globalThis.fetch = priorFetch;
        if (priorKey === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = priorKey;
    });

    const responsePromise = handler.fetch(request(assistantBody(), {}, controller.signal));
    await providerStarted;
    controller.abort(new DOMException('Request cancelled.', 'AbortError'));
    const response = await responsePromise;
    assert.equal(response.status, 499);
});

test('Vercel SQL generation rejects an incomplete schema before contacting OpenAI', async () => {
    const prior = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'not-a-real-key';
    try {
        const response = await handler.fetch(
            request({ connectionId: 'cloud', question: 'List rows', sql: 'SELECT 1', schema: {} }),
        );
        assert.equal(response.status, 400);
        assert.equal(
            ((await response.json()) as { error: { code: string } }).error.code,
            'INVALID_SCHEMA',
        );
    } finally {
        if (prior === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = prior;
    }
});

test('Vercel assistant returns a requested table proposal with example geography rows', async () => {
    const priorKey = process.env.OPENAI_API_KEY;
    const priorFetch = globalThis.fetch;
    const sql =
        "CREATE TABLE default.geography_copy ENGINE = MergeTree ORDER BY country AS SELECT 'Poland' AS country, 'Warsaw' AS city, 52.2297 AS latitude, 21.0122 AS longitude UNION ALL SELECT 'Japan', 'Tokyo', 35.6762, 139.6503";
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
    globalThis.fetch = async (input, init) => {
        if (String(input).endsWith('/responses/input_tokens'))
            return Response.json({ object: 'response.input_tokens', input_tokens: 200 });
        const payload = JSON.parse(String(init?.body)) as { instructions?: string };
        assert.doesNotMatch(payload.instructions ?? '', /SQL must be SELECT\/WITH only/i);
        assert.match(payload.instructions ?? '', /fixed list of SQL statement types/i);
        assert.match(
            payload.instructions ?? '',
            /If a requested source table is not listed and tablesIncomplete is false, say it is absent/i,
        );
        assert.match(
            payload.instructions ?? '',
            /If it is not listed and tablesIncomplete is true.*existence cannot be confirmed/i,
        );
        return Response.json({
            id: 'resp_interview',
            status: 'completed',
            output_text: content,
            output: [],
        });
    };
    try {
        const response = await handler.fetch(
            request({
                connectionId: 'clickhouse-cloud',
                question: 'Create a new table called geography_copy with sample geography rows.',
                sql: 'SELECT 1',
                database: 'default',
                schema: {
                    fetchedAt: '2026-09-27T00:00:00.000Z',
                    tables: [
                        {
                            database: 'default',
                            name: 'clickstudio_demo_events',
                            engine: 'MergeTree',
                        },
                    ],
                    columns: [
                        {
                            database: 'default',
                            table: 'clickstudio_demo_events',
                            name: 'day',
                            type: 'Date',
                        },
                    ],
                    truncated: false,
                },
            }),
        );
        assert.equal(response.status, 201);
        const proposal = (await response.json()) as { sql: string; caveats: string[] };
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
    const sql =
        'CREATE TABLE default.geography_copy ENGINE = MergeTree ORDER BY tuple() AS SELECT * FROM default.geography';
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
    globalThis.fetch = async (input, init) => {
        if (String(input).endsWith('/responses/input_tokens'))
            return Response.json({ object: 'response.input_tokens', input_tokens: 200 });
        const payload = JSON.parse(String(init?.body)) as { instructions?: string };
        assert.match(
            payload.instructions ?? '',
            /copy a named source table.*all rows and columns/i,
        );
        assert.match(
            payload.instructions ?? '',
            /CREATE TABLE target ENGINE = MergeTree ORDER BY tuple\(\) AS SELECT \* FROM source statement/i,
        );
        assert.match(payload.instructions ?? '', /Do not omit the ENGINE clause/i);
        assert.match(payload.instructions ?? '', /do not answer with a standalone SELECT/i);
        return Response.json({
            id: 'resp_table_copy',
            status: 'completed',
            output_text: content,
            output: [],
        });
    };
    try {
        const response = await handler.fetch(
            request({
                connectionId: 'clickhouse-cloud',
                question:
                    'Create a new table called geography_copy using the geography data in this connection. Include all rows and columns from the source table.',
                sql: 'SELECT 1',
                database: 'default',
                schema: {
                    fetchedAt: '2026-09-27T00:00:00.000Z',
                    tables: [{ database: 'default', name: 'geography', engine: 'MergeTree' }],
                    columns: [
                        {
                            database: 'default',
                            table: 'geography',
                            name: 'country',
                            type: 'String',
                        },
                        { database: 'default', table: 'geography', name: 'place', type: 'String' },
                        {
                            database: 'default',
                            table: 'geography',
                            name: 'latitude',
                            type: 'Float64',
                        },
                        {
                            database: 'default',
                            table: 'geography',
                            name: 'longitude',
                            type: 'Float64',
                        },
                    ],
                    truncated: false,
                },
            }),
        );
        assert.equal(response.status, 201);
        const proposal = (await response.json()) as { sql: string; quality: { status: string } };
        assert.equal(proposal.sql, sql);
        assert.equal(proposal.quality.status, 'pass');
    } finally {
        globalThis.fetch = priorFetch;
        if (priorKey === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = priorKey;
    }
});
