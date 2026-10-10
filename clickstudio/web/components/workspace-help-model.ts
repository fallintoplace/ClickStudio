import type { Copy, Locale } from '../i18n.js';
import type { SqlExample, SqlExampleCategory } from '../sql-examples.js';
import { localizeSqlExample, localizeSqlExampleCategory } from '../sql-examples-locales.js';

type HelpSectionIcon =
    | 'help'
    | 'examples'
    | 'play'
    | 'assistant'
    | 'observability'
    | 'parser'
    | 'chart'
    | 'bolt'
    | 'database'
    | 'pipeline'
    | 'history'
    | 'reference';

export type HelpPanelSection =
    | 'tour'
    | 'examples'
    | 'workflows'
    | 'assistant'
    | 'monitoring'
    | 'query'
    | 'geo'
    | 'explain'
    | 'storage'
    | 'dependencies'
    | 'compare'
    | 'reference';
export type CategoryFilter = SqlExampleCategory | 'charts' | 'all' | 'featured';

export const helpCategories: CategoryFilter[] = [
    'featured',
    'all',
    'business',
    'observability',
    'operations',
    'engineering',
    'markets',
    'cities',
    'openSource',
    'internet',
    'datasets',
    'clickhouse',
    'writeOperations',
    'charts',
    'basics',
    'aggregation',
    'timeSeries',
    'schema',
];

export function categoryLabel(category: CategoryFilter, copy: Copy['common'], locale: Locale) {
    if (category === 'all') return copy.allExamples;
    if (category === 'featured') return localizeSqlExampleCategory(category, locale, 'Featured');
    if (category === 'business') return localizeSqlExampleCategory(category, locale, 'Business');
    if (category === 'observability')
        return localizeSqlExampleCategory(category, locale, 'Observability');
    if (category === 'operations')
        return localizeSqlExampleCategory(category, locale, 'Operations');
    if (category === 'engineering')
        return localizeSqlExampleCategory(category, locale, 'Engineering');
    if (category === 'markets') return localizeSqlExampleCategory(category, locale, 'Markets');
    if (category === 'cities') return localizeSqlExampleCategory(category, locale, 'Cities');
    if (category === 'openSource')
        return localizeSqlExampleCategory(category, locale, 'Open source');
    if (category === 'internet') return localizeSqlExampleCategory(category, locale, 'Internet');
    if (category === 'datasets') return localizeSqlExampleCategory(category, locale, 'Datasets');
    if (category === 'writeOperations') return copy.exampleWriteOperations;
    if (category === 'basics') return copy.exampleBasics;
    if (category === 'aggregation') return copy.exampleAggregation;
    if (category === 'timeSeries') return copy.exampleTimeSeries;
    if (category === 'charts') return copy.exampleCharts;
    if (category === 'clickhouse') return copy.exampleClickHouse;
    return copy.exampleSchema;
}

export function chartLabel(example: SqlExample, copy: Copy['common']) {
    switch (example.chart.kind) {
        case 'table':
            return copy.exampleChartTable;
        case 'number':
            return copy.exampleChartNumber;
        case 'line':
            return copy.exampleChartLine;
        case 'bar':
            return copy.exampleChartBar;
        case 'scatter':
            return copy.exampleChartScatter;
        case 'heatmap':
            return copy.exampleChartHeatmap;
        case 'candlestick':
            return copy.exampleChartCandlestick;
        default:
            return copy.chart;
    }
}

export function exampleText(example: SqlExample, locale: Locale, copy: Copy['common']) {
    if (example.category === 'schema') {
        const tableName = example.name.replace(/^Preview /, '');
        return {
            name: copy.examplePreviewTable.replace('{table}', tableName),
            description: copy.exampleReadRows,
        };
    }
    return localizeSqlExample(example, locale);
}

export type HelpSectionDefinition = {
    id: HelpPanelSection;
    label: string;
    description: string;
    icon: HelpSectionIcon;
    experimental?: boolean;
};

export function helpSections(copy: Copy['common']): HelpSectionDefinition[] {
    return [
        { id: 'tour', label: copy.helpTour, description: copy.helpTourDescription, icon: 'help' },
        {
            id: 'examples',
            label: copy.sqlExamples,
            description: copy.examplesHint,
            icon: 'examples',
        },
        {
            id: 'workflows',
            label: copy.helpQueryWorkflows,
            description: copy.helpQueryWorkflowsDescription,
            icon: 'play',
        },
        {
            id: 'assistant',
            label: copy.helpAssistant,
            description: copy.helpAssistantDescription,
            icon: 'assistant',
        },
        {
            id: 'reference',
            label: copy.helpReference,
            description: copy.helpReferenceDescription,
            icon: 'reference',
        },
        {
            id: 'monitoring',
            label: copy.helpMonitoring,
            description: copy.helpMonitoringDescription,
            icon: 'observability',
            experimental: true,
        },
        {
            id: 'query',
            label: copy.helpQueryEngine,
            description: copy.helpQueryEngineDescription,
            icon: 'parser',
            experimental: true,
        },
        {
            id: 'geo',
            label: copy.helpGeo,
            description: copy.helpGeoDescription,
            icon: 'chart',
            experimental: true,
        },
        {
            id: 'explain',
            label: copy.helpExplain,
            description: copy.helpExplainDescription,
            icon: 'bolt',
            experimental: true,
        },
        {
            id: 'storage',
            label: copy.helpStorage,
            description: copy.helpStorageDescription,
            icon: 'database',
            experimental: true,
        },
        {
            id: 'dependencies',
            label: copy.helpDependencies,
            description: copy.helpDependenciesDescription,
            icon: 'pipeline',
            experimental: true,
        },
        {
            id: 'compare',
            label: copy.helpCompareRuns,
            description: copy.helpCompareRunsDescription,
            icon: 'history',
            experimental: true,
        },
    ];
}
