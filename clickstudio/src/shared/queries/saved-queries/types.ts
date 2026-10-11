import type { ChartConfig } from '../results/chart-settings.js';
import type { Run } from '../execution/types.js';
import type { Result } from '../results/types.js';

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
