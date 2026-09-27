/** Values remain lossless JSON: Int64/UInt64 and Decimal arrive as strings. */
export type Json = null | boolean | number | string | Json[] | {
    [key: string]: Json;
};
export type Row = Json[];
export interface Column {
    name: string;
    type: string;
}
export interface Limits {
    rows: number;
    bytes: number;
    seconds: number;
    memory: number;
    threads: number;
}
export const DEFAULT_LIMITS: Readonly<Limits> = Object.freeze({
    rows: 5000, bytes: 2000000, seconds: 30, memory: 536870912, threads: 4,
});
export const HARD_LIMITS: Readonly<Limits> = Object.freeze({
    rows: 20000, bytes: 5000000, seconds: 120, memory: 1073741824, threads: 8,
});
export type Capability = {
    available: boolean;
    reason?: string;
};
export type RunKind = 'query' | 'explain' | 'plan' | 'pipeline' | 'analyze';
export interface Manifest {
    version: 1;
    serverVersion: string;
    testedAt: string;
    schema: Capability;
    progress: Capability;
    cancellation: Capability;
    explain: Capability;
    explainPlan?: Capability;
    explainAnalyze?: Capability;
    /** Server-side semantic tree produced by EXPLAIN QUERY TREE. */
    queryTree?: Capability;
    /** Running EXPLAIN PIPELINE as a query is separate from loading structured pipeline evidence. */
    explainPipeline?: Capability;
    pipeline: Capability;
    queryLog: Capability;
    queryLogSource?: 'user_query_log' | 'query_log';
    traceLog?: Capability;
    replication?: Capability;
    documentation: Capability;
    import: Capability;
    scripts: Capability;
    parameters: Capability;
}
export interface Connection {
    dataSource?: 'clickhouse' | 'fixture';
    id: string;
    name: string;
    host: string;
    database: string;
    username: string;
    readonly: boolean;
    limits: Limits;
    manifest?: Manifest;
}
export interface SchemaColumn extends Column {
    database: string;
    table: string;
    defaultKind: string;
    comment: string;
}
export interface SchemaProjection {
    name: string;
    type: string;
    sortingKey: string;
}
export interface SchemaSkipIndex {
    name: string;
    type: string;
    expression: string;
    granularity: string;
}
export interface SchemaTable {
    database: string;
    name: string;
    engine: string;
    orderBy?: string;
    primaryKey?: string;
    partitionKey?: string;
    samplingKey?: string;
    ttlConfigured?: boolean;
    materializedViewTarget?: string;
    rowEstimate?: string | null;
    sizeBytes?: string | null;
    uncompressedBytes?: string | null;
    parts?: string | null;
    activeParts?: string | null;
    skipIndexTypes?: string[];
    projections?: SchemaProjection[];
    skipIndexes?: SchemaSkipIndex[];
}
export interface SchemaDictionary {
    database: string;
    name: string;
    status: string;
    type: string;
    keyColumns: string;
    attributeColumns: string;
    elementCount: string;
    memoryBytes: string;
    lastSuccessfulUpdate: string;
}
export interface Schema {
    connectionId: string;
    fetchedAt: string;
    columns: SchemaColumn[];
    tables: SchemaTable[];
    dictionaries?: SchemaDictionary[];
    warnings: string[];
    metadataWarnings?: string[];
    truncated: boolean;
}
export type ReferenceCategory = 'all' | 'functions' | 'types' | 'engines' | 'settings' | 'system' | 'formats' | 'sql';
export interface ClickHouseDocumentationSummary {
    name: string;
    type: string;
    source?: string;
}
export interface ClickHouseDocumentationEntry extends ClickHouseDocumentationSummary {
    description: string;
    serverVersion: string;
    origin: 'native' | 'bundled';
}
export interface Principal {
    id: string;
    role: 'owner' | 'viewer';
}
export interface RunRequest {
    clientRequestId: string;
    connectionId: string;
    documentId?: string;
    sql: string;
    kind?: RunKind;
    parameters?: Record<string, string>;
    limits?: Partial<Limits>;
    tags?: Record<string, string>;
    parentRunId?: string;
    sourceFrom?: number;
    sourceTo?: number;
}
export type RunStatus = 'queued' | 'running' | 'succeeded' | 'truncated' | 'failed' | 'cancelled' | 'timed_out' | 'interrupted';
export interface Progress {
    readRows: string;
    readBytes: string;
    elapsedMs: number;
    memory?: string;
}
export interface Run {
    dataSource: 'clickhouse' | 'fixture';
    id: string;
    queryId: string;
    owner: string;
    connectionId: string;
    documentId?: string;
    sql: string;
    sourceFrom?: number;
    sourceTo?: number;
    kind: RunKind;
    parameters: Record<string, string>;
    limits: Limits;
    tags: Record<string, string>;
    parentRunId?: string;
    status: RunStatus;
    createdAt: string;
    startedAt?: string;
    finishedAt?: string;
    elapsedMs: number;
    rowCount: number;
    writtenRows?: number;
    bytes: number;
    columns: Column[];
    progress?: Progress;
    warnings: string[];
    error?: ApiError;
    sequence: number;
    resultExpiresAt?: string;
    resultState: 'pending' | 'reopenable' | 'expired' | 'unavailable';
    requestedBy: string;
    executedAs: string;
    permissionSnapshot: {
        readonly: boolean;
        role: string;
    };
    retryPolicy: 'never';
    traceId?: string;
    serverVersion?: string;
}
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
export type ProfilePipelineNodeKind = 'read' | 'filter' | 'aggregate' | 'sort' | 'resize' | 'join' | 'transform' | 'output' | 'stage';
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
export interface ApiError {
    code: string;
    message: string;
    remediation?: string;
    position?: number;
}
export interface Result {
    runId: string;
    queryId: string;
    columns: Column[];
    rows: Row[];
    completeness: 'complete' | 'truncated';
    createdAt: string;
    expiresAt: string;
}
export interface ResultPage extends Omit<Result, 'rows'> {
    rows: Row[];
    offset: number;
    totalRows: number;
    nextOffset: number | null;
}
export interface RunEvent {
    sequence: number;
    type: 'state' | 'progress';
    run: Run;
}
export interface Script {
    id: string;
    owner: string;
    connectionId: string;
    sql: string;
    createdAt: string;
    status: 'running' | 'succeeded' | 'partial' | 'failed' | 'cancelled' | 'interrupted';
    stopOnError: boolean;
    cancelled: boolean;
    statements: {
        sql: string;
        from: number;
        to: number;
        runId?: string;
        status: 'pending' | 'skipped' | RunStatus;
        error?: ApiError;
    }[];
}
export type ChartKind = 'table' | 'number' | 'line' | 'bar' | 'scatter' | 'heatmap' | 'candlestick';
export interface CandlestickConfig {
    open?: number;
    high?: number;
    low?: number;
    close?: number;
    bid?: number;
    ask?: number;
    spread?: number;
    quoteActivity?: number;
}
export interface ChartConfig {
    kind: ChartKind;
    x: number;
    groupBy?: number;
    ys: number[];
    title: string;
    candlestick?: CandlestickConfig;
}
export interface QueryDocument {
    id: string;
    owner: string;
    name: string;
    connectionId: string;
    sql: string;
    revision: number;
    createdAt: string;
    updatedAt: string;
    deletedAt?: string;
    parameters: Record<string, string>;
    chart: ChartConfig;
    runId?: string;
    parentDocumentId?: string;
    dependencies: string[];
    kind: 'query' | 'snippet' | 'metric';
    metric?: MetricContract;
    verifiedRevision?: number;
    publishedRevision?: number;
}
export interface MetricContract {
    definition: string;
    grain: string;
    dimensions: string[];
    timezone: string;
    filters: string;
    nullTreatment: string;
    sourceColumns: string[];
}
export interface Published {
    id: string;
    owner: string;
    documentId: string;
    revision: number;
    publishedAt: string;
    expiresAt: string;
    document: QueryDocument;
    run: Run;
    result: Result;
    resultLifetime: 'snapshot';
    source: 'live-run' | 'imported' | 'fixture';
}
export interface Comment {
    id: string;
    owner: string;
    documentId: string;
    revision: number;
    text: string;
    createdAt: string;
    anchor: {
        from?: number;
        to?: number;
        runId?: string;
        column?: number;
    };
}
export interface AuditEvent {
    id: string;
    at: string;
    owner: string;
    action: string;
    resourceId: string;
    outcome: 'allowed' | 'denied' | 'failed';
    ruleId?: string;
}
export type AssistantAction = 'ask' | 'generate' | 'explain' | 'repair' | 'result' | 'performance' | 'review';
export interface AssistantConversationMessage {
    role: 'user' | 'assistant';
    content: string;
}
export interface AssistantSource {
    title: string;
    url: string;
}
export interface ProposalContent {
    sql: string | null;
    summary: string;
    assumptions: string[];
    tables: string[];
    caveats: string[];
    clarification: string | null;
    sources?: AssistantSource[];
    findings: {
        severity: 'high' | 'medium' | 'low';
        message: string;
        evidence: string;
    }[];
}
export type EvaluationStatus = 'pass' | 'warn' | 'fail';
export interface ProposalQualityCheck {
    id: 'contract' | 'safety' | 'grounding' | 'semantic';
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
    decision: 'pending' | 'accepted' | 'rejected';
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
    latest: Array<Pick<Proposal, 'id' | 'action' | 'decision' | 'createdAt'> & { status: EvaluationStatus | 'unknown'; score: number | null }>;
    benchmark: {
        total: number;
        passed: number;
        score: number;
        mode: 'static';
    };
}
export interface Monitor {
    id: string;
    owner: string;
    publishedId: string;
    intervalSeconds: number;
    paused: boolean;
    createdAt: string;
    nextAt: string;
    lastRunId?: string;
    lastHash?: string;
    condition: 'changed' | 'nonempty' | 'failure';
}
export interface Notice {
    id: string;
    owner: string;
    monitorId: string;
    runId: string;
    createdAt: string;
    reason: 'changed' | 'nonempty' | 'failure';
    read: boolean;
}
