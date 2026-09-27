import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAssistantProposal } from '../../.workspace-build/shared/assistant-proposal.js';

function validProposal(overrides = {}) {
    return {
        id: 'proposal-1',
        owner: 'user-1',
        connectionId: 'connection-1',
        action: 'ask',
        createdAt: '2026-09-28T10:00:00.000Z',
        baseSql: 'SELECT 1',
        responseId: 'response-1',
        model: 'model-1',
        promptVersion: 'v1',
        contextSummary: ['One table is available'],
        sql: 'SELECT 1 AS result',
        summary: 'Returns one row',
        assumptions: [],
        tables: [],
        caveats: [],
        clarification: null,
        findings: [],
        decision: 'pending',
        ...overrides,
    };
}

test('Assistant proposal parsing returns a typed, normalized proposal', () => {
    const parsed = parseAssistantProposal(validProposal({
        sources: [{ title: 'Docs', url: 'https://example.com/path' }],
        findings: [{ severity: 'low', message: 'Small note', evidence: 'SELECT 1' }],
        quality: {
            evaluatorVersion: 'v2',
            evaluatedAt: '2026-09-28T10:01:00.000Z',
            status: 'pass',
            score: 98,
            checks: [{ id: 'safety', status: 'pass', message: 'Read only' }],
        },
        decidedAt: '2026-09-28T10:02:00.000Z',
        ignored: 'not part of the proposal contract',
    }));

    assert.deepEqual(parsed, {
        ...validProposal(),
        sources: [{ title: 'Docs', url: 'https://example.com/path' }],
        findings: [{ severity: 'low', message: 'Small note', evidence: 'SELECT 1' }],
        quality: {
            evaluatorVersion: 'v2',
            evaluatedAt: '2026-09-28T10:01:00.000Z',
            status: 'pass',
            score: 98,
            checks: [{ id: 'safety', status: 'pass', message: 'Read only' }],
        },
        decidedAt: '2026-09-28T10:02:00.000Z',
    });
});

test('Assistant proposal parsing keeps nullable and empty optional fields', () => {
    const parsed = parseAssistantProposal(validProposal({ sql: null, clarification: 'Which table?', sources: [] }));

    assert.equal(parsed.sql, null);
    assert.equal(parsed.clarification, 'Which table?');
    assert.deepEqual(parsed.sources, []);
});

test('Assistant proposal parsing rejects missing or invalid required fields', () => {
    const invalidProposals = [
        validProposal({ id: undefined }),
        validProposal({ action: 'delete' }),
        validProposal({ decision: 'ignored' }),
        validProposal({ contextSummary: ['valid', 1] }),
        validProposal({ sql: 1 }),
        validProposal({ clarification: false }),
        validProposal({ assumptions: 'none' }),
        validProposal({ findings: [{ severity: 'critical', message: 'Invalid', evidence: 'x' }] }),
    ];

    for (const proposal of invalidProposals)
        assert.equal(parseAssistantProposal(proposal), undefined);
});

test('Assistant proposal parsing rejects unsafe or oversized source metadata', () => {
    const invalidSources = [
        [{ title: 'Local file', url: 'file:///etc/passwd' }],
        [{ title: 'Credential URL', url: 'https://user:secret@example.com' }],
        [{ title: 'Bad URL', url: 'not a URL' }],
        [{ title: 'x'.repeat(513), url: 'https://example.com' }],
        [{ title: 'Docs', url: 'https://example.com/' + 'x'.repeat(2_049) }],
        Array.from({ length: 21 }, () => ({ title: 'Docs', url: 'https://example.com' })),
    ];

    for (const sources of invalidSources)
        assert.equal(parseAssistantProposal(validProposal({ sources })), undefined);
});

test('Assistant proposal parsing validates the full optional quality report', () => {
    const invalidQualityReports = [
        { status: 'pass' },
        { evaluatorVersion: 'v1', evaluatedAt: 'now', status: 'unknown', score: 80, checks: [] },
        { evaluatorVersion: 'v1', evaluatedAt: 'now', status: 'pass', score: Number.NaN, checks: [] },
        { evaluatorVersion: 'v1', evaluatedAt: 'now', status: 'pass', score: 80, checks: [{ id: 'other', status: 'pass', message: 'x' }] },
        { evaluatorVersion: 'v1', evaluatedAt: 'now', status: 'pass', score: 80, checks: [{ id: 'safety', status: 'unknown', message: 'x' }] },
    ];

    for (const quality of invalidQualityReports)
        assert.equal(parseAssistantProposal(validProposal({ quality })), undefined);
    assert.equal(parseAssistantProposal(validProposal({ decidedAt: 123 })), undefined);
});

test('Assistant proposal parsing rejects non-object values', () => {
    for (const value of [null, [], 'proposal', 1])
        assert.equal(parseAssistantProposal(value), undefined);
});
