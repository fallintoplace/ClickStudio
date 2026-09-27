import type {
    AssistantAction,
    AssistantSource,
    EvaluationStatus,
    Proposal,
    ProposalContent,
    ProposalQuality,
    ProposalQualityCheck,
} from './types.js';

const assistantActions = {
    ask: true,
    generate: true,
    explain: true,
    repair: true,
    result: true,
    performance: true,
    review: true,
} satisfies Record<AssistantAction, true>;
const evaluationStatuses = { pass: true, warn: true, fail: true } satisfies Record<EvaluationStatus, true>;
const qualityCheckIds = { contract: true, safety: true, grounding: true, semantic: true } satisfies Record<ProposalQualityCheck['id'], true>;
const proposalDecisions = { pending: true, accepted: true, rejected: true } satisfies Record<Proposal['decision'], true>;

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function isAssistantAction(value: unknown): value is AssistantAction {
    return typeof value === 'string' && Object.hasOwn(assistantActions, value);
}

function isEvaluationStatus(value: unknown): value is EvaluationStatus {
    return typeof value === 'string' && Object.hasOwn(evaluationStatuses, value);
}

function isQualityCheckId(value: unknown): value is ProposalQualityCheck['id'] {
    return typeof value === 'string' && Object.hasOwn(qualityCheckIds, value);
}

function isProposalDecision(value: unknown): value is Proposal['decision'] {
    return typeof value === 'string' && Object.hasOwn(proposalDecisions, value);
}

function parseSources(value: unknown): AssistantSource[] | undefined {
    if (!Array.isArray(value) || value.length > 20) return undefined;
    const sources: AssistantSource[] = [];
    for (const source of value) {
        if (!isRecord(source) || typeof source.title !== 'string' || source.title.length > 512 ||
            typeof source.url !== 'string' || source.url.length > 2_048) return undefined;
        try {
            const url = new URL(source.url);
            if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return undefined;
            sources.push({ title: source.title, url: url.href });
        } catch {
            return undefined;
        }
    }
    return sources;
}

function parseFindings(value: unknown): ProposalContent['findings'] | undefined {
    if (!Array.isArray(value)) return undefined;
    const findings: ProposalContent['findings'] = [];
    for (const finding of value) {
        if (!isRecord(finding) ||
            (finding.severity !== 'high' && finding.severity !== 'medium' && finding.severity !== 'low') ||
            typeof finding.message !== 'string' || typeof finding.evidence !== 'string') return undefined;
        findings.push({ severity: finding.severity, message: finding.message, evidence: finding.evidence });
    }
    return findings;
}

function parseQuality(value: unknown): ProposalQuality | undefined {
    if (!isRecord(value) || typeof value.evaluatorVersion !== 'string' || typeof value.evaluatedAt !== 'string' ||
        !isEvaluationStatus(value.status) || typeof value.score !== 'number' || !Number.isFinite(value.score) ||
        !Array.isArray(value.checks)) return undefined;
    const checks: ProposalQualityCheck[] = [];
    for (const check of value.checks) {
        if (!isRecord(check) || !isQualityCheckId(check.id) ||
            !isEvaluationStatus(check.status) || typeof check.message !== 'string') return undefined;
        checks.push({ id: check.id, status: check.status, message: check.message });
    }
    return {
        evaluatorVersion: value.evaluatorVersion,
        evaluatedAt: value.evaluatedAt,
        status: value.status,
        score: value.score,
        checks,
    };
}

export function parseAssistantProposal(value: unknown): Proposal | undefined {
    if (!isRecord(value) || typeof value.id !== 'string' || typeof value.owner !== 'string' ||
        typeof value.connectionId !== 'string' || !isAssistantAction(value.action) ||
        typeof value.createdAt !== 'string' || typeof value.baseSql !== 'string' ||
        typeof value.responseId !== 'string' || typeof value.model !== 'string' ||
        typeof value.promptVersion !== 'string' || !isStringArray(value.contextSummary) ||
        typeof value.summary !== 'string' || (value.sql !== null && typeof value.sql !== 'string') ||
        !isStringArray(value.assumptions) || !isStringArray(value.tables) || !isStringArray(value.caveats) ||
        (value.clarification !== null && typeof value.clarification !== 'string') ||
        !isProposalDecision(value.decision)) return undefined;

    const findings = parseFindings(value.findings);
    if (!findings) return undefined;
    const sources = value.sources === undefined ? undefined : parseSources(value.sources);
    if (value.sources !== undefined && !sources) return undefined;
    const quality = value.quality === undefined ? undefined : parseQuality(value.quality);
    if (value.quality !== undefined && !quality) return undefined;
    if (value.decidedAt !== undefined && typeof value.decidedAt !== 'string') return undefined;

    return {
        id: value.id,
        owner: value.owner,
        connectionId: value.connectionId,
        action: value.action,
        createdAt: value.createdAt,
        baseSql: value.baseSql,
        responseId: value.responseId,
        model: value.model,
        promptVersion: value.promptVersion,
        contextSummary: value.contextSummary,
        sql: value.sql,
        summary: value.summary,
        assumptions: value.assumptions,
        tables: value.tables,
        caveats: value.caveats,
        clarification: value.clarification,
        findings,
        decision: value.decision,
        ...(sources !== undefined ? { sources } : {}),
        ...(quality ? { quality } : {}),
        ...(typeof value.decidedAt === 'string' ? { decidedAt: value.decidedAt } : {}),
    };
}
