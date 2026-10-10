import {
    DEFAULT_LIMITS,
    type Connection,
    type QueryDocument,
    type Result,
    type Run,
    type Schema,
    type SchemaColumn,
} from '../shared/types.js';
import { DEMO_EXPLAIN_ANALYZE } from '../shared/demo-fixtures.js';
import { CHART_KINDS } from '../shared/chart-types.js';
import { DEMO_PREVIEW_STARTERS, demoIndexAnalysis } from './demo-preview-data.js';

export const owner = 'preview-user';
export const previewStorageKey = 'clickstudio:vercel-preview-database:v1';
export const previewStorageBudget = 1_500_000;
export const expiresAt = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
export const now = () => new Date().toISOString();
const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
export const record = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});

const schemaColumns = (table: string, values: Array<[string, string, string]>): SchemaColumn[] =>
    values.map(([name, type, comment]) => ({
        database: 'demo',
        table,
        name,
        type,
        comment,
        defaultKind: '',
    }));

export const schema: Schema = {
    connectionId: 'demo',
    fetchedAt: now(),
    tables: [
        {
            database: 'demo',
            name: 'events',
            engine: 'MergeTree',
            orderBy: '(tenant_id, event_time)',
            primaryKey: 'tenant_id, event_time',
            partitionKey: 'toYYYYMM(event_time)',
            samplingKey: 'tenant_id',
            ttlConfigured: true,
            rowEstimate: '2840000000',
            sizeBytes: '442381631488',
            uncompressedBytes: '1724663015424',
            parts: '58',
            activeParts: '52',
            skipIndexTypes: ['bloom_filter', 'minmax'],
            projections: [
                {
                    name: 'daily_revenue',
                    type: 'Aggregate',
                    sortingKey: 'event_time, country, channel',
                },
                {
                    name: 'by_user_time',
                    type: 'Normal',
                    sortingKey: 'tenant_id, user_id, event_time',
                },
            ],
            skipIndexes: [
                {
                    name: 'tenant_bloom',
                    type: 'bloom_filter',
                    expression: 'tenant_id',
                    granularity: '4',
                },
                {
                    name: 'event_type_minmax',
                    type: 'minmax',
                    expression: 'event_type',
                    granularity: '1',
                },
            ],
        },
        {
            database: 'demo',
            name: 'sessions',
            engine: 'ReplacingMergeTree',
            orderBy: '(tenant_id, session_id)',
            primaryKey: 'tenant_id, session_id',
            partitionKey: 'toYYYYMM(started_at)',
            rowEstimate: '184000000',
            sizeBytes: '62794342400',
            uncompressedBytes: '221459251200',
            parts: '42',
            activeParts: '38',
            skipIndexTypes: ['set'],
            projections: [
                { name: 'sessions_by_country', type: 'Normal', sortingKey: 'country, started_at' },
            ],
        },
        {
            database: 'demo',
            name: 'orders',
            engine: 'ReplacingMergeTree',
            orderBy: '(tenant_id, order_id)',
            primaryKey: 'tenant_id, order_id',
            partitionKey: 'toYYYYMM(order_time)',
            rowEstimate: '42800000',
            sizeBytes: '18622709760',
            uncompressedBytes: '59362078720',
            parts: '36',
            activeParts: '32',
            skipIndexTypes: ['bloom_filter'],
        },
        {
            database: 'demo',
            name: 'daily_metrics',
            engine: 'SummingMergeTree',
            orderBy: '(day, country, channel)',
            primaryKey: 'day, country',
            partitionKey: 'toYYYYMM(day)',
            rowEstimate: '1095',
            sizeBytes: '1048576',
            uncompressedBytes: '3145728',
            parts: '3',
            activeParts: '3',
            projections: [{ name: 'by_channel', type: 'Normal', sortingKey: 'channel, day' }],
            skipIndexes: [],
        },
        {
            database: 'demo',
            name: 'users',
            engine: 'ReplacingMergeTree',
            orderBy: '(tenant_id, user_id)',
            primaryKey: 'tenant_id, user_id',
            rowEstimate: '4120000',
            sizeBytes: '1207959552',
            uncompressedBytes: '3892314112',
            parts: '18',
            activeParts: '16',
        },
        {
            database: 'demo',
            name: 'interview_imports',
            engine: 'MergeTree',
            orderBy: '(day, region, channel)',
            primaryKey: 'day, region, channel',
            partitionKey: 'toYYYYMM(day)',
            rowEstimate: '0',
            sizeBytes: '0',
            uncompressedBytes: '0',
            parts: '0',
            activeParts: '0',
        },
    ],
    columns: [
        ...schemaColumns('events', [
            ['tenant_id', 'UInt64', 'Synthetic tenant identifier'],
            ['event_time', 'DateTime64(3)', 'Synthetic event timestamp'],
            [
                'event_type',
                'LowCardinality(String)',
                'Event name such as page_view, signup_start, or purchase',
            ],
            ['user_id', 'UInt64', 'Synthetic user identifier'],
            ['session_id', 'UUID', 'Synthetic session identifier'],
            ['country', 'LowCardinality(String)', 'Visitor country'],
            ['region', 'LowCardinality(String)', 'Visitor region'],
            ['device_type', 'LowCardinality(String)', 'Device category'],
            ['page_path', 'String', 'Page or endpoint path'],
            ['channel', 'LowCardinality(String)', 'Acquisition channel'],
            ['campaign_id', 'UInt32', 'Marketing campaign identifier'],
            ['status', 'UInt16', 'HTTP-like response status'],
            ['duration_ms', 'UInt32', 'Synthetic request duration in milliseconds'],
            ['revenue', 'Decimal(18, 2)', 'Synthetic attributed revenue'],
            ['currency', 'FixedString(3)', 'ISO currency code'],
        ]),
        ...schemaColumns('sessions', [
            ['tenant_id', 'UInt64', 'Synthetic tenant identifier'],
            ['session_id', 'UUID', 'Synthetic session identifier'],
            ['user_id', 'UInt64', 'Synthetic user identifier'],
            ['started_at', 'DateTime', 'Session start time'],
            ['ended_at', 'DateTime', 'Session end time'],
            ['landing_page', 'String', 'First page visited'],
            ['exit_page', 'String', 'Last page visited'],
            ['country', 'LowCardinality(String)', 'Visitor country'],
            ['device_type', 'LowCardinality(String)', 'Device category'],
            ['channel', 'LowCardinality(String)', 'Acquisition channel'],
            ['page_views', 'UInt16', 'Pages viewed in this session'],
            ['converted', 'UInt8', 'Whether the session converted'],
        ]),
        ...schemaColumns('orders', [
            ['tenant_id', 'UInt64', 'Synthetic tenant identifier'],
            ['order_id', 'UInt64', 'Synthetic order identifier'],
            ['user_id', 'UInt64', 'Synthetic user identifier'],
            ['order_time', 'DateTime', 'Order creation time'],
            ['order_status', 'LowCardinality(String)', 'Order lifecycle status'],
            ['channel', 'LowCardinality(String)', 'Acquisition channel'],
            ['currency', 'FixedString(3)', 'ISO currency code'],
            ['subtotal', 'Decimal(18, 2)', 'Order subtotal'],
            ['tax', 'Decimal(18, 2)', 'Tax amount'],
            ['total', 'Decimal(18, 2)', 'Total order value'],
            ['item_count', 'UInt8', 'Number of items in the order'],
        ]),
        ...schemaColumns('daily_metrics', [
            ['day', 'Date', 'UTC date bucket'],
            ['country', 'LowCardinality(String)', 'Visitor country'],
            ['channel', 'LowCardinality(String)', 'Acquisition channel'],
            ['events', 'UInt64', 'Aggregated event count'],
            ['unique_users', 'UInt64', 'Distinct users for the day'],
            ['sessions', 'UInt64', 'Session count'],
            ['orders', 'UInt64', 'Completed order count'],
            ['revenue', 'Decimal(20, 2)', 'Attributed revenue'],
        ]),
        ...schemaColumns('users', [
            ['tenant_id', 'UInt64', 'Synthetic tenant identifier'],
            ['user_id', 'UInt64', 'Synthetic user identifier'],
            ['created_at', 'DateTime', 'Account creation time'],
            ['plan', 'LowCardinality(String)', 'Subscription plan'],
            ['country', 'LowCardinality(String)', 'Account country'],
            ['lifetime_value', 'Decimal(18, 2)', 'Synthetic lifetime value'],
        ]),
        ...schemaColumns('interview_imports', [
            ['day', 'Date', 'Import date'],
            ['region', 'LowCardinality(String)', 'Sales region'],
            ['channel', 'LowCardinality(String)', 'Acquisition channel'],
            ['events', 'UInt64', 'Event count'],
            ['revenue', 'Decimal(18, 2)', 'Attributed revenue'],
        ]),
    ],
    dictionaries: [
        {
            database: 'demo',
            name: 'campaign_lookup',
            status: 'LOADED',
            type: 'Hashed',
            keyColumns: 'campaign_id UInt32',
            attributeColumns: 'campaign_name String, channel String, start_date Date',
            elementCount: '18240',
            memoryBytes: '5242880',
            lastSuccessfulUpdate: now().replace('T', ' ').slice(0, 19),
        },
        {
            database: 'demo',
            name: 'country_lookup',
            status: 'LOADED',
            type: 'Flat',
            keyColumns: 'country_code FixedString(2)',
            attributeColumns: 'country_name String, region String, currency FixedString(3)',
            elementCount: '249',
            memoryBytes: '196608',
            lastSuccessfulUpdate: now().replace('T', ' ').slice(0, 19),
        },
    ],
    warnings: [
        'Schema estimates, sample rows, and query results are synthetic browser fixtures, not live ClickHouse data.',
    ],
    truncated: false,
};

export function connection(trusted: boolean): Connection & { trusted: boolean } {
    const available = { available: true };
    return {
        dataSource: 'fixture',
        id: 'demo',
        name: 'Sample data',
        host: 'fixture://browser-preview',
        database: 'demo',
        username: 'sample-reader',
        readonly: true,
        trusted,
        limits: { ...DEFAULT_LIMITS },
        manifest: {
            version: 1,
            serverVersion: 'Frontend sample data',
            testedAt: now(),
            schema: available,
            progress: available,
            cancellation: available,
            explain: available,
            explainAnalyze: available,
            queryTree: available,
            pipeline: available,
            queryLog: available,
            queryLogSource: 'query_log',
            traceLog: available,
            replication: available,
            documentation: {
                available: false,
                reason: 'System-table documentation is not connected in preview mode.',
            },
            import: {
                available: true,
                reason: 'Interview demo imports are stored in this browser only.',
            },
            scripts: available,
            parameters: {
                available: false,
                reason: 'Sample results do not evaluate SQL parameters.',
            },
        },
    };
}

type PreviewRows = Pick<Result, 'columns' | 'rows'>;
const countries = [
    ['United States', 18420, 6120, 14892.4],
    ['United Kingdom', 12680, 4380, 10340.75],
    ['Germany', 9820, 3510, 8451.2],
    ['France', 8240, 2960, 7118.9],
    ['Japan', 7160, 2540, 6294.35],
    ['Canada', 6840, 2310, 5740.8],
    ['Australia', 5380, 1890, 4632.5],
    ['Netherlands', 4920, 1720, 4198.25],
    ['Spain', 4310, 1510, 3620.1],
    ['Sweden', 3680, 1260, 3182.65],
] as const;
const channels = [
    ['Organic search', 286, 38240.5, 133.71],
    ['Direct', 224, 31418.2, 140.26],
    ['Paid search', 178, 26749.8, 150.28],
    ['Referral', 116, 16892.4, 145.62],
    ['Email', 94, 12480.75, 132.77],
    ['Social', 62, 7386.1, 119.13],
] as const;
const endpoints = [
    ['/api/events', 48620, 38, 142, 286],
    ['/api/reports/summary', 12840, 86, 318, 742],
    ['/api/users', 9720, 54, 224, 508],
    ['/api/orders', 7860, 62, 268, 624],
    ['/api/search', 5210, 112, 486, 1086],
    ['/api/exports', 1840, 328, 1260, 2418],
    ['/api/segments', 1460, 94, 412, 980],
    ['/api/billing', 980, 48, 186, 422],
] as const;
const steps = [
    ['Visit', 84200, 100],
    ['Create account', 12640, 15],
    ['Activate', 7840, 9.3],
] as const;

function dateDaysAgo(daysAgo: number) {
    return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function monthStart(monthsAgo: number) {
    const date = new Date();
    date.setUTCDate(1);
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCMonth(date.getUTCMonth() - monthsAgo);
    return date.toISOString().slice(0, 10);
}

function dailyRows(): PreviewRows {
    const rows = Array.from({ length: 30 }, (_, index) => {
        const daysAgo = 29 - index;
        const events = 26800 + ((index * 947 + index * index * 19) % 13900);
        const users = Math.round(events * (0.31 + (index % 5) * 0.012));
        const revenue = Math.round(events * (0.041 + (index % 7) * 0.0023) * 100) / 100;
        return [dateDaysAgo(daysAgo), events, users, revenue];
    });
    return {
        columns: [
            { name: 'day', type: 'Date' },
            { name: 'events', type: 'UInt64' },
            { name: 'unique_users', type: 'UInt64' },
            { name: 'revenue', type: 'Decimal(18, 2)' },
        ],
        rows,
    };
}

function normalizePreviewSql(sql: string) {
    return sql.toLowerCase().replace(/\s+/g, ' ').trim();
}

function hourlyTrafficRows(): PreviewRows {
    const rows = Array.from({ length: 24 }, (_, index) => {
        const hour =
            new Date(Date.now() - (23 - index) * 60 * 60 * 1000).toISOString().slice(0, 13) +
            ':00:00';
        const events = 1250 + ((index * 173 + index * index * 11) % 2340);
        return [hour, events, Math.round(events * (0.006 + (index % 4) * 0.001))];
    });
    return {
        columns: [
            { name: 'hour', type: 'DateTime' },
            { name: 'events', type: 'UInt64' },
            { name: 'server_errors', type: 'UInt64' },
        ],
        rows,
    };
}

function latencyAnomalyRows(): PreviewRows {
    const p95Values = [218, 205, 212, 224, 216, 208, 230, 226, 219, 305, 468, 612];
    const rows = p95Values.flatMap((p95, index) => {
        const history = p95Values.slice(Math.max(0, index - 7), index);
        if (history.length === 0) return [];
        const hour =
            new Date(Date.now() - (p95Values.length - index) * 60 * 60 * 1000)
                .toISOString()
                .slice(0, 13) + ':00:00';
        const baseline = history.reduce((sum, value) => sum + value, 0) / history.length;
        const deviation = Math.sqrt(
            history.reduce((sum, value) => sum + (value - baseline) ** 2, 0) / history.length,
        );
        return [
            [
                hour,
                '/api/checkout',
                p95,
                Math.round(baseline * 10) / 10,
                Math.round((baseline + 3 * deviation) * 10) / 10,
            ],
        ];
    });
    return {
        columns: [
            { name: 'hour', type: 'DateTime' },
            { name: 'page_path', type: 'String' },
            { name: 'p95_ms', type: 'Float64' },
            { name: 'baseline_ms', type: 'Float64' },
            { name: 'alert_threshold_ms', type: 'Float64' },
        ],
        rows,
    };
}

function recentEventRows(): PreviewRows {
    const recentUsers: Array<[number, string, string, number]> = [
        [1042, 'purchase', '/pricing/checkout', 8],
        [2088, 'signup_complete', '/welcome', 20],
        [3811, 'page_view', '/docs/sql', 35],
        [4927, 'add_to_cart', '/products/analytics', 52],
        [6120, 'purchase', '/pricing/checkout', 71],
    ];
    const rows = recentUsers.map(([userId, event, page, minutesAgo]) => [
        userId,
        event,
        page,
        new Date(Date.now() - minutesAgo * 60_000).toISOString().slice(0, 19).replace('T', ' '),
    ]);
    return {
        columns: [
            { name: 'user_id', type: 'UInt64' },
            { name: 'last_event', type: 'String' },
            { name: 'last_page', type: 'String' },
            { name: 'last_seen', type: 'DateTime' },
        ],
        rows,
    };
}

const demoResultRows: Record<string, PreviewRows> = {
    'preview-starter-getting-started': dailyRows(),
    'preview-starter-top-countries': {
        columns: [
            { name: 'country', type: 'String' },
            { name: 'events', type: 'UInt64' },
            { name: 'unique_users', type: 'UInt64' },
            { name: 'revenue', type: 'Decimal(18, 2)' },
        ],
        rows: countries.map(row => [...row]),
    },
    'preview-starter-revenue-channel': {
        columns: [
            { name: 'channel', type: 'String' },
            { name: 'orders', type: 'UInt64' },
            { name: 'revenue', type: 'Decimal(18, 2)' },
            { name: 'average_order_value', type: 'Decimal(18, 2)' },
        ],
        rows: channels.map(row => [...row]),
    },
    'preview-starter-latency': {
        columns: [
            { name: 'page_path', type: 'String' },
            { name: 'requests', type: 'UInt64' },
            { name: 'p50_ms', type: 'UInt32' },
            { name: 'p95_ms', type: 'UInt32' },
            { name: 'p99_ms', type: 'UInt32' },
        ],
        rows: endpoints.map(row => [...row]),
    },
    'preview-starter-hourly': hourlyTrafficRows(),
    'preview-starter-funnel': {
        columns: [
            { name: 'step', type: 'String' },
            { name: 'users', type: 'UInt64' },
            { name: 'conversion_pct', type: 'Float64' },
        ],
        rows: steps.map(row => [...row]),
    },
    'preview-starter-device-engagement': {
        columns: [
            { name: 'device_type', type: 'String' },
            { name: 'sessions', type: 'UInt64' },
            { name: 'avg_page_views', type: 'Float64' },
            { name: 'conversion_rate', type: 'Float64' },
        ],
        rows: [
            ['Desktop', 24820, 5.8, 8.4],
            ['Mobile', 38640, 3.6, 5.1],
            ['Tablet', 4280, 4.2, 6.3],
        ],
    },
    'preview-starter-customer-value': {
        columns: [
            { name: 'plan', type: 'String' },
            { name: 'users', type: 'UInt64' },
            { name: 'average_lifetime_value', type: 'Decimal(18, 2)' },
        ],
        rows: [
            ['Free', 18420, 0],
            ['Starter', 12680, 48.5],
            ['Growth', 6420, 286.4],
            ['Business', 1280, 1842.75],
        ],
    },
    'preview-starter-daily-rollup': {
        columns: [
            { name: 'day', type: 'Date' },
            { name: 'events', type: 'UInt64' },
            { name: 'orders', type: 'UInt64' },
            { name: 'revenue', type: 'Decimal(18, 2)' },
        ],
        rows: dailyRows().rows.map((row, index) => [
            row[0]!,
            row[1]!,
            Math.round(Number(row[1]) * (0.004 + (index % 4) * 0.0007)),
            row[3]!,
        ]),
    },
    'preview-starter-latency-anomaly': latencyAnomalyRows(),
    'preview-starter-latest-event': recentEventRows(),
    'preview-starter-top-pages-country': {
        columns: [
            { name: 'country', type: 'String' },
            { name: 'page_path', type: 'String' },
            { name: 'page_views', type: 'UInt64' },
            { name: 'visitors', type: 'UInt64' },
        ],
        rows: [
            ['United States', '/pricing', 3240, 1940],
            ['United States', '/docs/sql', 2860, 1710],
            ['United States', '/blog/clickhouse', 1940, 1280],
            ['United Kingdom', '/docs/sql', 1620, 980],
            ['United Kingdom', '/pricing', 1480, 910],
            ['United Kingdom', '/blog/clickhouse', 1140, 740],
            ['Germany', '/docs/sql', 1320, 810],
            ['Germany', '/pricing', 1080, 640],
            ['Germany', '/blog/clickhouse', 920, 580],
        ],
    },
    'preview-starter-distinct-estimates': {
        columns: [
            { name: 'exact_visitors', type: 'UInt64' },
            { name: 'estimated_visitors', type: 'UInt64' },
            { name: 'difference_pct', type: 'Float64' },
        ],
        rows: [[84216, 84102, 0.14]],
    },
    'preview-starter-monthly-revenue': {
        columns: [
            { name: 'month', type: 'Date' },
            { name: 'completed_orders', type: 'UInt64' },
            { name: 'revenue', type: 'Decimal(18, 2)' },
        ],
        rows: [
            [monthStart(5), 284, 38420.5],
            [monthStart(4), 312, 42118.2],
            [monthStart(3), 298, 39749.8],
            [monthStart(2), 346, 46792.4],
            [monthStart(1), 371, 51280.75],
            [monthStart(0), 354, 49886.1],
        ],
    },
    'preview-starter-channel-conversion': {
        columns: [
            { name: 'channel', type: 'String' },
            { name: 'sessions', type: 'UInt64' },
            { name: 'conversions', type: 'UInt64' },
            { name: 'conversion_rate_pct', type: 'Float64' },
        ],
        rows: [
            ['Organic search', 28600, 2402, 8.4],
            ['Direct', 22400, 1142, 5.1],
            ['Paid search', 17800, 1602, 9],
            ['Referral', 11600, 731, 6.3],
            ['Email', 9400, 902, 9.6],
            ['Social', 6200, 316, 5.1],
        ],
    },
    'preview-starter-signup-cohorts': {
        columns: [
            { name: 'cohort_month', type: 'Date' },
            { name: 'plan', type: 'String' },
            { name: 'new_users', type: 'UInt64' },
            { name: 'average_lifetime_value', type: 'Decimal(18, 2)' },
        ],
        rows: [
            [monthStart(5), 'Free', 1320, 0],
            [monthStart(5), 'Starter', 840, 48.5],
            [monthStart(4), 'Free', 1480, 0],
            [monthStart(4), 'Starter', 920, 52.8],
            [monthStart(3), 'Free', 1590, 0],
            [monthStart(3), 'Growth', 246, 284.6],
            [monthStart(2), 'Free', 1680, 0],
            [monthStart(2), 'Growth', 284, 302.4],
            [monthStart(1), 'Free', 1840, 0],
            [monthStart(1), 'Starter', 1120, 61.2],
            [monthStart(0), 'Free', 1760, 0],
            [monthStart(0), 'Growth', 318, 326.8],
        ],
    },
    'preview-starter-product-page-conversion': {
        columns: [
            { name: 'page_path', type: 'String' },
            { name: 'page_views', type: 'UInt64' },
            { name: 'purchasers', type: 'UInt64' },
            { name: 'conversion_rate_pct', type: 'Float64' },
        ],
        rows: [
            ['/products/analytics', 18420, 1286, 6.98],
            ['/products/cloud', 14280, 1154, 8.08],
            ['/products/observability', 9860, 624, 6.33],
            ['/products/ingestion', 7420, 518, 6.98],
        ],
    },
};
const demoStarterIdBySql = new Map(
    DEMO_PREVIEW_STARTERS.map(starter => [normalizePreviewSql(starter.sql), starter.id]),
);

function previewRowsFor(sql: string): PreviewRows {
    const starterId = demoStarterIdBySql.get(normalizePreviewSql(sql));
    return starterId ? (demoResultRows[starterId] ?? dailyRows()) : dailyRows();
}

export function resultFor(run: Run): Result {
    const preview = previewRowsFor(run.sql);
    const columns = run.kind === 'query' ? preview.columns : [{ name: 'explain', type: 'String' }];
    const resultRows =
        run.kind === 'query'
            ? preview.rows
            : [
                  [
                      run.kind === 'analyze'
                          ? DEMO_EXPLAIN_ANALYZE
                          : run.kind === 'plan'
                            ? JSON.stringify([
                                  {
                                      Plan: {
                                          'Node Type': 'Expression',
                                          'Node Id': 'Expression_2',
                                          Description: 'Sample plan only; SQL is not evaluated.',
                                          Plans: [
                                              {
                                                  'Node Type': 'ReadFromFixture',
                                                  'Node Id': 'ReadFromFixture_0',
                                              },
                                          ],
                                      },
                                  },
                              ])
                            : run.kind === 'pipeline'
                              ? 'digraph { read [label="ReadFromFixture"]; filter [label="FilterTransform × 2"]; output [label="Output"]; read -> filter; filter -> output; }'
                              : demoIndexAnalysis,
                  ],
              ];
    return {
        runId: run.id,
        queryId: run.queryId,
        columns,
        rows: resultRows,
        completeness: 'complete',
        createdAt: now(),
        expiresAt: expiresAt(),
    };
}

export function chartConfig(value: unknown): QueryDocument['chart'] {
    const chart = record(value);
    const chartIndex = (index: unknown): index is number =>
        typeof index === 'number' && Number.isSafeInteger(index) && index >= 0 && index <= 499;
    if (
        chart.kind === 'candlestick' &&
        chartIndex(chart.x) &&
        Array.isArray(chart.ys) &&
        chart.ys.every(chartIndex) &&
        typeof chart.title === 'string'
    ) {
        const candle = record(chart.candlestick);
        return {
            kind: 'candlestick',
            x: chart.x,
            ys: chart.ys.filter(chartIndex),
            title: chart.title,
            candlestick: {
                ...(chartIndex(candle.open) ? { open: candle.open } : {}),
                ...(chartIndex(candle.high) ? { high: candle.high } : {}),
                ...(chartIndex(candle.low) ? { low: candle.low } : {}),
                ...(chartIndex(candle.close) ? { close: candle.close } : {}),
                ...(chartIndex(candle.bid) ? { bid: candle.bid } : {}),
                ...(chartIndex(candle.ask) ? { ask: candle.ask } : {}),
                ...(chartIndex(candle.spread) ? { spread: candle.spread } : {}),
                ...(chartIndex(candle.quoteActivity)
                    ? { quoteActivity: candle.quoteActivity }
                    : {}),
            },
        };
    }
    const kind = CHART_KINDS.find(kind => kind === chart.kind);
    if (
        kind &&
        kind !== 'candlestick' &&
        chartIndex(chart.x) &&
        Array.isArray(chart.ys) &&
        chart.ys.every(chartIndex) &&
        typeof chart.title === 'string'
    )
        return {
            kind,
            x: chart.x,
            ...(chartIndex(chart.groupBy) ? { groupBy: chart.groupBy } : {}),
            ys: chart.ys.filter(chartIndex),
            title: chart.title,
        };
    return { kind: 'table', x: 0, ys: [], title: 'Query result' };
}

export function metricContract(value: unknown): QueryDocument['metric'] {
    const metric = record(value);
    if (
        typeof metric.definition === 'string' &&
        typeof metric.grain === 'string' &&
        typeof metric.timezone === 'string' &&
        typeof metric.filters === 'string' &&
        typeof metric.nullTreatment === 'string' &&
        Array.isArray(metric.dimensions) &&
        metric.dimensions.every(item => typeof item === 'string') &&
        Array.isArray(metric.sourceColumns) &&
        metric.sourceColumns.every(item => typeof item === 'string')
    )
        return {
            definition: metric.definition,
            grain: metric.grain,
            timezone: metric.timezone,
            filters: metric.filters,
            nullTreatment: metric.nullTreatment,
            dimensions: metric.dimensions.filter(
                (item): item is string => typeof item === 'string',
            ),
            sourceColumns: metric.sourceColumns.filter(
                (item): item is string => typeof item === 'string',
            ),
        };
    return undefined;
}

export function makeRun(
    id: string,
    sql: string,
    kind: Run['kind'],
    sequence: number,
    parameters: Record<string, string> = {},
): Run {
    const createdAt = now();
    const queryId = `preview-${sequence}`;
    const resultState = 'reopenable' as const;
    const preview = previewRowsFor(sql);
    const columns = kind === 'query' ? preview.columns : [{ name: 'explain', type: 'String' }];
    const resultRows = kind === 'query' ? preview.rows.length : 1;
    return {
        dataSource: 'fixture',
        id,
        queryId,
        owner,
        connectionId: 'demo',
        sql,
        kind,
        parameters,
        limits: { ...DEFAULT_LIMITS },
        tags: { workspace: 'clickstudio', mode: 'sample preview' },
        status: 'succeeded',
        createdAt,
        startedAt: createdAt,
        finishedAt: createdAt,
        elapsedMs: 38 + sequence,
        rowCount: resultRows,
        bytes: kind === 'query' ? JSON.stringify(preview.rows).length : 90,
        columns,
        warnings: ['DEMO FIXTURE: these generated rows do not evaluate the SQL in the editor.'],
        sequence,
        resultExpiresAt: expiresAt(),
        resultState,
        requestedBy: owner,
        executedAs: 'sample-reader',
        permissionSnapshot: { readonly: true, role: 'owner' },
        retryPolicy: 'never',
    };
}
