import type {
    AssistantAction,
    FindingSeverity,
    EvaluationStatus,
    QualityCheckId,
    ProposalDecision,
} from './actions.js';

export interface AssistantConversationMessage {
    role: 'user' | 'assistant';
    content: string;
}

export interface AssistantSource {
    title: string;
    url: string;
}

export interface ProposalAlternative {
    title: string;
    summary: string;
    sql: string;
}

export interface ProposalContent {
    sql: string | null;
    alternatives?: ProposalAlternative[];
    summary: string;
    assumptions: string[];
    tables: string[];
    caveats: string[];
    clarification: string | null;
    sources?: AssistantSource[];
    findings: {
        severity: FindingSeverity;
        message: string;
        evidence: string;
    }[];
}

export interface ProposalQualityCheck {
    id: QualityCheckId;
    status: EvaluationStatus;
    message: string;
}

export interface ProposalQuality {
    evaluatorVersion: string;
    evaluatedAt: string;
    status: EvaluationStatus;
    score: number;
    checks: ProposalQualityCheck[];
}

export interface Proposal extends ProposalContent {
    id: string;
    owner: string;
    connectionId: string;
    action: AssistantAction;
    createdAt: string;
    baseSql: string;
    responseId: string;
    model: string;
    promptVersion: string;
    contextSummary: string[];
    decision: ProposalDecision;
    quality?: ProposalQuality;
    decidedAt?: string;
}

export interface AssistantEvaluationReport {
    evaluatorVersion: string;
    total: number;
    pending: number;
    accepted: number;
    rejected: number;
    acceptanceRate: number | null;
    evaluated: number;
    qualityPassRate: number | null;
    safetyPassRate: number | null;
    semanticPassRate: number | null;
    averageScore: number | null;
    latest: Array<
        Pick<Proposal, 'id' | 'action' | 'decision' | 'createdAt'> & {
            status: EvaluationStatus | 'unknown';
            score: number | null;
        }
    >;
    benchmark: {
        total: number;
        passed: number;
        score: number;
        mode: 'static';
    };
}
