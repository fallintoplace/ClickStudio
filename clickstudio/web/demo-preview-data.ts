import type { ChartConfig } from '../shared/types.js';
import {
    PLAYGROUND_STARTER_ID,
    PLAYGROUND_STARTER_NAME,
    PLAYGROUND_STARTER_SQL,
} from './playground.js';

export const DEMO_PREVIEW_RUN_ID = 'preview-sample-run';
export const DEMO_PREVIEW_STARTER_DOCUMENT_ID = 'preview-starter-getting-started';
export const DEMO_PREVIEW_SQL = `SELECT
    toDate(event_time) AS day,
    count() AS events,
    uniqExact(user_id) AS unique_users,
    round(sum(revenue), 2) AS revenue
FROM events
WHERE event_time >= now() - INTERVAL 30 DAY
GROUP BY day
ORDER BY day`;

export const demoIndexAnalysis = `ReadFromMergeTree (demo.events)
  Indexes:
    MinMax
      Keys:
        day
      Condition: (day in ['2026-01-01', '2026-01-08'])
      Parts: 8/58
      Granules: 46/612
    Partition
      Keys:
        toYYYYMM(day)
      Condition: (toYYYYMM(day) = 202601)
      Parts: 4/8
      Granules: 46/360
    PrimaryKey
      Keys:
        tenant_id
        day
      Condition: (tenant_id = 42)
      Parts: 4/4
      Granules: 12/46
    Skip
      Name: tenant_bloom
      Description: bloom filter on tenant_id
      Parts: 1/4
      Granules: 4/12`;

export type DemoPreviewStarter = {
    id: string;
    name: string;
    sql: string;
    chart: ChartConfig;
    initial?: boolean;
    revision?: number;
};
export const DEMO_PREVIEW_STARTERS: DemoPreviewStarter[] = [
    {
        id: DEMO_PREVIEW_STARTER_DOCUMENT_ID,
        name: 'Getting started.sql',
        sql: DEMO_PREVIEW_SQL,
        chart: { kind: 'line', x: 0, ys: [1, 2], title: 'Daily activity' },
        initial: true,
        revision: 5,
    },
    {
        id: 'preview-starter-top-countries',
        name: 'Top countries.sql',
        sql: `SELECT
    country,
    count() AS events,
    uniqExact(user_id) AS unique_users,
    round(sum(revenue), 2) AS revenue
FROM events
WHERE event_time >= now() - INTERVAL 7 DAY
GROUP BY country
ORDER BY events DESC
LIMIT 10`,
        chart: { kind: 'bar', x: 0, ys: [1], title: 'Events by country' },
        initial: true,
    },
    {
        id: 'preview-starter-revenue-channel',
        name: 'Revenue by channel.sql',
        sql: `SELECT
    channel,
    countIf(order_status = 'completed') AS orders,
    round(sumIf(total, order_status = 'completed'), 2) AS revenue,
    round(revenue / nullIf(orders, 0), 2) AS average_order_value
FROM orders
WHERE order_time >= now() - INTERVAL 30 DAY
GROUP BY channel
ORDER BY revenue DESC`,
        chart: { kind: 'bar', x: 0, ys: [2], title: 'Revenue by channel' },
        initial: true,
    },
    {
        id: 'preview-starter-latency',
        name: 'Request latency.sql',
        sql: `SELECT
    page_path,
    count() AS requests,
    quantile(0.50)(duration_ms) AS p50_ms,
    quantile(0.95)(duration_ms) AS p95_ms,
    quantile(0.99)(duration_ms) AS p99_ms
FROM events
WHERE event_time >= now() - INTERVAL 1 DAY
GROUP BY page_path
ORDER BY p95_ms DESC
LIMIT 10`,
        chart: { kind: 'bar', x: 0, ys: [3], title: '95th percentile latency' },
        initial: true,
    },
    {
        id: 'preview-starter-hourly',
        name: 'Hourly traffic.sql',
        sql: `SELECT
    toStartOfHour(event_time) AS hour,
    count() AS events,
    countIf(status >= 500) AS server_errors
FROM events
WHERE event_time >= now() - INTERVAL 24 HOUR
GROUP BY hour
ORDER BY hour`,
        chart: { kind: 'line', x: 0, ys: [1, 2], title: 'Hourly traffic' },
    },
    {
        id: 'preview-starter-funnel',
        name: 'Signup funnel.sql',
        sql: `SELECT
    multiIf(event_type = 'page_view', 'Visit', event_type = 'signup_start', 'Create account', event_type = 'signup_complete', 'Activate', 'Other') AS step,
    uniqExact(user_id) AS users,
    round(users / nullIf(max(users) OVER (), 0) * 100, 1) AS conversion_pct
FROM events
WHERE event_time >= now() - INTERVAL 30 DAY
GROUP BY step
HAVING step != 'Other'
ORDER BY users DESC`,
        chart: { kind: 'bar', x: 0, ys: [1], title: 'Signup conversion' },
    },
    {
        id: 'preview-starter-device-engagement',
        name: 'Device engagement.sql',
        sql: `SELECT
    device_type,
    count() AS sessions,
    round(avg(page_views), 1) AS avg_page_views,
    round(avg(converted) * 100, 1) AS conversion_rate
FROM sessions
WHERE started_at >= now() - INTERVAL 30 DAY
GROUP BY device_type
ORDER BY sessions DESC`,
        chart: { kind: 'bar', x: 0, ys: [1], title: 'Sessions by device' },
    },
    {
        id: 'preview-starter-customer-value',
        name: 'Customer value.sql',
        sql: `SELECT
    plan,
    count() AS users,
    round(avg(lifetime_value), 2) AS average_lifetime_value
FROM users
GROUP BY plan
ORDER BY average_lifetime_value DESC`,
        chart: { kind: 'bar', x: 0, ys: [2], title: 'Average customer value' },
    },
    {
        id: 'preview-starter-daily-rollup',
        name: 'Daily rollup.sql',
        sql: `SELECT
    day,
    sum(events) AS events,
    sum(orders) AS orders,
    round(sum(revenue), 2) AS revenue
FROM daily_metrics
WHERE day >= today() - 30
GROUP BY day
ORDER BY day`,
        chart: { kind: 'line', x: 0, ys: [1], title: 'Daily events from the rollup' },
    },
    {
        id: 'preview-starter-latency-anomaly',
        name: 'Latency anomaly baseline.sql',
        sql: `WITH hourly_latency AS (
    SELECT
        toStartOfHour(event_time) AS hour,
        page_path,
        quantileTDigest(0.95)(duration_ms) AS p95_ms
    FROM events
    WHERE event_time >= now() - INTERVAL 14 DAY
    GROUP BY hour, page_path
), rolling_baseline AS (
    SELECT
        hour,
        page_path,
        p95_ms,
        avg(p95_ms) OVER (
            PARTITION BY page_path
            ORDER BY hour
            ROWS BETWEEN 7 PRECEDING AND 1 PRECEDING
        ) AS baseline_ms,
        stddevPop(p95_ms) OVER (
            PARTITION BY page_path
            ORDER BY hour
            ROWS BETWEEN 7 PRECEDING AND 1 PRECEDING
        ) AS deviation_ms
    FROM hourly_latency
)
SELECT
    hour,
    page_path,
    p95_ms,
    round(baseline_ms, 1) AS baseline_ms,
    round(baseline_ms + 3 * deviation_ms, 1) AS alert_threshold_ms
FROM rolling_baseline
WHERE baseline_ms IS NOT NULL
ORDER BY hour
LIMIT 500`,
        chart: { kind: 'line', x: 0, ys: [2, 3, 4], title: 'P95 latency vs rolling baseline' },
    },
    {
        id: 'preview-starter-latest-event',
        name: 'Latest event per user.sql',
        sql: `SELECT
    user_id,
    argMax(event_type, event_time) AS last_event,
    argMax(page_path, event_time) AS last_page,
    max(event_time) AS last_seen
FROM events
WHERE event_time >= now() - INTERVAL 30 DAY
GROUP BY user_id
ORDER BY last_seen DESC
LIMIT 20`,
        chart: { kind: 'table', x: 0, ys: [], title: 'Latest event per user' },
    },
    {
        id: 'preview-starter-top-pages-country',
        name: 'Top pages by country.sql',
        sql: `SELECT
    country,
    page_path,
    count() AS page_views,
    uniqExact(user_id) AS visitors
FROM events
WHERE event_time >= now() - INTERVAL 7 DAY
GROUP BY country, page_path
ORDER BY country, visitors DESC
LIMIT 3 BY country
LIMIT 30`,
        chart: { kind: 'bar', x: 0, ys: [3], title: 'Top pages by country' },
    },
    {
        id: 'preview-starter-distinct-estimates',
        name: 'Exact vs estimated visitors.sql',
        sql: `WITH visitor_counts AS (
    SELECT
        uniqExact(user_id) AS exact_visitors,
        uniqCombined64(user_id) AS estimated_visitors
    FROM events
    WHERE event_time >= now() - INTERVAL 30 DAY
)
SELECT
    exact_visitors,
    estimated_visitors,
    round(abs(toFloat64(exact_visitors) - estimated_visitors) / nullIf(exact_visitors, 0) * 100, 2) AS difference_pct
FROM visitor_counts`,
        chart: { kind: 'table', x: 0, ys: [], title: 'Exact vs estimated visitors' },
    },
    {
        id: 'preview-starter-monthly-revenue',
        name: 'Monthly revenue.sql',
        sql: `SELECT
    toStartOfMonth(order_time) AS month,
    countIf(order_status = 'completed') AS completed_orders,
    round(sumIf(total, order_status = 'completed'), 2) AS revenue
FROM orders
WHERE order_time >= now() - INTERVAL 12 MONTH
GROUP BY month
ORDER BY month`,
        chart: { kind: 'line', x: 0, ys: [2], title: 'Monthly revenue' },
    },
    {
        id: 'preview-starter-channel-conversion',
        name: 'Conversion by channel.sql',
        sql: `SELECT
    channel,
    count() AS sessions,
    countIf(converted = 1) AS conversions,
    round(conversions / nullIf(sessions, 0) * 100, 1) AS conversion_rate_pct
FROM sessions
WHERE started_at >= now() - INTERVAL 30 DAY
GROUP BY channel
ORDER BY conversions DESC`,
        chart: { kind: 'bar', x: 0, ys: [3], title: 'Conversion rate by channel' },
    },
    {
        id: 'preview-starter-signup-cohorts',
        name: 'Signup cohorts by plan.sql',
        sql: `SELECT
    toStartOfMonth(created_at) AS cohort_month,
    plan,
    count() AS new_users,
    round(avg(lifetime_value), 2) AS average_lifetime_value
FROM users
WHERE created_at >= now() - INTERVAL 6 MONTH
GROUP BY cohort_month, plan
ORDER BY cohort_month, plan`,
        chart: { kind: 'line', x: 0, ys: [2], groupBy: 1, title: 'Signup cohorts by plan' },
    },
    {
        id: 'preview-starter-product-page-conversion',
        name: 'Product page conversion.sql',
        sql: `SELECT
    page_path,
    countIf(event_type = 'page_view') AS page_views,
    uniqExactIf(user_id, event_type = 'purchase') AS purchasers,
    round(purchasers / nullIf(page_views, 0) * 100, 2) AS conversion_rate_pct
FROM events
WHERE page_path LIKE '/products/%'
  AND event_time >= now() - INTERVAL 30 DAY
GROUP BY page_path
ORDER BY purchasers DESC
LIMIT 10`,
        chart: { kind: 'bar', x: 0, ys: [3], title: 'Product page conversion' },
    },
];
export const DEMO_PREVIEW_INITIAL_STARTERS = DEMO_PREVIEW_STARTERS.filter(
    starter => starter.initial,
);
export const DEMO_PREVIEW_STARTER_VERSIONS = [
    `SELECT
    toDate(event_time) AS day,
    count() AS events
FROM events
GROUP BY day
ORDER BY day`,
    `SELECT
    toDate(event_time) AS day,
    count() AS events,
    uniqExact(user_id) AS unique_users
FROM events
GROUP BY day
ORDER BY day`,
    `SELECT
    toDate(event_time) AS day,
    count() AS events,
    uniqExact(user_id) AS unique_users,
    round(sum(revenue), 2) AS revenue
FROM events
GROUP BY day
ORDER BY day`,
    `SELECT
    toDate(event_time) AS day,
    count() AS events,
    uniqExact(user_id) AS unique_users,
    round(sum(revenue), 2) AS revenue
FROM events
WHERE event_time >= now() - INTERVAL 7 DAY
GROUP BY day
ORDER BY day`,
    DEMO_PREVIEW_SQL,
] as const;
export const PLAYGROUND_PREVIEW_STARTER = {
    id: PLAYGROUND_STARTER_ID,
    name: PLAYGROUND_STARTER_NAME,
    sql: PLAYGROUND_STARTER_SQL,
    chart: { kind: 'table', x: 0, ys: [], title: 'GitHub events' } satisfies ChartConfig,
};

export function demoPreviewStarterRunId(id: string) {
    return id === DEMO_PREVIEW_STARTER_DOCUMENT_ID ? DEMO_PREVIEW_RUN_ID : `preview-run-${id}`;
}
