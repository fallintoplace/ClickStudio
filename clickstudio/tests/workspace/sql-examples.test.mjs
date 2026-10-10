import test from 'node:test';
import assert from 'node:assert/strict';
import { PLAYGROUND_STARTER_SQL } from '../../.workspace-build/web/playground.js';
import { sqlExamplesFor } from '../../.workspace-build/web/sql-examples.js';
import {
    hasSqlExampleTranslation,
    localizeSqlExample,
} from '../../.workspace-build/web/sql-examples-locales.js';
import { supportedLocales } from '../../.workspace-build/web/i18n.js';

test('SQL example catalogs match the selected Playground or fixture source', () => {
    const playground = sqlExamplesFor({ id: 'playground', dataSource: 'clickhouse' });
    const fixtures = sqlExamplesFor({ id: 'demo', dataSource: 'fixture' });
    const starter = playground.find(example => example.id === 'github-recent-events');

    assert.equal(starter?.sql, PLAYGROUND_STARTER_SQL);
    assert.ok(
        playground.some(
            example =>
                example.name === 'Daily activity' && example.sql.includes('FROM github.events'),
        ),
    );
    assert.ok(
        fixtures.some(
            example => example.name === 'Top countries' && example.sql.includes('FROM events'),
        ),
    );
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

test('new Playground examples have unique read-only queries and valid chart column indexes', () => {
    const examples = sqlExamplesFor({ id: 'playground', dataSource: 'clickhouse' });
    const byId = new Map(examples.map(example => [example.id, example]));
    const cases = [
        [
            'amazon-customer-review-health',
            'Amazon Reviews',
            'bar',
            'FROM amazon.amazon_reviews',
            5,
            [1, 2, 3],
            0,
        ],
        [
            'otel-service-latency-slo',
            'OpenTelemetry',
            'line',
            'FROM otel_v2.otel_traces',
            4,
            [1, 2, 3],
            0,
        ],
        [
            'ontime-flight-delay-operations',
            'US flights',
            'heatmap',
            'FROM ontime.ontime',
            3,
            [2],
            1,
            0,
        ],
        [
            'stackoverflow-technology-trends',
            'Stack Overflow',
            'line',
            'FROM stackoverflow.posts',
            5,
            [1, 2, 3, 4],
            0,
        ],
        [
            'pypi-package-downloads',
            'PyPI',
            'heatmap',
            'FROM pypi.pypi_downloads_per_month',
            3,
            [2],
            0,
            1,
        ],
        [
            'stackoverflow-qa-volume',
            'Stack Overflow',
            'line',
            'FROM stackoverflow.posts',
            3,
            [1, 2],
            0,
        ],
        [
            'uk-house-prices-by-county',
            'UK property data',
            'bar',
            'FROM uk.uk_price_paid',
            3,
            [1],
            0,
        ],
        ['imdb-ratings-by-year', 'IMDb', 'scatter', 'FROM imdb.movies', 2, [1], 0],
        ['noaa-central-park-weather', 'NOAA weather', 'heatmap', 'FROM noaa.noaa', 3, [2], 0, 1],
        ['forex-eur-usd-monthly', 'Forex', 'line', 'FROM forex.forex', 2, [1], 0],
        [
            'nyc-taxi-fare-quantiles',
            'NYC Taxi',
            'heatmap',
            'FROM nyc_taxi.trips_small',
            4,
            [2],
            1,
            0,
        ],
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
        assert.doesNotMatch(
            example.sql,
            /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|OPTIMIZE|KILL)\b/i,
        );
        assert.ok(
            [
                example.chart.x,
                ...example.chart.ys,
                ...(example.chart.groupBy === undefined ? [] : [example.chart.groupBy]),
            ].every(index => Number.isInteger(index) && index >= 0 && index < columnCount),
        );
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

    assert.deepEqual(
        featured.slice(0, 4).map(example => example.id),
        [
            'amazon-customer-review-health',
            'otel-service-latency-slo',
            'ontime-flight-delay-operations',
            'stackoverflow-technology-trends',
        ],
    );
    assert.deepEqual(
        featured.slice(0, 4).map(example => example.category),
        ['business', 'observability', 'operations', 'engineering'],
    );
});

test('curated, fixture, and generic SQL examples have localized titles and descriptions', () => {
    const catalogs = [
        sqlExamplesFor({ id: 'playground', dataSource: 'clickhouse' }),
        sqlExamplesFor({ id: 'demo', dataSource: 'fixture' }),
        sqlExamplesFor({ id: 'production', dataSource: 'clickhouse' }),
    ];
    const examples = [...new Map(catalogs.flat().map(example => [example.id, example])).values()];
    const locales = supportedLocales.filter(locale => locale !== 'en');

    for (const example of examples) {
        for (const locale of locales) {
            assert.ok(
                hasSqlExampleTranslation(example.id, locale),
                `${example.id} is missing ${locale} copy`,
            );
            const localized = localizeSqlExample(example, locale);
            assert.ok(localized.name.trim().length > 0);
            assert.ok(localized.description.trim().length > 0);
        }
    }
});

test('SQL examples use safe generic queries until a real connection schema is available', () => {
    const connection = { id: 'production', dataSource: 'clickhouse' };
    const generic = sqlExamplesFor(connection);
    assert.deepEqual(
        generic.map(example => example.name),
        [
            'ClickHouse version',
            'Server time',
            'Generate a number series',
            'Native Point cities',
            'Intercontinental flight paths',
            'Colorful delivery zones',
        ],
    );
    assert.ok(generic.every(example => /^SELECT/.test(example.sql)));

    const schema = {
        connectionId: 'production',
        fetchedAt: '2026-09-24T00:00:00.000Z',
        columns: [],
        warnings: [],
        truncated: false,
        tables: [
            { database: 'system', name: 'tables' },
            { database: 'information_schema', name: 'columns' },
            { database: 'analytics`archive', name: 'event`log' },
        ],
    };
    const examples = sqlExamplesFor(connection, schema);
    const preview = examples.find(
        example => example.name === 'Preview analytics`archive.event`log',
    );
    assert.ok(preview);
    assert.match(preview.sql, /FROM `analytics``archive`\.`event``log`\nLIMIT 50$/);
    assert.equal(
        examples.some(
            example =>
                example.name.includes('system.') || example.name.includes('information_schema.'),
        ),
        false,
    );
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
        assert.doesNotMatch(
            example.sql,
            /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|OPTIMIZE|KILL)\b/i,
        );
        assert.equal(example.chart.kind, kind);
        assert.ok(
            [
                example.chart.x,
                ...example.chart.ys,
                ...(example.chart.groupBy === undefined ? [] : [example.chart.groupBy]),
            ].every(index => Number.isInteger(index) && index >= 0 && index < columnCount),
        );
    }

    assert.equal(new Set(examples.map(example => example.id)).size, examples.length);
    assert.ok(examples.length > 13);
});

test('Schema examples expose only the first six non-system tables', () => {
    const connection = { id: 'production', dataSource: 'clickhouse' };
    const schema = {
        connectionId: 'production',
        fetchedAt: '',
        columns: [],
        warnings: [],
        truncated: false,
        tables: [
            ...Array.from({ length: 8 }, (_, index) => ({
                database: 'analytics',
                name: `table_${index}`,
            })),
            { database: 'system', name: 'tables' },
        ],
    };
    const tableExamples = sqlExamplesFor(connection, schema).filter(
        example => example.category === 'schema',
    );
    assert.equal(tableExamples.length, 6);
    assert.deepEqual(
        tableExamples.map(example => example.name),
        Array.from({ length: 6 }, (_, index) => `Preview analytics.table_${index}`),
    );
});

function exampleSchema(tables) {
    return {
        connectionId: 'production',
        fetchedAt: '',
        warnings: [],
        truncated: false,
        tables: tables.map(({ columns: _columns, ...table }) => ({
            database: 'analytics',
            engine: 'MergeTree',
            ...table,
        })),
        columns: tables.flatMap(table =>
            (table.columns ?? []).map(column => ({
                database: 'analytics',
                table: table.name,
                comment: '',
                ...column,
            })),
        ),
    };
}

test('Empty Cloud schemas offer generated read queries and separately labeled write examples', () => {
    const schema = exampleSchema([{ database: 'system', name: 'tables' }]);
    const connection = {
        id: 'production',
        dataSource: 'clickhouse',
        database: ' analytics`archive ',
    };
    const examples = sqlExamplesFor(connection, schema);
    const writes = examples.filter(example => example.category === 'writeOperations');
    const generated = examples.filter(example => example.dataset === 'Generated data');
    assert.equal(generated.length, 3);
    assert.ok(generated.every(example => /^(?:SELECT|WITH)\b/.test(example.sql)));
    assert.deepEqual(
        writes.map(example => example.featuredOrder),
        [4, 5],
    );
    assert.match(writes[0].sql, /^CREATE TABLE IF NOT EXISTS `analytics``archive`\./);
    assert.match(writes[1].sql, /^INSERT INTO `analytics``archive`\./);
    assert.ok(
        writes.every(
            example => example.chart.kind === 'table' && /permission/.test(example.description),
        ),
    );
    assert.equal(
        sqlExamplesFor({ ...connection, database: ' ' }, schema).some(
            example => example.category === 'writeOperations',
        ),
        false,
    );
    for (const write of writes) {
        assert.ok(hasSqlExampleTranslation(write.id, 'zh'));
        assert.notEqual(localizeSqlExample(write, 'zh').name, write.name);
    }
});

test('Schema examples use wrapped column types, exclude identifier dimensions, and retain native geometry', () => {
    const schema = exampleSchema([
        {
            name: 'events',
            rowEstimate: '500',
            columns: [
                { name: 'created_at', type: "Nullable(DateTime64(3, 'UTC'))" },
                { name: 'revenue', type: 'Nullable(Decimal(18, 2))' },
                { name: 'country', type: 'LowCardinality(Nullable(String))' },
                { name: 'user_id', type: 'String' },
                { name: 'location', type: 'Point' },
            ],
        },
    ]);
    const examples = sqlExamplesFor({ id: 'production', dataSource: 'clickhouse' }, schema);
    const time = examples.find(example => example.category === 'timeSeries');
    const category = examples.find(example => example.category === 'aggregation');
    const geo = examples.find(example => example.id.startsWith('cloud-geo-native'));
    assert.match(time.sql, /sum\(`revenue`\) AS metric_value/);
    assert.match(time.sql, /`created_at` IS NOT NULL/);
    assert.match(time.sql, /LIMIT 30/);
    assert.match(category.sql, /`country` AS category/);
    assert.doesNotMatch(category.sql, /user_id/);
    assert.match(geo.sql, /SELECT `location` AS location/);
    assert.match(geo.sql, /LIMIT 100$/);
    assert.deepEqual(
        [time, category, geo].map(example => example.featuredOrder),
        [1, 2, 3],
    );

    const identifiersOnly = exampleSchema([
        {
            name: 'users',
            columns: [
                { name: 'user_id', type: 'String' },
                { name: 'session_uuid', type: 'UUID' },
            ],
        },
    ]);
    assert.equal(
        sqlExamplesFor({ id: 'production', dataSource: 'clickhouse' }, identifiersOnly).some(
            example => example.category === 'aggregation',
        ),
        false,
    );
});

test('Large unsampled tables offer only bounded previews until a usable time key is known', () => {
    const table = {
        name: 'events',
        rowEstimate: '1000000',
        columns: [
            { name: 'created_at', type: 'DateTime' },
            { name: 'latency', type: 'Float64' },
            { name: 'country', type: 'String' },
            { name: 'location', type: 'Point' },
        ],
    };
    const connection = { id: 'production', dataSource: 'clickhouse' };
    const unbounded = sqlExamplesFor(connection, exampleSchema([table]));
    assert.equal(
        unbounded.some(example => example.id.startsWith('cloud-')),
        false,
    );
    const bounded = sqlExamplesFor(
        connection,
        exampleSchema([{ ...table, partitionKey: 'toYYYYMM(created_at)' }]),
    );
    const time = bounded.find(example => example.category === 'timeSeries');
    assert.match(time.sql, /avg\(`latency`\) AS metric_value/);
    assert.match(time.sql, /`created_at` >= now\(\) - INTERVAL 30 DAY/);
    assert.doesNotMatch(time.sql, /SAMPLE/);
    assert.equal(
        bounded.some(example => example.category === 'aggregation'),
        false,
    );
});

for (const [measure, expected] of [
    [{ name: 'revenue', type: 'UInt64' }, 'sum(`revenue` * _sample_factor) AS metric_value'],
    [{ name: 'price', type: 'Decimal64(2)' }, 'avg(`price`) AS metric_value'],
    [undefined, 'sum(_sample_factor) AS row_count'],
])
    test(`Sampled examples preserve ${measure?.name ?? 'row count'} aggregation semantics`, () => {
        const schema = exampleSchema([
            {
                name: 'events',
                rowEstimate: '18446744073709551615',
                samplingKey: 'intHash64(id)',
                orderBy: 'tuple(day, id)',
                columns: [
                    { name: 'day', type: 'Nullable(Date32)' },
                    { name: 'country', type: 'String' },
                    ...(measure ? [measure] : []),
                ],
            },
        ]);
        const examples = sqlExamplesFor({ id: 'production', dataSource: 'clickhouse' }, schema);
        const time = examples.find(example => example.category === 'timeSeries');
        const category = examples.find(example => example.category === 'aggregation');
        assert.ok(time.sql.includes(expected));
        assert.match(time.sql, /SAMPLE 100000/);
        assert.match(time.sql, /`day` >= today\(\) - INTERVAL 29 DAY/);
        assert.match(time.description, /sample/);
        assert.match(category.sql, /sum\(_sample_factor\) AS row_count/);
        assert.match(category.sql, /SAMPLE 100000/);
    });

test('Coordinate examples bound geographic values and take dimensions from the same table', () => {
    const schema = exampleSchema([
        {
            name: 'smaller',
            rowEstimate: '9007199254740992',
            samplingKey: 'id',
            columns: [{ name: 'country', type: 'String' }],
        },
        {
            name: 'larger',
            rowEstimate: '9007199254740993',
            samplingKey: 'id',
            columns: [
                { name: 'lat', type: 'Nullable(Float64)' },
                { name: 'lng', type: 'Float64' },
                { name: 'channel', type: 'String' },
                { name: 'country', type: 'String' },
            ],
        },
    ]);
    const examples = sqlExamplesFor({ id: 'production', dataSource: 'clickhouse' }, schema);
    const geo = examples.find(example => example.id.startsWith('cloud-geo-coordinates'));
    assert.match(geo.sql, /FROM `analytics`\.`larger` SAMPLE 100000/);
    assert.match(geo.sql, /`lat` BETWEEN -90 AND 90/);
    assert.match(geo.sql, /`lng` BETWEEN -180 AND 180/);
    assert.match(geo.sql, /LIMIT 500$/);
    assert.deepEqual(
        examples
            .filter(example => example.category === 'aggregation')
            .map(example => example.dataset)
            .sort(),
        ['analytics.larger', 'analytics.smaller'],
    );
});
