import test from 'node:test';
import assert from 'node:assert/strict';
import { APIConnectionTimeoutError } from 'openai';
import { OpenAIDriver } from '../../src/backend/assistant/openai/client.js';
import type { PreparedContext } from '../../src/backend/assistant/proposals/assistant.js';
import { AppError } from '../../src/backend/system/requests/errors.js';

function assistantContext(): PreparedContext {
    return {
        payload: {
            instructions: 'Use the supplied context.',
            question: 'Summarize this SQL.',
            context: JSON.stringify({ sql: 'SELECT 1' }),
        },
    } as unknown as PreparedContext;
}

function isAssistantTimeout(error: unknown): boolean {
    return error instanceof AppError && error.status === 504 && error.code === 'AI_TIMEOUT';
}

test('OpenAI receives prior chat messages before the fresh SQL context', async t => {
    const originalFetch = globalThis.fetch;
    let requestBody: Record<string, unknown> | undefined;
    globalThis.fetch = async (input, init) => {
        const url = String(input);
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        if (url.endsWith('/responses/input_tokens'))
            return new Response(
                JSON.stringify({ object: 'response.input_tokens', input_tokens: 200 }),
                { status: 200, headers: { 'content-type': 'application/json' } },
            );
        requestBody = body;
        return new Response(
            JSON.stringify({
                id: 'response-1',
                status: 'completed',
                output_text: JSON.stringify({
                    sql: null,
                    summary: 'Follow-up answer',
                    assumptions: [],
                    tables: [],
                    caveats: [],
                    clarification: null,
                    findings: [],
                }),
                output: [],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
        );
    };
    t.after(() => {
        globalThis.fetch = originalFetch;
    });

    const context = {
        payload: {
            instructions: 'Use prior messages for follow-ups.',
            question: 'And now?',
            context: JSON.stringify({ sql: 'SELECT 2' }),
            conversation: [
                { role: 'user', content: 'Show the old question' },
                { role: 'assistant', content: 'I need an airport table.' },
            ],
        },
    } as unknown as PreparedContext;
    const driver = new OpenAIDriver('test-key', 'test-model');

    await driver.propose(context, new AbortController().signal);

    assert.equal(requestBody?.store, false);
    assert.deepEqual((requestBody?.input as Array<Record<string, unknown>>).slice(0, 2), [
        { role: 'user', content: 'Show the old question' },
        { role: 'assistant', content: 'I need an airport table.' },
    ]);
    const freshMessage = (requestBody?.input as Array<Record<string, unknown>>)[2];
    assert.equal(freshMessage.role, 'user');
    const freshContent = freshMessage.content as Array<{ text: string }>;
    assert.deepEqual(JSON.parse(freshContent[0]!.text), {
        question: 'And now?',
        context: { sql: 'SELECT 2' },
    });
});

test('OpenAI response timeouts become a distinct assistant timeout error', async t => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async input => {
        if (String(input).endsWith('/responses/input_tokens'))
            return Response.json({ object: 'response.input_tokens', input_tokens: 200 });
        throw new APIConnectionTimeoutError();
    };
    t.after(() => {
        globalThis.fetch = originalFetch;
    });

    const driver = new OpenAIDriver('test-key', 'test-model');
    await assert.rejects(
        () => driver.propose(assistantContext(), new AbortController().signal),
        isAssistantTimeout,
    );
});

test('OpenAI input-token request timeouts do not fall through as optional count failures', async t => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
        throw new APIConnectionTimeoutError();
    };
    t.after(() => {
        globalThis.fetch = originalFetch;
    });

    const driver = new OpenAIDriver('test-key', 'test-model');
    await assert.rejects(
        () => driver.propose(assistantContext(), new AbortController().signal),
        isAssistantTimeout,
    );
});

test('assistant deadline aborts become AI_TIMEOUT while caller cancellation stays distinct', async t => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_input, init) => {
        if (!init?.signal?.aborted)
            throw new Error('Unexpected OpenAI request without an aborted signal.');
        throw init.signal.reason;
    };
    t.after(() => {
        globalThis.fetch = originalFetch;
    });

    const driver = new OpenAIDriver('test-key', 'test-model');
    const deadline = new AbortController();
    deadline.abort(new DOMException('Deadline reached.', 'TimeoutError'));
    await assert.rejects(
        () => driver.propose(assistantContext(), deadline.signal),
        isAssistantTimeout,
    );

    const cancellation = new AbortController();
    cancellation.abort(new DOMException('Request cancelled.', 'AbortError'));
    await assert.rejects(
        () => driver.propose(assistantContext(), cancellation.signal),
        error =>
            error === cancellation.signal.reason ||
            (error instanceof Error && /abort|cancel/i.test(`${error.name} ${error.message}`)),
    );
});
