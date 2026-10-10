export const ASSISTANT_ACTIONS = [
    'ask',
    'generate',
    'explain',
    'repair',
    'result',
    'performance',
    'review',
] as const;
export type AssistantAction = (typeof ASSISTANT_ACTIONS)[number];

export const FINDING_SEVERITIES = ['high', 'medium', 'low'] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

export const EVALUATION_STATUSES = ['pass', 'warn', 'fail'] as const;
export type EvaluationStatus = (typeof EVALUATION_STATUSES)[number];

export const QUALITY_CHECK_IDS = ['contract', 'safety', 'grounding', 'semantic'] as const;
export type QualityCheckId = (typeof QUALITY_CHECK_IDS)[number];

export const PROPOSAL_DECISION_ACTIONS = ['accepted', 'rejected'] as const;
export type ProposalDecisionAction = (typeof PROPOSAL_DECISION_ACTIONS)[number];
export const PROPOSAL_DECISIONS = ['pending', ...PROPOSAL_DECISION_ACTIONS] as const;
export type ProposalDecision = (typeof PROPOSAL_DECISIONS)[number];
