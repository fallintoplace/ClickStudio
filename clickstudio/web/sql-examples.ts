import type { ChartConfig, Connection, Schema } from '../shared/types.js';
import { DEMO_PREVIEW_STARTERS } from './demo-preview.js';
import { GEO_HELP_EXAMPLES } from './help-demos.js';
import { PLAYGROUND_CONNECTION_ID, PLAYGROUND_STARTER_SQL } from './playground.js';

export type SqlExampleCategory = 'basics' | 'aggregation' | 'timeSeries' | 'clickhouse' | 'schema' | 'business' | 'observability' | 'operations' | 'engineering' | 'markets' | 'cities' | 'openSource' | 'internet' | 'datasets';

export type SqlExample = {
    id: string;
    name: string;
    description: string;
    dataset?: string;
    category: SqlExampleCategory;
    sql: string;
    chart: ChartConfig;
    featuredOrder?: number;
};

const playgroundExamples: SqlExample[] = [
    ...GEO_HELP_EXAMPLES,
    {
        id: 'github-recent-events', name: 'Recent GitHub events', category: 'openSource',
        description: 'Inspect real events, repositories, actors, and timestamps.', dataset: 'GitHub', sql: PLAYGROUND_STARTER_SQL,
        chart: { kind: 'table', x: 0, ys: [], title: 'GitHub events' },
    },
    {
        id: 'amazon-customer-review-health', name: 'Amazon Customer Review Health', category: 'business', dataset: 'Amazon Reviews', featuredOrder: 1,
        description: 'Compare negative, neutral, and positive review share across high-volume product categories.',
        sql: `SELECT
    product_category,
    round(100.0 * countIf(star_rating <= 2) / count(), 1) AS negative_pct,
    round(100.0 * countIf(star_rating = 3) / count(), 1) AS neutral_pct,
    round(100.0 * countIf(star_rating >= 4) / count(), 1) AS positive_pct,
    count() AS reviews
FROM amazon.amazon_reviews
WHERE product_category != ''
GROUP BY product_category
HAVING reviews >= 100000
ORDER BY negative_pct DESC
LIMIT 12`,
        chart: { kind: 'bar', x: 0, ys: [1, 2, 3], title: 'Customer review health by category' },
    },
    {
        id: 'otel-service-latency-slo', name: 'Service Latency SLO', category: 'observability', dataset: 'OpenTelemetry', featuredOrder: 2,
        description: 'Track frontend p50, p95, and p99 server-span latency over the latest hour of telemetry.',
        sql: `WITH (SELECT max(Timestamp) FROM otel_v2.otel_traces) AS latest
SELECT
    toStartOfMinute(Timestamp) AS minute,
    round(quantileTDigest(0.50)(Duration) / 1000000, 2) AS p50_ms,
    round(quantileTDigest(0.95)(Duration) / 1000000, 2) AS p95_ms,
    round(quantileTDigest(0.99)(Duration) / 1000000, 2) AS p99_ms
FROM otel_v2.otel_traces
WHERE ServiceName = 'frontend'
    AND SpanKind IN ('Server', 'SPAN_KIND_SERVER')
    AND Timestamp >= latest - INTERVAL 60 MINUTE
GROUP BY minute
ORDER BY minute`,
        chart: { kind: 'line', x: 0, ys: [1, 2, 3], title: 'Frontend latency percentiles' },
    },
    {
        id: 'ontime-flight-delay-operations', name: 'Flight Delay Operations', category: 'operations', dataset: 'US flights', featuredOrder: 3,
        description: 'Spot seasonal departure-delay risk across nine years of US flight operations.',
        sql: `SELECT
    Year AS year,
    Month AS month,
    round(100.0 * countIf(DepDelay > 10) / count(), 1) AS delayed_pct
FROM ontime.ontime
WHERE Year BETWEEN 2000 AND 2008
GROUP BY year, month
ORDER BY year, month`,
        chart: { kind: 'heatmap', x: 1, groupBy: 0, ys: [2], title: 'Departure delay rate by month' },
    },
    {
        id: 'stackoverflow-technology-trends', name: 'Developer Technology Trends', category: 'engineering', dataset: 'Stack Overflow', featuredOrder: 4,
        description: 'Compare quarterly question volume for Python, JavaScript, Java, and Rust as a developer-interest signal.',
        sql: `SELECT
    toStartOfQuarter(CreationDate) AS quarter,
    countIf(Tags LIKE '%<python>%') AS python,
    countIf(Tags LIKE '%<javascript>%') AS javascript,
    countIf(Tags LIKE '%<java>%') AS java,
    countIf(Tags LIKE '%<rust>%') AS rust
FROM stackoverflow.posts
WHERE PostTypeId = 'Question'
    AND CreationDate >= toDateTime('2018-01-01 00:00:00')
    AND CreationDate < toDateTime('2024-04-01 00:00:00')
GROUP BY quarter
ORDER BY quarter`,
        chart: { kind: 'line', x: 0, ys: [1, 2, 3, 4], title: 'Quarterly technology question volume' },
    },
    {
        id: 'github-daily-activity', name: 'Daily activity', category: 'openSource',
        description: 'Compare event volume and active actors over the last 30 days.', dataset: 'GitHub',
        sql: `SELECT
    toDate(created_at) AS day,
    count() AS events,
    uniqExactIf(actor_login, actor_login != '') AS actors
FROM github.events
WHERE created_at >= now() - INTERVAL 30 DAY
GROUP BY day
ORDER BY day`,
        chart: { kind: 'line', x: 0, ys: [1, 2], title: 'Daily GitHub activity' },
    },
    {
        id: 'github-top-star-events', name: 'Repositories getting starred', category: 'openSource',
        description: 'Rank repositories by recent GitHub star events.', dataset: 'GitHub',
        sql: `SELECT
    repo_name,
    count() AS star_events
FROM github.events
WHERE event_type = 'WatchEvent'
    AND created_at >= now() - INTERVAL 30 DAY
    AND repo_name != ''
GROUP BY repo_name
ORDER BY star_events DESC
LIMIT 10`,
        chart: { kind: 'bar', x: 0, ys: [1], title: 'Star events by repository' },
    },
    {
        id: 'github-pr-contributors', name: 'PR contributors by month', category: 'clickhouse',
        description: 'Count distinct contributors to ClickHouse pull request activity.', dataset: 'GitHub',
        sql: `SELECT
    toStartOfMonth(created_at) AS month,
    uniq(actor_login) AS contributors
FROM github.events
WHERE repo_name = 'ClickHouse/ClickHouse'
    AND event_type = 'PullRequestEvent'
    AND created_at >= now() - INTERVAL 24 MONTH
    AND actor_login != ''
GROUP BY month
ORDER BY month`,
        chart: { kind: 'line', x: 0, ys: [1], title: 'Monthly PR contributors' },
    },
    {
        id: 'github-release-cadence', name: 'ClickHouse release cadence', category: 'openSource',
        description: 'See how the project release pace changes by year.', dataset: 'GitHub',
        sql: `SELECT
    toStartOfYear(created_at) AS year,
    count() AS releases
FROM github.events
WHERE repo_name = 'ClickHouse/ClickHouse'
    AND event_type = 'ReleaseEvent'
    AND created_at >= toDateTime('2015-01-01 00:00:00')
GROUP BY year
ORDER BY year`,
        chart: { kind: 'bar', x: 0, ys: [1], title: 'Releases per year' },
    },
    {
        id: 'github-issues-mentioning-clickhouse', name: 'Issues mentioning ClickHouse', category: 'openSource',
        description: 'Track issue titles mentioning ClickHouse across repositories.', dataset: 'GitHub',
        sql: `SELECT
    toStartOfMonth(created_at) AS month,
    count() AS issues,
    uniq(repo_name) AS repositories
FROM github.events
WHERE event_type = 'IssuesEvent'
    AND created_at >= now() - INTERVAL 12 MONTH
    AND title ILIKE '%ClickHouse%'
GROUP BY month
ORDER BY month`,
        chart: { kind: 'line', x: 0, ys: [1, 2], title: 'Issues mentioning ClickHouse' },
    },
    {
        id: 'hackernews-daily-pulse', name: 'Stories and comments', category: 'internet', dataset: 'Hacker News',
        description: 'Compare daily stories and comments from the last 90 days.',
        sql: `SELECT
    toDate(time) AS day,
    countIf(type = 'story') AS stories,
    countIf(type = 'comment') AS comments
FROM hackernews.hackernews
WHERE time >= now() - INTERVAL 90 DAY
GROUP BY day
ORDER BY day`,
        chart: { kind: 'line', x: 0, ys: [1, 2], title: 'Hacker News activity' },
    },
    {
        id: 'nyc-taxi-weekly-rhythm', name: 'Taxi trips by weekday and hour', category: 'cities', dataset: 'NYC Taxi', featuredOrder: 6,
        description: 'Find rush-hour patterns across the week in a 168-cell heatmap.',
        sql: `SELECT
    toDayOfWeek(pickup_datetime) AS weekday,
    toHour(pickup_datetime) AS hour,
    count() AS trips
FROM nyc_taxi.trips_small
GROUP BY weekday, hour
ORDER BY weekday, hour`,
        chart: { kind: 'heatmap', x: 1, groupBy: 0, ys: [2], title: 'Taxi pickups by weekday and hour' },
    },
    {
        id: 'nyc-taxi-fare-distance', name: 'Fare vs. trip distance', category: 'cities', dataset: 'NYC Taxi', featuredOrder: 7,
        description: 'Explore how trip distance relates to the metered fare.',
        sql: `SELECT
    trip_distance,
    fare_amount
FROM nyc_taxi.trips_small
WHERE trip_distance > 0 AND fare_amount > 0
ORDER BY trip_id
LIMIT 240`,
        chart: { kind: 'scatter', x: 0, ys: [1], title: 'Fare by trip distance' },
    },
    {
        id: 'bluesky-activity-by-hour', name: 'Bluesky activity by hour', category: 'internet', dataset: 'Bluesky',
        description: 'Compare posts, likes, and reposts across the day using ClickHouse hourly rollups.',
        sql: `SELECT
    event,
    hour_of_day,
    sum(count) AS events
FROM bluesky.events_per_hour_of_day
WHERE event IN ('app.bsky.feed.post', 'app.bsky.feed.like', 'app.bsky.feed.repost')
GROUP BY event, hour_of_day
ORDER BY event, hour_of_day`,
        chart: { kind: 'heatmap', x: 1, groupBy: 0, ys: [2], title: 'Bluesky events by hour' },
    },
    {
        id: 'stock-jnj-history', name: 'Johnson & Johnson price history', category: 'markets', dataset: 'Stock sample',
        description: 'Plot 180 historical trading sessions from the sample stock table.',
        sql: `SELECT
    date,
    price
FROM (
    SELECT date, price
    FROM stock.stock
    WHERE symbol = 'JNJ'
    ORDER BY date DESC
    LIMIT 180
)
ORDER BY date`,
        chart: { kind: 'line', x: 0, ys: [1], title: 'JNJ historical price' },
    },
    {
        id: 'pypi-package-downloads', name: 'Package downloads by month', category: 'datasets', dataset: 'PyPI',
        description: 'Compare monthly downloads of pandas, Polars, and ClickHouse Python drivers.',
        sql: `SELECT
    month,
    project,
    sum(count) AS downloads
FROM pypi.pypi_downloads_per_month
WHERE month >= addMonths(toStartOfMonth(today()), -17)
    AND project IN ('clickhouse-connect', 'clickhouse-driver', 'pandas', 'polars')
GROUP BY month, project
ORDER BY month, project
LIMIT 100`,
        chart: { kind: 'heatmap', x: 0, groupBy: 1, ys: [2], title: 'Monthly package downloads' },
    },
    {
        id: 'stackoverflow-qa-volume', name: 'Stack Overflow Q&A volume', category: 'internet', dataset: 'Stack Overflow',
        description: 'See how monthly question and answer counts changed in the archive.',
        sql: `SELECT
    toStartOfMonth(CreationDate) AS month,
    countIf(PostTypeId = 'Question') AS questions,
    countIf(PostTypeId = 'Answer') AS answers
FROM stackoverflow.posts
WHERE CreationDate >= toDateTime('2020-01-01 00:00:00')
    AND CreationDate < toDateTime('2024-04-01 00:00:00')
GROUP BY month
ORDER BY month
LIMIT 100`,
        chart: { kind: 'line', x: 0, ys: [1, 2], title: 'Monthly Stack Overflow Q&A' },
    },
    {
        id: 'uk-house-prices-by-county', name: 'UK house prices by county', category: 'datasets', dataset: 'UK property data',
        description: 'Rank counties by median sale price since 2020.',
        sql: `SELECT
    county,
    quantile(0.5)(price) AS median_price,
    count() AS sales
FROM uk.uk_price_paid
WHERE date >= toDate('2020-01-01')
    AND price > 0
GROUP BY county
HAVING sales >= 1000
ORDER BY median_price DESC
LIMIT 12`,
        chart: { kind: 'bar', x: 0, ys: [1], title: 'Median sale price by county' },
    },
    {
        id: 'imdb-ratings-by-year', name: 'Movie ratings by year', category: 'datasets', dataset: 'IMDb',
        description: 'Compare average IMDb ratings across movie release years.',
        sql: `SELECT
    year,
    round(avg(rank), 2) AS average_rating
FROM imdb.movies
WHERE year >= 1980
    AND rank > 0
GROUP BY year
ORDER BY year
LIMIT 200`,
        chart: { kind: 'scatter', x: 0, ys: [1], title: 'Average movie rating by year' },
    },
    {
        id: 'noaa-central-park-weather', name: 'New York weather patterns', category: 'datasets', dataset: 'NOAA weather',
        description: 'Explore monthly weather types recorded at Central Park from 2018 to 2022.',
        sql: `SELECT
    toStartOfMonth(date) AS month,
    weatherType,
    count() AS observations
FROM noaa.noaa
WHERE station_id = 'USW00094728'
    AND date >= toDate('2018-01-01')
    AND date < toDate('2023-01-01')
GROUP BY month, weatherType
ORDER BY month, weatherType
LIMIT 240`,
        chart: { kind: 'heatmap', x: 0, groupBy: 1, ys: [2], title: 'Central Park weather by month' },
    },
    {
        id: 'forex-eur-usd-monthly', name: 'EUR/USD monthly midpoint', category: 'markets', dataset: 'Forex',
        description: 'Follow historical monthly average bid/ask midpoints for EUR/USD.',
        sql: `SELECT
    toStartOfMonth(datetime) AS month,
    round(avg((bid + ask) / 2), 5) AS midpoint
FROM forex.forex
WHERE base = 'EUR'
    AND quote = 'USD'
    AND datetime >= toDateTime('2019-01-01 00:00:00')
    AND datetime < toDateTime('2023-01-01 00:00:00')
GROUP BY month
ORDER BY month`,
        chart: { kind: 'line', x: 0, ys: [1], title: 'EUR/USD monthly midpoint' },
    },
    {
        id: 'forex-eur-usd-market-view', name: 'EUR/USD Pro Market View', category: 'markets', dataset: 'Forex', featuredOrder: 5,
        description: 'Build historical 15-minute midpoint candles with bid/ask, quote activity, and spread context.',
        sql: `WITH (bid + ask) / 2 AS mid
SELECT
    toStartOfInterval(datetime, INTERVAL 15 MINUTE) AS time,
    argMin(mid, datetime) AS open,
    max(mid) AS high,
    min(mid) AS low,
    argMax(mid, datetime) AS close,
    argMax(bid, datetime) AS best_bid,
    argMax(ask, datetime) AS best_ask,
    avg((ask - bid) / nullIf(mid, 0) * 10000) AS spread_bps,
    count() AS quote_updates
FROM forex.forex
WHERE base = 'EUR'
    AND quote = 'USD'
    AND datetime >= toDateTime('2022-08-21 17:00:00')
    AND datetime < toDateTime('2022-08-26 00:00:00')
GROUP BY time
ORDER BY time
LIMIT 600`,
        chart: {
            kind: 'candlestick', x: 0, ys: [], title: 'EUR/USD Pro Market View',
            candlestick: { open: 1, high: 2, low: 3, close: 4, bid: 5, ask: 6, spread: 7, quoteActivity: 8 },
        },
    },
    {
        id: 'nyc-taxi-fare-quantiles', name: 'Taxi fare percentiles by hour', category: 'clickhouse', dataset: 'NYC Taxi',
        description: 'Compare median and 95th-percentile fares by weekday and pickup hour.',
        sql: `SELECT
    toDayOfWeek(pickup_datetime) AS weekday,
    toHour(pickup_datetime) AS hour,
    quantile(0.50)(fare_amount) AS median_fare,
    quantile(0.95)(fare_amount) AS p95_fare
FROM nyc_taxi.trips_small
WHERE trip_distance > 0
    AND fare_amount > 0
    AND fare_amount < 200
GROUP BY weekday, hour
ORDER BY weekday, hour`,
        chart: { kind: 'heatmap', x: 1, groupBy: 0, ys: [2], title: 'Taxi fare percentiles by hour' },
    },
    {
        id: 'github-rolling-activity', name: 'GitHub activity with a rolling average', category: 'clickhouse', dataset: 'GitHub', featuredOrder: 8,
        description: 'Smooth daily ClickHouse repository activity with a seven-day window.',
        sql: `WITH daily AS (
    SELECT
        toDate(created_at) AS day,
        count() AS events
    FROM github.events
    WHERE repo_name = 'ClickHouse/ClickHouse'
        AND created_at >= now() - INTERVAL 90 DAY
    GROUP BY day
)
SELECT
    day,
    events,
    round(avg(events) OVER (ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW), 1) AS seven_day_average
FROM daily
ORDER BY day`,
        chart: { kind: 'line', x: 0, ys: [1, 2], title: 'Daily GitHub events and seven-day average' },
    },
];

const demoStarterDetails: Record<string, Pick<SqlExample, 'description' | 'category'>> = {
    'preview-starter-getting-started': { description: 'Explore daily activity, unique users, and attributed revenue.', category: 'timeSeries' },
    'preview-starter-top-countries': { description: 'Compare event volume, unique users, and revenue across countries.', category: 'aggregation' },
    'preview-starter-revenue-channel': { description: 'Compare completed orders and average value by channel.', category: 'aggregation' },
    'preview-starter-latency': { description: 'Compare request volume with median and tail latency.', category: 'aggregation' },
    'preview-starter-hourly': { description: 'Track hourly event volume and server errors.', category: 'timeSeries' },
    'preview-starter-funnel': { description: 'Compare users across signup funnel steps.', category: 'aggregation' },
    'preview-starter-device-engagement': { description: 'Compare sessions and conversion by device.', category: 'aggregation' },
    'preview-starter-customer-value': { description: 'Compare average customer value by plan.', category: 'aggregation' },
    'preview-starter-daily-rollup': { description: 'Use additive counts and revenue from a pre-aggregated table.', category: 'timeSeries' },
    'preview-starter-latency-anomaly': { description: 'Compare p95 latency with a rolling baseline and alert threshold.', category: 'clickhouse' },
    'preview-starter-latest-event': { description: 'Use argMax to find each user’s most recent event and page.', category: 'clickhouse' },
    'preview-starter-top-pages-country': { description: 'Use LIMIT BY to find the top three pages in each country.', category: 'clickhouse' },
    'preview-starter-distinct-estimates': { description: 'Compare an exact visitor count with a fast approximate count.', category: 'clickhouse' },
    'preview-starter-monthly-revenue': { description: 'Compare completed orders and revenue month by month with conditional aggregates.', category: 'timeSeries' },
    'preview-starter-channel-conversion': { description: 'Use countIf to calculate conversions and conversion rate for each channel.', category: 'clickhouse' },
    'preview-starter-signup-cohorts': { description: 'Group new accounts into monthly cohorts and compare their plans and lifetime value.', category: 'timeSeries' },
    'preview-starter-product-page-conversion': { description: 'Compare product page views with unique purchasers using conditional aggregates.', category: 'aggregation' },
};

const demoExamples: SqlExample[] = DEMO_PREVIEW_STARTERS.map(starter => ({
    id: starter.id,
    name: starter.name.replace(/\.sql$/i, ''),
    description: demoStarterDetails[starter.id]?.description ?? 'Explore the sample ClickHouse data.',
    category: demoStarterDetails[starter.id]?.category ?? 'basics',
    sql: starter.sql,
    chart: starter.chart,
}));

const genericExamples: SqlExample[] = [
    {
        id: 'clickhouse-server-version', name: 'ClickHouse version', category: 'basics',
        description: 'Check which ClickHouse version serves this connection.',
        sql: 'SELECT version() AS clickhouse_version',
        chart: { kind: 'table', x: 0, ys: [], title: 'ClickHouse version' },
    },
    {
        id: 'clickhouse-server-time', name: 'Server time', category: 'basics',
        description: 'Read the current time from the ClickHouse server.',
        sql: 'SELECT now() AS server_time',
        chart: { kind: 'table', x: 0, ys: [], title: 'Server time' },
    },
    {
        id: 'clickhouse-numbers', name: 'Generate a number series', category: 'basics',
        description: 'Use the numbers table function to create a small result set.',
        sql: `SELECT
    number,
    number * number AS squared
FROM numbers(10)
ORDER BY number`,
        chart: { kind: 'table', x: 0, ys: [], title: 'Number series' },
    },
];

const quoteIdentifier = (value: string) => `\`${value.replaceAll('`', '``')}\``;

function baseColumnType(type: string) {
    let base = type.trim();
    while (true) {
        const wrapped = /^(?:Nullable|LowCardinality)\((.*)\)$/i.exec(base);
        if (!wrapped) return base;
        base = wrapped[1]!.trim();
    }
}

function isDateColumn(column: Schema['columns'][number]) {
    return /^(?:Date(?:32)?|DateTime(?:64)?)(?:\b|\()/i.test(baseColumnType(column.type));
}

function isNumericColumn(column: Schema['columns'][number]) {
    return /^(?:U?Int(?:8|16|32|64|128|256)|Float(?:32|64)|Decimal(?:32|64|128|256)?(?:\([^)]*\))?)(?:\b|$)/i.test(baseColumnType(column.type));
}

function dimensionRank(column: Schema['columns'][number]) {
    const type = baseColumnType(column.type);
    if (!/^(?:String|FixedString\(\d+\)|Enum(?:8|16)(?:\(.*\))?|UUID|IPv4|IPv6)$/i.test(type)) return 0;
    const name = column.name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    if (/(?:^|_)(?:id|uuid|key|hash|token)(?:_|$)/.test(name)) return 0;
    if (/(?:^|_)(?:country|region|city|category|status|type|channel|source|event|product|artist|game|department|device|platform|browser|method|group|name|tag)(?:_|$)/.test(name)) return 2;
    return 1;
}

function measureRank(column: Schema['columns'][number]) {
    if (!isNumericColumn(column)) return 0;
    const name = column.name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    if (/(?:^|_)(?:id|rank|sequence|seq)(?:_|$)/.test(name)) return 0;
    return /(?:^|_)(?:amount|revenue|sales|price|cost|population|quantity|count|events|trips|latency|duration|temperature|score|rating|bytes|size|distance|value|total|views|requests|downloads|orders|weight|height)(?:_|$)/.test(name) ? 2 : 0;
}

function columnForTable(schema: Schema, table: Schema['tables'][number]) {
    return schema.columns.filter(column => column.database === table.database && column.table === table.name);
}

function compareTableRows(left: Schema['tables'][number], right: Schema['tables'][number]) {
    const leftRows = /^\d+$/.test(left.rowEstimate ?? '') ? BigInt(left.rowEstimate!) : undefined;
    const rightRows = /^\d+$/.test(right.rowEstimate ?? '') ? BigInt(right.rowEstimate!) : undefined;
    if (leftRows !== undefined && rightRows !== undefined && leftRows !== rightRows) return leftRows > rightRows ? -1 : 1;
    if (leftRows !== undefined && rightRows === undefined) return -1;
    if (leftRows === undefined && rightRows !== undefined) return 1;
    return 0;
}

function timeSeriesExample(table: Schema['tables'][number], time: Schema['columns'][number], measure: Schema['columns'][number] | undefined): SqlExample {
    const tableName = `${quoteIdentifier(table.database)}.${quoteIdentifier(table.name)}`;
    const timeName = quoteIdentifier(time.name);
    const aggregate = measure
        ? /(?:temperature|latency|duration|score|rating|price|rate|percent|percentage|distance|weight|height)/i.test(measure.name) ? 'avg' : 'sum'
        : 'count';
    const value = measure ? `${aggregate}(${quoteIdentifier(measure.name)})` : 'count()';
    const valueAlias = measure ? 'metric_value' : 'row_count';
    const name = measure ? `Daily ${measure.name} in ${table.name}` : `Daily rows in ${table.name}`;
    return {
        id: `cloud-time-series-${table.database}.${table.name}`,
        name,
        description: `Show the latest 30 daily ${measure ? `${aggregate} of ${measure.name}` : 'row counts'} from ${table.database}.${table.name}.`,
        dataset: `${table.database}.${table.name}`,
        category: 'timeSeries',
        featuredOrder: 1,
        sql: `SELECT day, ${valueAlias}\nFROM (\n    SELECT\n        toDate(${timeName}) AS day,\n        ${value} AS ${valueAlias}\n    FROM ${tableName}\n    WHERE ${timeName} IS NOT NULL\n    GROUP BY day\n    ORDER BY day DESC\n    LIMIT 30\n)\nORDER BY day`,
        chart: { kind: 'line', x: 0, ys: [1], title: name },
    };
}

function categoryExample(table: Schema['tables'][number], column: Schema['columns'][number], featuredOrder: number): SqlExample {
    const name = `Top ${column.name} values in ${table.name}`;
    const field = quoteIdentifier(column.name);
    return {
        id: `cloud-category-${table.database}.${table.name}.${column.name}`,
        name,
        description: `Count rows by ${column.name} in ${table.database}.${table.name}.`,
        dataset: `${table.database}.${table.name}`,
        category: 'aggregation',
        featuredOrder,
        sql: `SELECT\n    ${field} AS category,\n    count() AS row_count\nFROM ${quoteIdentifier(table.database)}.${quoteIdentifier(table.name)}\nWHERE ${field} IS NOT NULL AND toString(${field}) != ''\nGROUP BY category\nORDER BY row_count DESC\nLIMIT 10`,
        chart: { kind: 'bar', x: 0, ys: [1], title: name },
    };
}

function geoExample(table: Schema['tables'][number], columns: Schema['columns'][number][]): SqlExample | undefined {
    const latitude = columns.find(column => isNumericColumn(column) && /^(?:lat|latitude)$/i.test(column.name));
    const longitude = columns.find(column => isNumericColumn(column) && /^(?:lon|lng|longitude)$/i.test(column.name));
    if (latitude && longitude) {
        const lat = quoteIdentifier(latitude.name);
        const lon = quoteIdentifier(longitude.name);
        const name = `Plot locations in ${table.name}`;
        return {
            id: `cloud-geo-coordinates-${table.database}.${table.name}`,
            name,
            description: `Plot stored latitude and longitude values from ${table.database}.${table.name}.`,
            dataset: `${table.database}.${table.name}`,
            category: 'cities',
            featuredOrder: 3,
            sql: `SELECT\n    ${lon} AS longitude,\n    ${lat} AS latitude\nFROM ${quoteIdentifier(table.database)}.${quoteIdentifier(table.name)}\nWHERE ${lat} BETWEEN -90 AND 90\n    AND ${lon} BETWEEN -180 AND 180\nLIMIT 500`,
            chart: { kind: 'scatter', x: 0, ys: [1], title: name },
        };
    }

    const point = columns.find(column => /^(?:Point|Ring|Polygon|MultiPolygon|LineString|Geometry)$/i.test(baseColumnType(column.type)));
    if (!point) return undefined;
    const field = quoteIdentifier(point.name);
    const name = `Preview ${point.name} locations in ${table.name}`;
    return {
        id: `cloud-geo-native-${table.database}.${table.name}.${point.name}`,
        name,
        description: `Read native geographic values from ${table.database}.${table.name}.`,
        dataset: `${table.database}.${table.name}`,
        category: 'cities',
        featuredOrder: 3,
        sql: `SELECT ${field} AS location\nFROM ${quoteIdentifier(table.database)}.${quoteIdentifier(table.name)}\nWHERE ${field} IS NOT NULL\nLIMIT 100`,
        chart: { kind: 'table', x: 0, ys: [], title: name },
    };
}

function cloudFeaturedExamples(schema?: Schema) {
    const tables = (schema?.tables ?? [])
        .filter(table => !['system', 'information_schema'].includes(table.database.toLowerCase()))
        .map((table, index) => ({ table, columns: schema ? columnForTable(schema, table) : [], index }))
        .sort((left, right) => compareTableRows(left.table, right.table) || right.columns.length - left.columns.length || left.index - right.index);

    const timeExample = tables.flatMap(({ table, columns }) => {
        const time = columns.filter(isDateColumn)
            .sort((left, right) => Number(/(?:date|time|timestamp|_at$|^day$)/i.test(right.name)) - Number(/(?:date|time|timestamp|_at$|^day$)/i.test(left.name)))[0];
        if (!time) return [];
        const measure = columns.filter(column => measureRank(column) > 0)
            .sort((left, right) => measureRank(right) - measureRank(left))[0];
        return [timeSeriesExample(table, time, measure)];
    })[0];

    const categoryCandidates = tables.flatMap(({ table, columns, index }) => columns
        .filter(column => dimensionRank(column) > 0)
        .map(column => ({ table, column, tableIndex: index, rank: dimensionRank(column) })))
        .sort((left, right) => right.rank - left.rank || left.tableIndex - right.tableIndex || left.column.name.localeCompare(right.column.name));
    const categories: SqlExample[] = [];
    const featuredCategoryTables = new Set<string>();
    for (const candidate of categoryCandidates) {
        const tableKey = `${candidate.table.database}.${candidate.table.name}`;
        if (featuredCategoryTables.has(tableKey)) continue;
        categories.push(categoryExample(candidate.table, candidate.column, categories.length + 2));
        featuredCategoryTables.add(tableKey);
        if (categories.length === 2) break;
    }
    const geo = tables.map(({ table, columns }) => geoExample(table, columns))
        .find((example): example is SqlExample => Boolean(example));

    return [timeExample, ...categories, geo]
        .filter((example): example is SqlExample => Boolean(example))
        .map((example, index) => ({ ...example, featuredOrder: index + 1 }));
}

export function sqlExamplesFor(connection: Pick<Connection, 'id' | 'dataSource'>, schema?: Schema): SqlExample[] {
    if (connection.id === PLAYGROUND_CONNECTION_ID) return playgroundExamples;
    if (connection.dataSource === 'fixture') return [...demoExamples, ...GEO_HELP_EXAMPLES];

    const tableExamples: SqlExample[] = (schema?.tables ?? [])
        .filter(table => !['system', 'information_schema'].includes(table.database.toLowerCase()))
        .slice(0, 6)
        .map(table => ({
            id: `table-preview-${table.database}.${table.name}`,
            name: `Preview ${table.database}.${table.name}`,
            description: 'Read up to 50 rows from this table.',
            category: 'schema',
            sql: `SELECT *\nFROM ${quoteIdentifier(table.database)}.${quoteIdentifier(table.name)}\nLIMIT 50`,
            chart: { kind: 'table', x: 0, ys: [], title: `Preview ${table.name}` },
        }));

    const featured = cloudFeaturedExamples(schema);
    const featuredExamples = featured.length
        ? featured
        : tableExamples.length
            ? []
            : genericExamples.map((example, index) => ({ ...example, featuredOrder: index + 1 }));
    const orderedTableExamples = !featured.length && tableExamples.length
        ? tableExamples.map((example, index) => index === 0 ? { ...example, featuredOrder: 1 } : example)
        : tableExamples;
    const cloudGeoExamples = GEO_HELP_EXAMPLES.map(example => ({ ...example, featuredOrder: undefined }));

    return [...orderedTableExamples, ...featuredExamples, ...genericExamples, ...cloudGeoExamples];
}
