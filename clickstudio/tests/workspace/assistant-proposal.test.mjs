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
        alternatives: [],
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
    const parsed = parseAssistantProposal(
        validProposal({
            alternatives: [
                {
                    title: 'Delete instead',
                    summary: 'Remove matching rows.',
                    sql: 'ALTER TABLE events DELETE WHERE id = 1',
                },
            ],
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
        }),
    );

    assert.deepEqual(parsed, {
        ...validProposal(),
        alternatives: [
            {
                title: 'Delete instead',
                summary: 'Remove matching rows.',
                sql: 'ALTER TABLE events DELETE WHERE id = 1',
            },
        ],
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
    const parsed = parseAssistantProposal(
        validProposal({ sql: null, clarification: 'Which table?', sources: [] }),
    );

    assert.equal(parsed.sql, null);
    assert.deepEqual(parsed.alternatives, []);
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
        validProposal({
            alternatives: [{ title: '', summary: 'Bad choice', sql: 'DELETE FROM events' }],
        }),
        validProposal({
            alternatives: Array.from({ length: 5 }, (_, index) => ({
                title: `Option ${index}`,
                summary: '',
                sql: 'SELECT 1',
            })),
        }),
        validProposal({
            alternatives: [
                { title: 'Delete instead', summary: 'Remove rows.', sql: 'DELETE FROM events' },
            ],
            sql: null,
        }),
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
        {
            evaluatorVersion: 'v1',
            evaluatedAt: 'now',
            status: 'pass',
            score: Number.NaN,
            checks: [],
        },
        {
            evaluatorVersion: 'v1',
            evaluatedAt: 'now',
            status: 'pass',
            score: 80,
            checks: [{ id: 'other', status: 'pass', message: 'x' }],
        },
        {
            evaluatorVersion: 'v1',
            evaluatedAt: 'now',
            status: 'pass',
            score: 80,
            checks: [{ id: 'safety', status: 'unknown', message: 'x' }],
        },
    ];

    for (const quality of invalidQualityReports)
        assert.equal(parseAssistantProposal(validProposal({ quality })), undefined);
    assert.equal(parseAssistantProposal(validProposal({ decidedAt: 123 })), undefined);
});

test('Assistant proposal parsing rejects non-object values', () => {
    for (const value of [null, [], 'proposal', 1])
        assert.equal(parseAssistantProposal(value), undefined);
});

test('Assistant proposal parsing preserves all existing string domains', () => {
    for (const action of [
        'ask',
        'generate',
        'explain',
        'repair',
        'result',
        'performance',
        'review',
    ])
        assert.equal(parseAssistantProposal(validProposal({ action })).action, action);
    for (const decision of ['pending', 'accepted', 'rejected'])
        assert.equal(parseAssistantProposal(validProposal({ decision })).decision, decision);
    for (const severity of ['high', 'medium', 'low'])
        assert.equal(
            parseAssistantProposal(
                validProposal({ findings: [{ severity, message: 'Finding', evidence: 'SQL' }] }),
            ).findings[0].severity,
            severity,
        );
    for (const status of ['pass', 'warn', 'fail']) {
        for (const id of ['contract', 'safety', 'grounding', 'semantic']) {
            const quality = {
                evaluatorVersion: 'v1',
                evaluatedAt: 'now',
                status,
                score: 80,
                checks: [{ id, status, message: 'Check' }],
            };
            assert.deepEqual(parseAssistantProposal(validProposal({ quality })).quality, quality);
        }
    }
});

test('Assistant proposal parsing rejects prototype names and non-string domain values', () => {
    for (const value of ['constructor', 'toString', '__proto__', '', null, 1, {}, []]) {
        const quality = {
            evaluatorVersion: 'v1',
            evaluatedAt: 'now',
            status: 'pass',
            score: 80,
            checks: [{ id: 'safety', status: 'pass', message: 'Check' }],
        };
        const proposals = [
            validProposal({ action: value }),
            validProposal({ decision: value }),
            validProposal({ findings: [{ severity: value, message: 'Finding', evidence: 'SQL' }] }),
            validProposal({ quality: { ...quality, status: value } }),
            validProposal({
                quality: { ...quality, checks: [{ ...quality.checks[0], id: value }] },
            }),
            validProposal({
                quality: { ...quality, checks: [{ ...quality.checks[0], status: value }] },
            }),
        ];
        for (const proposal of proposals) assert.equal(parseAssistantProposal(proposal), undefined);
    }
});
