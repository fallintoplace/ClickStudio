import test from 'node:test';
import assert from 'node:assert/strict';
import {
    REFERENCE_CATEGORIES,
    REFERENCE_TYPES_BY_CATEGORY,
    buildReferenceEntryQuery,
    buildReferenceSearchQuery,
    isMissingDocumentationSourceColumn,
    isReferenceCategory,
    referenceId,
} from '../../.workspace-build/shared/reference.js';
import {
    BUNDLED_REFERENCE,
    findBundledReference,
    searchBundledReference,
} from '../../.workspace-build/web/reference-data.js';

test('Reference categories stay explicit and reject unknown URL values', () => {
    assert.deepEqual(REFERENCE_CATEGORIES, [
        'all',
        'functions',
        'types',
        'engines',
        'settings',
        'system',
        'formats',
        'sql',
    ]);
    assert.equal(isReferenceCategory('system'), true);
    assert.equal(isReferenceCategory('formats'), true);
    assert.equal(isReferenceCategory('sql'), true);
    assert.equal(isReferenceCategory('Functions'), false);
    assert.equal(isReferenceCategory('unknown'), false);
    assert.ok(REFERENCE_TYPES_BY_CATEGORY.engines.includes('Table Engine'));
});

test('Reference search keeps user text in query parameters and returns the full catalog', () => {
    const input = "%' OR 1 = 1 --";
    const query = buildReferenceSearchQuery(input, 'all');
    assert.equal(query.parameters.search, input);
    assert.equal(query.sql.includes(input), false);
    assert.doesNotMatch(query.sql, /\bLIMIT\s+\d+\s*$/i);
    assert.doesNotMatch(query.sql, /tuple\(toString\(type\), name\) IN/);
    assert.match(query.sql, /positionCaseInsensitive\(name, \{search:String\}\)/);
    assert.match(query.sql, /lower\(name\) = lower\(\{search:String\}\)/);
});

test('Reference search ranks popular empty-query results and scopes category filters', () => {
    const popular = buildReferenceSearchQuery('', 'all');
    assert.match(popular.sql, /indexOf\(\['Aggregate Function:quantileExact'/);
    assert.doesNotMatch(popular.sql, /tuple\(toString\(type\), name\) IN/);
    assert.equal(popular.parameters.search, '');

    const engines = buildReferenceSearchQuery('Merge', 'engines');
    assert.match(engines.sql, /type IN \('Table Engine', 'Database Engine'/);
    assert.equal(engines.parameters.search, 'Merge');
    assert.match(buildReferenceSearchQuery('', 'formats').sql, /type IN \('Format'\)/);
    assert.match(buildReferenceSearchQuery('select', 'sql').sql, /'Statement'.*'SQL Statement'/);
    assert.doesNotMatch(
        buildReferenceSearchQuery('q'.repeat(200), 'all').parameters.search,
        /q{129}/,
    );
    assert.equal(buildReferenceSearchQuery('q'.repeat(200), 'all').parameters.search.length, 128);
});

test('Reference entry SQL parameterizes identity and supports servers without source metadata', () => {
    const withSource = buildReferenceEntryQuery();
    const withoutSource = buildReferenceEntryQuery(false);
    assert.match(withSource, /name = \{name:String\} AND toString\(type\) = \{type:String\}/);
    assert.match(withSource, /description, source, version\(\) AS serverVersion/);
    assert.doesNotMatch(withoutSource, /source/);
});

test('Reference identifiers keep types distinct when names overlap', () => {
    assert.notEqual(
        referenceId({ name: 'MergeTree', type: 'Table Engine' }),
        referenceId({ name: 'MergeTree', type: 'Function' }),
    );
});

test('Missing documentation source detection handles ClickHouse expression identifier errors', () => {
    assert.equal(
        isMissingDocumentationSourceColumn(
            new Error(
                'Unknown expression identifier `source` in scope SELECT name, source FROM system.documentation',
            ),
        ),
        true,
    );
    assert.equal(isMissingDocumentationSourceColumn(new Error('Unknown identifier: source')), true);
    assert.equal(isMissingDocumentationSourceColumn(new Error("Missing columns: 'source'")), true);
    assert.equal(
        isMissingDocumentationSourceColumn(
            new Error(
                'Unknown expression identifier `description` in scope SELECT description FROM system.documentation',
            ),
        ),
        false,
    );
    assert.equal(
        isMissingDocumentationSourceColumn('Unknown expression identifier `source`'),
        false,
    );
});

test('Bundled references cover the offline ClickHouse documentation and examples', () => {
    assert.ok(BUNDLED_REFERENCE.length >= 3500);
    assert.equal(new Set(BUNDLED_REFERENCE.map(referenceId)).size, BUNDLED_REFERENCE.length);
    assert.ok(BUNDLED_REFERENCE.every(entry => entry.origin === 'bundled'));
    assert.ok(
        BUNDLED_REFERENCE.filter(entry => entry.source?.startsWith('https://')).length >= 3500,
    );
    assert.ok(
        BUNDLED_REFERENCE.filter(entry => entry.description.includes('```sql')).length >= 950,
    );
    assert.match(findBundledReference('query_log', 'System Table').description, /query_log/);
    assert.equal(findBundledReference('query_log', 'Table Engine'), undefined);
    assert.ok(findBundledReference('max_threads_min_free_memory_per_thread', 'Setting'));
    assert.ok(findBundledReference('Decimal(P, S)', 'Data Type'));
});

test('Bundled search ranks popular entries and preserves category boundaries', () => {
    const all = searchBundledReference('', 'all');
    assert.deepEqual(
        all.slice(0, 3).map(entry => entry.name),
        ['quantileExact', 'uniq', 'MergeTree'],
    );
    assert.ok(searchBundledReference('', 'engines').every(entry => entry.type.includes('Engine')));
    assert.ok(
        searchBundledReference('system.query_log', 'system').some(
            entry => entry.name === 'query_log',
        ),
    );
    assert.ok(
        searchBundledReference('system.columns', 'system').some(entry => entry.name === 'columns'),
    );
    assert.ok(
        searchBundledReference('max_execution_time', 'settings').some(
            entry => entry.name === 'max_execution_time',
        ),
    );
    assert.ok(
        searchBundledReference('AggregatingMergeTree', 'engines').some(
            entry => entry.name === 'AggregatingMergeTree',
        ),
    );
    assert.ok(
        searchBundledReference('distinct values', 'functions').some(entry => entry.name === 'uniq'),
    );
    assert.ok(searchBundledReference('max_', 'settings').length > 30);
    assert.ok(searchBundledReference('', 'formats').every(entry => entry.type === 'Format'));
    assert.ok(searchBundledReference('', 'sql').some(entry => entry.type === 'SQL Statement'));
    assert.equal(searchBundledReference('', 'all').length, BUNDLED_REFERENCE.length);
    assert.deepEqual(searchBundledReference('no such reference', 'all'), []);
});
