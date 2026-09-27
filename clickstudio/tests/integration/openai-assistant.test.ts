import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAIDriver } from '../../server/openai.js';
import type { PreparedContext } from '../../core/assistant.js';

test('OpenAI receives prior chat messages before the fresh SQL context', async t => {
    const originalFetch = globalThis.fetch;
    let requestBody: Record<string, unknown> | undefined;
    globalThis.fetch = async (_input, init) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({
            id: 'response-1',
            status: 'completed',
            output_text: JSON.stringify({ sql: null, summary: 'Follow-up answer', assumptions: [], tables: [], caveats: [], clarification: null, findings: [] }),
            output: [],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    t.after(() => { globalThis.fetch = originalFetch; });

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
    assert.deepEqual(JSON.parse(freshContent[0]!.text), { question: 'And now?', context: { sql: 'SELECT 2' } });
});
