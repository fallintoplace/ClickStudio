import test from 'node:test';
import assert from 'node:assert/strict';
import { PLAYGROUND_STARTER_SQL } from '../../.workspace-build/web/playground.js';
import { sqlExamplesFor } from '../../.workspace-build/web/sql-examples.js';
import { ONTIME_FLIGHT_DELAY_EXAMPLE } from '../../.workspace-build/shared/assistant-examples.js';
import { hasSqlExampleTranslation, localizeSqlExample } from '../../.workspace-build/web/sql-examples-locales.js';

test('SQL example catalogs match the selected Playground or fixture source', () => {
    const playground = sqlExamplesFor({ id: 'playground', dataSource: 'clickhouse' });
    const fixtures = sqlExamplesFor({ id: 'demo', dataSource: 'fixture' });
    const starter = playground.find(example => example.id === 'github-recent-events');

    assert.equal(starter?.sql, PLAYGROUND_STARTER_SQL);
    assert.ok(playground.some(example => example.name === 'Daily activity' && example.sql.includes('FROM github.events')));
    assert.ok(fixtures.some(example => example.name === 'Top countries' && example.sql.includes('FROM events')));
    assert.notEqual(fixtures[0]?.sql, starter?.sql);
    assert.equal(new Set(playground.map(example => example.id)).size, playground.length);
    assert.equal(new Set(fixtures.map(example => example.id)).size, fixtures.length);
});

test('Playground examples use ClickHouse-owned datasets with chart-ready result shapes', () => {
    const examples = sqlExamplesFor({ id: 'playground', dataSource: 'clickhouse' });
    const byId = new Map(examples.map(example => [example.id, example]));
    const cases = [
        ['hackernews-daily-pulse', 'Hacker News', 'line', 'FROM hackernews.hackernews'],
        ['nyc-taxi-weekly-rhythm', 'NYC Taxi', 'heatmap', 'FROM nyc_taxi.trips_small'],
        ['nyc-taxi-fare-distance', 'NYC Taxi', 'scatter', 'FROM nyc_taxi.trips_small'],
        ['bluesky-activity-by-hour', 'Bluesky', 'heatmap', 'FROM bluesky.events_per_hour_of_day'],
        ['stock-jnj-history', 'Stock sample', 'line', 'FROM stock.stock'],
    ];

    for (const [id, dataset, kind, table] of cases) {
        const example = byId.get(id);
        assert.ok(example, `missing ${id}`);
        assert.equal(example.dataset, dataset);
        assert.equal(example.chart.kind, kind);
        assert.ok(example.sql.includes(table), `${id} should query ${table}`);
        assert.match(example.sql, /^SELECT\b/);
    }

    assert.deepEqual(byId.get('hackernews-daily-pulse')?.chart.ys, [1, 2]);
    for (const id of ['nyc-taxi-weekly-rhythm', 'bluesky-activity-by-hour']) {
        const chart = byId.get(id)?.chart;
        assert.ok(chart?.kind === 'heatmap');
        assert.notEqual(chart.x, chart.groupBy);
        assert.ok(chart.groupBy !== undefined && !chart.ys.includes(chart.groupBy));
        assert.ok(!chart.ys.includes(chart.x));
    }
    assert.match(byId.get('nyc-taxi-fare-distance')?.sql ?? '', /LIMIT 240\s*$/);
    assert.match(byId.get('stock-jnj-history')?.description ?? '', /historical/i);
});

test('The Playground flight example uses the same SQL included in Ask AI context', () => {
    const example = sqlExamplesFor({ id: 'playground', dataSource: 'clickhouse' })
        .find(item => item.id === ONTIME_FLIGHT_DELAY_EXAMPLE.id);

    assert.ok(example);
    assert.equal(example.name, ONTIME_FLIGHT_DELAY_EXAMPLE.name);
    assert.equal(example.dataset, ONTIME_FLIGHT_DELAY_EXAMPLE.dataset);
    assert.equal(example.sql, ONTIME_FLIGHT_DELAY_EXAMPLE.sql);
});

test('new Playground examples have unique read-only queries and valid chart column indexes', () => {
    const examples = sqlExamplesFor({ id: 'playground', dataSource: 'clickhouse' });
    const byId = new Map(examples.map(example => [example.id, example]));
    const cases = [
        ['amazon-customer-review-health', 'Amazon Reviews', 'bar', 'FROM amazon.amazon_reviews', 5, [1, 2, 3], 0],
        ['otel-service-latency-slo', 'OpenTelemetry', 'line', 'FROM otel_v2.otel_traces', 4, [1, 2, 3], 0],
        ['ontime-flight-delay-operations', 'US flights', 'heatmap', 'FROM ontime.ontime', 3, [2], 1, 0],
        ['stackoverflow-technology-trends', 'Stack Overflow', 'line', 'FROM stackoverflow.posts', 5, [1, 2, 3, 4], 0],
        ['pypi-package-downloads', 'PyPI', 'heatmap', 'FROM pypi.pypi_downloads_per_month', 3, [2], 0, 1],
        ['stackoverflow-qa-volume', 'Stack Overflow', 'line', 'FROM stackoverflow.posts', 3, [1, 2], 0],
        ['uk-house-prices-by-county', 'UK property data', 'bar', 'FROM uk.uk_price_paid', 3, [1], 0],
        ['imdb-ratings-by-year', 'IMDb', 'scatter', 'FROM imdb.movies', 2, [1], 0],
        ['noaa-central-park-weather', 'NOAA weather', 'heatmap', 'FROM noaa.noaa', 3, [2], 0, 1],
        ['forex-eur-usd-monthly', 'Forex', 'line', 'FROM forex.forex', 2, [1], 0],
        ['nyc-taxi-fare-quantiles', 'NYC Taxi', 'heatmap', 'FROM nyc_taxi.trips_small', 4, [2], 1, 0],
        ['github-rolling-activity', 'GitHub', 'line', 'FROM github.events', 3, [1, 2], 0],
    ];

    for (const [id, dataset, kind, table, columnCount, measures, x, groupBy] of cases) {
        const example = byId.get(id);
        assert.ok(example, `missing ${id}`);
        assert.equal(example.dataset, dataset);
        assert.equal(example.chart.kind, kind);
        assert.equal(example.chart.x, x);
        assert.deepEqual(example.chart.ys, measures);
        if (groupBy === undefined) assert.equal(example.chart.groupBy, undefined);
        else assert.equal(example.chart.groupBy, groupBy);
        assert.ok(example.sql.includes(table), `${id} should query ${table}`);
        assert.match(example.sql, /^(?:SELECT|WITH)\b/);
        assert.doesNotMatch(example.sql, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|OPTIMIZE|KILL)\b/i);
        assert.ok([example.chart.x, ...example.chart.ys, ...(example.chart.groupBy === undefined ? [] : [example.chart.groupBy])]
            .every(index => Number.isInteger(index) && index >= 0 && index < columnCount));
    }

    assert.equal(new Set(examples.map(example => example.id)).size, examples.length);
    assert.match(byId.get('pypi-package-downloads')?.sql ?? '', /LIMIT 100\s*$/);
    assert.match(byId.get('stackoverflow-qa-volume')?.sql ?? '', /LIMIT 100\s*$/);
    assert.match(byId.get('uk-house-prices-by-county')?.sql ?? '', /LIMIT 12\s*$/);
    assert.match(byId.get('imdb-ratings-by-year')?.sql ?? '', /LIMIT 200\s*$/);
    assert.match(byId.get('noaa-central-park-weather')?.sql ?? '', /LIMIT 240\s*$/);
});


test('Featured Playground examples lead with enterprise workflows', () => {
    const examples = sqlExamplesFor({ id: 'playground', dataSource: 'clickhouse' });
    const featured = examples
        .filter(example => example.featuredOrder !== undefined)
        .sort((left, right) => left.featuredOrder - right.featuredOrder);

    assert.deepEqual(featured.slice(0, 4).map(example => example.id), [
        'amazon-customer-review-health',
        'otel-service-latency-slo',
        'ontime-flight-delay-operations',
        'stackoverflow-technology-trends',
    ]);
    assert.deepEqual(featured.slice(0, 4).map(example => example.category), [
        'business',
        'observability',
        'operations',
        'engineering',
    ]);
});

test('curated, fixture, and generic SQL examples have localized titles and descriptions', () => {
    const catalogs = [
        sqlExamplesFor({ id: 'playground', dataSource: 'clickhouse' }),
        sqlExamplesFor({ id: 'demo', dataSource: 'fixture' }),
        sqlExamplesFor({ id: 'production', dataSource: 'clickhouse' }),
    ];
    const examples = [...new Map(catalogs.flat().map(example => [example.id, example])).values()];
    const locales = ['de', 'es', 'nl', 'zh', 'ru'];

    for (const example of examples) {
        for (const locale of locales) {
            assert.ok(hasSqlExampleTranslation(example.id, locale), `${example.id} is missing ${locale} copy`);
            const localized = localizeSqlExample(example, locale);
            assert.ok(localized.name.trim().length > 0);
            assert.ok(localized.description.trim().length > 0);
        }
    }
});

test('SQL examples use safe generic queries until a real connection schema is available', () => {
    const connection = { id: 'production', dataSource: 'clickhouse' };
    const generic = sqlExamplesFor(connection);
    assert.deepEqual(generic.map(example => example.name), [
        'ClickHouse version', 'Server time', 'Generate a number series',
        'Native Point cities', 'Intercontinental flight paths', 'Colorful delivery zones',
    ]);
    assert.ok(generic.every(example => /^SELECT/.test(example.sql)));

    const schema = {
        connectionId: 'production', fetchedAt: '2026-09-24T00:00:00.000Z', columns: [], warnings: [], truncated: false,
        tables: [
            { database: 'system', name: 'tables' },
            { database: 'information_schema', name: 'columns' },
            { database: 'analytics`archive', name: 'event`log' },
        ],
    };
    const examples = sqlExamplesFor(connection, schema);
    const preview = examples.find(example => example.name === 'Preview analytics`archive.event`log');
    assert.ok(preview);
    assert.match(preview.sql, /FROM `analytics``archive`\.`event``log`\nLIMIT 50$/);
    assert.equal(examples.some(example => example.name.includes('system.') || example.name.includes('information_schema.')), false);
});

test('Offline examples cover common analytics patterns with bounded chart columns', () => {
    const examples = sqlExamplesFor({ id: 'demo', dataSource: 'fixture' });
    const byId = new Map(examples.map(example => [example.id, example]));
    const cases = [
        ['preview-starter-monthly-revenue', 'FROM orders', 'line', 3],
        ['preview-starter-channel-conversion', 'FROM sessions', 'bar', 4],
        ['preview-starter-signup-cohorts', 'FROM users', 'line', 4],
        ['preview-starter-product-page-conversion', 'FROM events', 'bar', 4],
    ];

    for (const [id, table, kind, columnCount] of cases) {
        const example = byId.get(id);
        assert.ok(example, `missing ${id}`);
        assert.ok(example.sql.includes(table));
        assert.match(example.sql, /^(?:SELECT|WITH)\b/);
        assert.doesNotMatch(example.sql, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|OPTIMIZE|KILL)\b/i);
        assert.equal(example.chart.kind, kind);
        assert.ok([example.chart.x, ...example.chart.ys, ...(example.chart.groupBy === undefined ? [] : [example.chart.groupBy])]
            .every(index => Number.isInteger(index) && index >= 0 && index < columnCount));
    }

    assert.equal(new Set(examples.map(example => example.id)).size, examples.length);
    assert.ok(examples.length > 13);
});

test('Schema examples expose only the first six non-system tables', () => {
    const connection = { id: 'production', dataSource: 'clickhouse' };
    const schema = {
        connectionId: 'production', fetchedAt: '', columns: [], warnings: [], truncated: false,
        tables: [
            ...Array.from({ length: 8 }, (_, index) => ({ database: 'analytics', name: `table_${index}` })),
            { database: 'system', name: 'tables' },
        ],
    };
    const tableExamples = sqlExamplesFor(connection, schema).filter(example => example.category === 'schema');
    assert.equal(tableExamples.length, 6);
    assert.deepEqual(tableExamples.map(example => example.name), Array.from({ length: 6 }, (_, index) => `Preview analytics.table_${index}`));
});
