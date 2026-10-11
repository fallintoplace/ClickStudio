export interface ProfileSummary {
    durationMs: number;
    readRows?: string;
    readBytes?: string;
    resultRows: number;
    resultBytes?: string;
    memory?: string;
}

export type ProfileInsightSeverity = 'info' | 'warning' | 'critical';

export interface ProfileInsight {
    id: string;
    severity: ProfileInsightSeverity;
    title: string;
    description: string;
}

export type ProfilePipelineNodeKind =
    'read' | 'filter' | 'aggregate' | 'sort' | 'resize' | 'join' | 'transform' | 'output' | 'stage';

export interface ProfilePipelineNode {
    id: string;
    label: string;
    kind: ProfilePipelineNodeKind;
    detail?: string;
    status: 'measured' | 'estimated' | 'planned';
    durationMs?: number;
    rows?: string;
    bytes?: string;
    parallelism?: number;
    timePercent?: number;
    inputRows?: string;
    outputRows?: string;
    inputBytes?: string;
    outputBytes?: string;
}

export interface ProfilePipelineEdge {
    source: string;
    target: string;
    label?: string;
    flow?: number;
}

export interface ProfilePipeline {
    available: boolean;
    source: 'explain_pipeline' | 'explain_plan' | 'query_shape' | 'explain_analyze';
    nodes: ProfilePipelineNode[];
    edges: ProfilePipelineEdge[];
    raw?: string[];
    truncated?: boolean;
    notice: string;
}

export interface QueryProfile {
    version: 1;
    queryId: string;
    runId: string;
    summary: ProfileSummary;
    insights: ProfileInsight[];
    pipeline: ProfilePipeline;
    capabilities: {
        queryLog: boolean;
        pipelineGraph: boolean;
        indexAnalysis: boolean;
        runtimePlan: boolean;
    };
    evidence: unknown;
    traceUrl?: string;
    notice: string;
}
