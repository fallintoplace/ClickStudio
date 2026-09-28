import assert from 'node:assert/strict';
import test from 'node:test';
import { tsImport } from 'tsx/esm/api';

const { categoryLabel, exampleText, helpCategories } =
    await tsImport('../../web/components/workspace-help-model.ts', import.meta.url);
const { getCopy, supportedLocales } = await import('../../.workspace-build/web/i18n.js');
const { localizeSqlExampleCategory } = await import('../../.workspace-build/web/sql-examples-locales.js');

const translatedCategories = {
    featured: 'Featured',
    business: 'Business',
    observability: 'Observability',
    operations: 'Operations',
    engineering: 'Engineering',
    markets: 'Markets',
    cities: 'Cities',
    openSource: 'Open source',
    internet: 'Internet',
    datasets: 'Datasets',
};
const copyCategories = {
    all: 'allExamples',
    writeOperations: 'exampleWriteOperations',
    basics: 'exampleBasics',
    aggregation: 'exampleAggregation',
    timeSeries: 'exampleTimeSeries',
    charts: 'exampleCharts',
    clickhouse: 'exampleClickHouse',
    schema: 'exampleSchema',
};

test('Every Help category has an explicit label contract', () => {
    const categories = [...Object.keys(translatedCategories), ...Object.keys(copyCategories)];
    assert.deepEqual([...helpCategories].sort(), categories.sort());
    assert.equal(new Set(helpCategories).size, helpCategories.length);
});

for (const locale of supportedLocales) {
    test(`Help categories use the selected locale: ${locale}`, () => {
        const copy = getCopy(locale).common;
        for (const [category, fallback] of Object.entries(translatedCategories)) {
            assert.equal(
                categoryLabel(category, copy, locale),
                localizeSqlExampleCategory(category, locale, fallback),
                `${locale}: ${category}`,
            );
        }
        for (const [category, key] of Object.entries(copyCategories)) {
            assert.equal(categoryLabel(category, copy, locale), copy[key], `${locale}: ${category}`);
        }
    });
}

test('Schema preview labels preserve literal table names and repeated placeholders', () => {
    const tableName = 'orders_$&_{count}';
    const copy = {
        ...getCopy('en').common,
        examplePreviewTable: '{table}: preview {table}',
    };
    const example = { category: 'schema', name: `Preview ${tableName}` };
    assert.deepEqual(exampleText(example, 'en', copy), {
        name: `${tableName}: preview ${tableName}`,
        description: copy.exampleReadRows,
    });
});
