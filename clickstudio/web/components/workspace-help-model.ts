import type { Copy, Locale } from '../i18n';
import { formatCopy } from '../i18n-format';
import type { SqlExample, SqlExampleCategory } from '../sql-examples';
import { localizeSqlExample, localizeSqlExampleCategory } from '../sql-examples-locales';
import type { IconName } from './ui';

export type HelpPanelSection = 'tour' | 'examples' | 'workflows' | 'assistant' | 'monitoring' | 'query' | 'geo' | 'explain' | 'storage' | 'dependencies' | 'compare' | 'reference';
export type CategoryFilter = SqlExampleCategory | 'charts' | 'all' | 'featured';

export const helpCategories: readonly CategoryFilter[] = [
    'featured', 'all', 'business', 'observability', 'operations', 'engineering', 'markets', 'cities',
    'openSource', 'internet', 'datasets', 'clickhouse', 'writeOperations', 'charts', 'basics', 'aggregation',
    'timeSeries', 'schema',
];

export function categoryLabel(category: CategoryFilter, copy: Copy['common'], locale: Locale): string {
    switch (category) {
        case 'all': return copy.allExamples;
        case 'featured': return localizeSqlExampleCategory(category, locale, 'Featured');
        case 'business': return localizeSqlExampleCategory(category, locale, 'Business');
        case 'observability': return localizeSqlExampleCategory(category, locale, 'Observability');
        case 'operations': return localizeSqlExampleCategory(category, locale, 'Operations');
        case 'engineering': return localizeSqlExampleCategory(category, locale, 'Engineering');
        case 'markets': return localizeSqlExampleCategory(category, locale, 'Markets');
        case 'cities': return localizeSqlExampleCategory(category, locale, 'Cities');
        case 'openSource': return localizeSqlExampleCategory(category, locale, 'Open source');
        case 'internet': return localizeSqlExampleCategory(category, locale, 'Internet');
        case 'datasets': return localizeSqlExampleCategory(category, locale, 'Datasets');
        case 'writeOperations': return copy.exampleWriteOperations;
        case 'basics': return copy.exampleBasics;
        case 'aggregation': return copy.exampleAggregation;
        case 'timeSeries': return copy.exampleTimeSeries;
        case 'charts': return copy.exampleCharts;
        case 'clickhouse': return copy.exampleClickHouse;
        case 'schema': return copy.exampleSchema;
    }
}

export function chartLabel(example: SqlExample, copy: Copy['common']): string {
    switch (example.chart.kind) {
        case 'table': return copy.exampleChartTable;
        case 'number': return copy.exampleChartNumber;
        case 'line': return copy.exampleChartLine;
        case 'bar': return copy.exampleChartBar;
        case 'scatter': return copy.exampleChartScatter;
        case 'heatmap': return copy.exampleChartHeatmap;
        case 'candlestick': return copy.exampleChartCandlestick;
        default: return copy.chart;
    }
}

export function exampleText(example: SqlExample, locale: Locale, copy: Copy['common']): Readonly<Pick<SqlExample, 'name' | 'description'>> {
    if (example.category === 'schema') {
        const tableName = example.name.replace(/^Preview /, '');
        return {
            name: formatCopy(copy.examplePreviewTable, { table: tableName }),
            description: copy.exampleReadRows,
        };
    }
    return localizeSqlExample(example, locale);
}

export type HelpSectionDefinition = Readonly<{
    id: HelpPanelSection;
    label: string;
    description: string;
    icon: IconName;
}>;

export function helpSections(copy: Copy['common']): HelpSectionDefinition[] {
    return [
        { id: 'tour', label: copy.helpTour, description: copy.helpTourDescription, icon: 'help' },
        { id: 'examples', label: copy.sqlExamples, description: copy.examplesHint, icon: 'examples' },
        { id: 'workflows', label: copy.helpQueryWorkflows, description: copy.helpQueryWorkflowsDescription, icon: 'play' },
        { id: 'assistant', label: copy.helpAssistant, description: copy.helpAssistantDescription, icon: 'assistant' },
        { id: 'monitoring', label: copy.helpMonitoring, description: copy.helpMonitoringDescription, icon: 'observability' },
        { id: 'query', label: copy.helpQueryEngine, description: copy.helpQueryEngineDescription, icon: 'parser' },
        { id: 'geo', label: copy.helpGeo, description: copy.helpGeoDescription, icon: 'chart' },
        { id: 'explain', label: copy.helpExplain, description: copy.helpExplainDescription, icon: 'bolt' },
        { id: 'storage', label: copy.helpStorage, description: copy.helpStorageDescription, icon: 'database' },
        { id: 'dependencies', label: copy.helpDependencies, description: copy.helpDependenciesDescription, icon: 'pipeline' },
        { id: 'compare', label: copy.helpCompareRuns, description: copy.helpCompareRunsDescription, icon: 'history' },
        { id: 'reference', label: copy.helpReference, description: copy.helpReferenceDescription, icon: 'reference' },
    ];
}
