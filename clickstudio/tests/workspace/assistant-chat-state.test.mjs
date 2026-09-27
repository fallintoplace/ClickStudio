import test from 'node:test';
import assert from 'node:assert/strict';
import {
    assistantChatsStorageKey,
    createAssistantChatState,
    loadAssistantChatState,
    recoverAssistantChatState,
} from '../../.workspace-build/web/assistant-chat-state.js';

test('Assistant chat storage is scoped to each connection', () => {
    assert.notEqual(assistantChatsStorageKey('local/one'), assistantChatsStorageKey('local/two'));
    assert.match(assistantChatsStorageKey('local/one'), /local%2Fone/);
});

test('Assistant chats restore the selected thread and keep every conversation', () => {
    const first = { id: 'first', title: 'First question', createdAt: 'now', updatedAt: 'now', turns: [] };
    const second = { id: 'second', title: 'Follow-up', createdAt: 'later', updatedAt: 'later', turns: [
        { id: 'turn-1', question: 'Why?', contextSql: 'SELECT 1', includeRun: true, runId: 'run-1',
            runContext: {
                evidenceSql: 'SELECT answer', error: 'Fixture error',
                result: { runId: 'run-1', queryId: 'query-1', columns: [{ name: 'answer', type: 'UInt8' }], rows: [['1']], completeness: 'complete', createdAt: 'now', expiresAt: 'later' },
            }, status: 'complete' },
    ] };
    const recovered = recoverAssistantChatState({ version: 1, activeChatId: 'second', chats: [first, second] });

    assert.equal(recovered.activeChatId, 'second');
    assert.deepEqual(recovered.chats.map(chat => chat.id), ['first', 'second']);
    assert.equal(recovered.chats[1].turns[0].question, 'Why?');
    assert.equal(recovered.chats[1].turns[0].runContext.evidenceSql, 'SELECT answer');
    assert.deepEqual(recovered.chats[1].turns[0].runContext.result.rows, [['1']]);
});

test('Malformed retained run results are discarded without losing other turns', () => {
    const result = {
        runId: 'run-1', queryId: 'query-1', columns: [{ name: 'answer', type: 'UInt8' }],
        rows: [['1']], completeness: 'complete', createdAt: 'now', expiresAt: 'later',
    };
    const recovered = recoverAssistantChatState({
        version: 1,
        activeChatId: 'chat',
        chats: [{ id: 'chat', title: 'A chat', createdAt: 'now', updatedAt: 'now', turns: [
            { id: 'valid', question: 'Keep me', contextSql: 'SELECT 1', includeRun: true, status: 'complete', runContext: { result } },
            { id: 'bad-row-width', question: 'Drop me', contextSql: 'SELECT 2', includeRun: true, status: 'complete',
                runContext: { result: { ...result, rows: [['1', 'extra']] } } },
            { id: 'bad-cell', question: 'Drop me too', contextSql: 'SELECT 3', includeRun: true, status: 'complete',
                runContext: { result: { ...result, rows: [[undefined]] } } },
        ] }],
    });

    assert.deepEqual(recovered.chats[0].turns.map(turn => turn.id), ['valid']);
});

test('Cyclic run context is discarded without throwing during recovery', () => {
    const runContext = {};
    runContext.self = runContext;
    const recovered = recoverAssistantChatState({
        version: 1,
        activeChatId: 'chat',
        chats: [{ id: 'chat', title: 'A chat', createdAt: 'now', updatedAt: 'now', turns: [
            { id: 'cycle', question: 'Recover safely', contextSql: 'SELECT 1', includeRun: true, status: 'complete', runContext },
        ] }],
    });

    assert.deepEqual(recovered.chats[0].turns, []);
});

test('An in-flight chat turn becomes a clear cancelled message after reload', () => {
    const state = createAssistantChatState();
    state.chats[0].turns.push({
        id: 'pending-turn', question: 'Explain this', contextSql: 'SELECT 1', includeRun: false, status: 'pending',
    });

    const recovered = recoverAssistantChatState(state);

    assert.equal(recovered.chats[0].turns[0].status, 'cancelled');
    assert.match(recovered.chats[0].turns[0].error, /interrupted when the page closed/);
});

test('Malformed turns are discarded without losing the rest of a chat', () => {
    const recovered = recoverAssistantChatState({
        version: 1,
        activeChatId: 'chat',
        chats: [{
            id: 'chat', title: 'A chat', createdAt: 'now', updatedAt: 'now', turns: [
                { id: 'valid', question: 'Keep me', contextSql: 'SELECT 1', includeRun: false, status: 'complete' },
                { id: 'invalid', question: 'x'.repeat(4_001), contextSql: 'SELECT 2', includeRun: false, status: 'complete' },
            ],
        }],
    });

    assert.deepEqual(recovered.chats[0].turns.map(turn => turn.id), ['valid']);
});

test('Unreadable assistant chat storage returns a visible recovery error', () => {
    const loaded = loadAssistantChatState('chat-key', { getItem: () => { throw new Error('storage denied'); } });

    assert.equal(loaded.state.chats.length, 1);
    assert.match(loaded.error, /storage is unavailable/);
});
