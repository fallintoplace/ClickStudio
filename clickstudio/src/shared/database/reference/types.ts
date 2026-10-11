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
