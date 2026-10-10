import type {
    AssistantAction,
    AssistantEvaluationReport,
    Proposal,
    ProposalContent,
    ProposalQuality,
    ProposalQualityCheck,
    Schema,
} from '../shared/types.js';
import { lexSql } from '../shared/sql.js';

export const ASSISTANT_EVALUATOR_VERSION = 'assistant-eval-v1';

interface EvaluationContext {
    schema?: Pick<Schema, 'tables' | 'truncated'>;
}

function statusOf(checks: ProposalQualityCheck[]): ProposalQuality['status'] {
    return checks.some(check => check.status === 'fail')
        ? 'fail'
        : checks.some(check => check.status === 'warn')
          ? 'warn'
          : 'pass';
}

function scoreOf(checks: ProposalQualityCheck[]): number {
    const weights = { contract: 20, safety: 40, grounding: 20, semantic: 20 } as const;
    const values = { pass: 1, warn: 0.5, fail: 0 } as const;
    return Math.round(
        checks.reduce((sum, check) => sum + weights[check.id] * values[check.status], 0),
    );
}

function identifier(token: { text: string; kind: string }): string {
    if (token.kind !== 'word' && token.kind !== 'quoted') return '';
    return token.text.replace(/^([`"'])(.*)\1$/, '$2').toLowerCase();
}

/** A conservative table reference finder. It is a grounding signal, not a SQL parser. */
export function referencedTables(sql: string): string[] {
    const tokens = lexSql(sql),
        references: string[] = [];
    for (let i = 0; i < tokens.length; i++) {
        const keyword = tokens[i]!.text.toUpperCase();
        if (!['FROM', 'JOIN'].includes(keyword)) continue;
        const first = tokens[i + 1];
        if (!first || first.text === '(') continue;
        const left = identifier(first);
        if (!left) continue;
        const dot = tokens[i + 2],
            right = dot?.text === '.' ? tokens[i + 3] : undefined;
        const value = right ? `${left}.${identifier(right)}` : left;
        if (value && !references.includes(value)) references.push(value);
    }
    return references;
}

function knownTableSet(context: EvaluationContext): Set<string> {
    return new Set(
        (context.schema?.tables ?? []).flatMap(table => [
            table.name.toLowerCase(),
            `${table.database}.${table.name}`.toLowerCase(),
        ]),
    );
}

export function evaluateProposal(
    content: ProposalContent,
    action: AssistantAction,
    context: EvaluationContext = {},
): ProposalQuality {
    const checks: ProposalQualityCheck[] = [];
    const inspectOnly = action === 'review' || action === 'explain';
    const flexible = action === 'ask';
    const alternatives = content.alternatives ?? [];
    const sqlOptions = [content.sql, ...alternatives.map(option => option.sql)].filter(
        (sql): sql is string => sql !== null,
    );
    if (inspectOnly && (content.sql !== null || alternatives.length > 0))
        checks.push({
            id: 'contract',
            status: 'fail',
            message: 'This playbook must not return replacement SQL.',
        });
    else if (!inspectOnly && !flexible && sqlOptions.length === 0)
        checks.push({
            id: 'contract',
            status: 'warn',
            message:
                'No SQL was proposed; the response needs clarification before it can be applied.',
        });
    else
        checks.push({
            id: 'contract',
            status: 'pass',
            message: inspectOnly
                ? 'Inspect-only playbook returned no replacement SQL.'
                : flexible && sqlOptions.length === 0
                  ? 'The request was answered without replacement SQL.'
                  : 'The playbook returned an applicable SQL proposal.',
        });

    if (sqlOptions.length === 0) {
        checks.push({
            id: 'safety',
            status: 'pass',
            message: 'No SQL was returned, so there is no draft to review or run.',
        });
        checks.push({
            id: 'grounding',
            status: 'pass',
            message: 'No table references were introduced.',
        });
        checks.push({
            id: 'semantic',
            status: content.clarification || flexible ? 'pass' : 'warn',
            message: content.clarification
                ? 'The response asks for clarification instead of guessing.'
                : flexible
                  ? 'The request was answered without returning SQL.'
                  : 'No SQL was returned and no clarification was recorded.',
        });
    } else {
        checks.push({
            id: 'safety',
            status: 'pass',
            message: 'The SQL options stay in the draft until the user reviews and runs one.',
        });
        const references = [...new Set(sqlOptions.flatMap(referencedTables))],
            known = knownTableSet(context),
            unknown = references.filter(table => !known.has(table));
        if (!references.length)
            checks.push({
                id: 'grounding',
                status: 'pass',
                message:
                    'The proposal does not introduce a table reference that needs schema grounding.',
            });
        else if (!unknown.length)
            checks.push({
                id: 'grounding',
                status: 'pass',
                message: `All referenced tables are present in the permitted schema: ${references.join(', ')}.`,
            });
        else
            checks.push({
                id: 'grounding',
                status: 'warn',
                message: `Schema grounding needs a run check for: ${unknown.join(', ')}${context.schema?.truncated ? ' (the schema is incomplete)' : ''}.`,
            });
        checks.push({
            id: 'semantic',
            status: unknown.length ? 'warn' : 'pass',
            message: unknown.length
                ? 'Static semantic proxy is incomplete; run the query and inspect retained results.'
                : 'Static semantic proxy passed; execution evidence is still required for semantic correctness.',
        });
    }
    return {
        evaluatorVersion: ASSISTANT_EVALUATOR_VERSION,
        evaluatedAt: new Date().toISOString(),
        status: statusOf(checks),
        score: scoreOf(checks),
        checks,
    };
}

export interface AssistantBenchmarkCase {
    id: string;
    action: AssistantAction;
    expected: {
        sqlIncludes?: string[];
        sqlAbsent?: string[];
        sqlNull?: boolean;
        minimumFindings?: number;
        alternativeCount?: number;
        alternativeSqlIncludes?: string[];
    };
    candidate: ProposalContent;
}

const benchmarkSchema: Pick<Schema, 'tables' | 'truncated'> = {
    truncated: false,
    tables: [{ database: 'default', name: 'events', engine: 'MergeTree' }],
};
export const ASSISTANT_BENCHMARK_CASES: readonly AssistantBenchmarkCase[] = [
    {
        id: 'daily-events',
        action: 'generate',
        expected: {
            sqlIncludes: ['toDate', 'count', 'default.events', 'GROUP BY'],
            sqlAbsent: ['DROP', 'INSERT'],
        },
        candidate: {
            sql: 'SELECT toDate(timestamp) AS day, count() AS events FROM default.events GROUP BY day ORDER BY day',
            summary: 'Daily event counts.',
            assumptions: [],
            tables: ['default.events'],
            caveats: [],
            clarification: null,
            findings: [],
        },
    },
    {
        id: 'bounded-repair',
        action: 'repair',
        expected: { sqlIncludes: ['SELECT', 'LIMIT', 'default.events'] },
        candidate: {
            sql: 'SELECT * FROM default.events LIMIT 100',
            summary: 'Added a bounded read-only query.',
            assumptions: [],
            tables: ['default.events'],
            caveats: ['Run it to confirm the column names.'],
            clarification: null,
            findings: [],
        },
    },
    {
        id: 'explain-no-edit',
        action: 'explain',
        expected: { sqlNull: true },
        candidate: {
            sql: null,
            summary: 'The query reads a bounded event sample.',
            assumptions: [],
            tables: [],
            caveats: [],
            clarification: null,
            findings: [],
        },
    },
    {
        id: 'review-finding',
        action: 'review',
        expected: { sqlNull: true, minimumFindings: 1 },
        candidate: {
            sql: null,
            summary: 'The query is bounded but should be checked for freshness.',
            assumptions: [],
            tables: ['default.events'],
            caveats: [],
            clarification: null,
            findings: [
                {
                    severity: 'medium',
                    message: 'Freshness is not stated.',
                    evidence: 'The SQL has no freshness predicate.',
                },
            ],
        },
    },
    {
        id: 'missing-definition',
        action: 'generate',
        expected: { sqlNull: true },
        candidate: {
            sql: null,
            summary: 'I need the metric definition before proposing SQL.',
            assumptions: [],
            tables: [],
            caveats: [],
            clarification: 'Which event field defines a conversion?',
            findings: [],
        },
    },
    {
        id: 'separate-update-delete-options',
        action: 'ask',
        expected: {
            sqlIncludes: ['ALTER TABLE', 'UPDATE'],
            sqlAbsent: ['DELETE'],
            alternativeCount: 1,
            alternativeSqlIncludes: ['ALTER TABLE', 'DELETE'],
        },
        candidate: {
            sql: "ALTER TABLE default.events UPDATE status = 'reviewed' WHERE id = 1",
            alternatives: [
                {
                    title: 'Delete instead',
                    summary: 'Remove the matching event.',
                    sql: 'ALTER TABLE default.events DELETE WHERE id = 1',
                },
            ],
            summary: 'Choose whether to update or delete the matching event.',
            assumptions: [],
            tables: ['default.events'],
            caveats: [],
            clarification: null,
            findings: [],
        },
    },
];

export interface AssistantBenchmarkResult {
    id: string;
    passed: boolean;
    score: number;
    quality: ProposalQuality;
}

export function gradeBenchmarkCase(testCase: AssistantBenchmarkCase): AssistantBenchmarkResult {
    const quality = evaluateProposal(testCase.candidate, testCase.action, {
        schema: benchmarkSchema,
    });
    const sql = testCase.candidate.sql?.toLowerCase() ?? '';
    const alternativeSql = (testCase.candidate.alternatives ?? [])
        .map(option => option.sql.toLowerCase())
        .join('\n');
    const expected = testCase.expected;
    const includes = (expected.sqlIncludes ?? []).every(value => sql.includes(value.toLowerCase()));
    const absent = (expected.sqlAbsent ?? []).every(value => !sql.includes(value.toLowerCase()));
    const nullShape =
        expected.sqlNull === undefined ||
        (expected.sqlNull ? testCase.candidate.sql === null : testCase.candidate.sql !== null);
    const findings = testCase.candidate.findings.length >= (expected.minimumFindings ?? 0);
    const alternativeCount =
        expected.alternativeCount === undefined ||
        (testCase.candidate.alternatives ?? []).length === expected.alternativeCount;
    const alternativesInclude = (expected.alternativeSqlIncludes ?? []).every(value =>
        alternativeSql.includes(value.toLowerCase()),
    );
    const passed =
        includes &&
        absent &&
        nullShape &&
        findings &&
        alternativeCount &&
        alternativesInclude &&
        quality.status !== 'fail';
    return {
        id: testCase.id,
        passed,
        score: passed ? 100 : Math.max(0, quality.score - 25),
        quality,
    };
}

export function runAssistantBenchmarks() {
    const results = ASSISTANT_BENCHMARK_CASES.map(gradeBenchmarkCase),
        passed = results.filter(result => result.passed).length;
    return {
        total: results.length,
        passed,
        score: Math.round(results.reduce((sum, result) => sum + result.score, 0) / results.length),
        results,
    };
}

export function buildEvaluationReport(proposals: Proposal[]): AssistantEvaluationReport {
    const evaluated = proposals.filter(proposal => proposal.quality),
        quality = evaluated.map(proposal => proposal.quality!);
    const accepted = proposals.filter(proposal => proposal.decision === 'accepted').length,
        rejected = proposals.filter(proposal => proposal.decision === 'rejected').length;
    const rate = (value: number, total: number) =>
        total ? Math.round((value / total) * 100) : null;
    const checkRate = (id: ProposalQualityCheck['id']) =>
        rate(
            quality.filter(item => item.checks.find(check => check.id === id)?.status === 'pass')
                .length,
            quality.length,
        );
    const benchmark = runAssistantBenchmarks();
    return {
        evaluatorVersion: ASSISTANT_EVALUATOR_VERSION,
        total: proposals.length,
        pending: proposals.length - accepted - rejected,
        accepted,
        rejected,
        acceptanceRate: rate(accepted, accepted + rejected),
        evaluated: evaluated.length,
        qualityPassRate: rate(
            quality.filter(item => item.status === 'pass').length,
            quality.length,
        ),
        safetyPassRate: checkRate('safety'),
        semanticPassRate: checkRate('semantic'),
        averageScore: quality.length
            ? Math.round(quality.reduce((sum, item) => sum + item.score, 0) / quality.length)
            : null,
        latest: proposals
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .slice(0, 8)
            .map(proposal => ({
                id: proposal.id,
                action: proposal.action,
                decision: proposal.decision,
                createdAt: proposal.createdAt,
                status: proposal.quality?.status ?? 'unknown',
                score: proposal.quality?.score ?? null,
            })),
        benchmark: {
            total: benchmark.total,
            passed: benchmark.passed,
            score: benchmark.score,
            mode: 'static',
        },
    };
}
