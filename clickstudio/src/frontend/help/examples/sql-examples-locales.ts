import type { Locale } from '../../common/translations/i18n-types.js';
import type { SqlExample, SqlExampleCategory } from './sql-examples.js';

type ExampleText = Pick<SqlExample, 'name' | 'description'>;
type Translation = readonly [name: string, description: string];

const translations: Record<Exclude<Locale, 'en'>, Record<string, Translation>> = {
    zh: {
        'cloud-write-create-demo': [
            '创建并填充示例表',
            '创建一个包含生成事件的小型 MergeTree 表。表已存在时，IF NOT EXISTS 不会更改它。需要 CREATE 权限。',
        ],
        'cloud-write-insert-demo': [
            '向示例表插入行',
            '追加两行示例数据。请先运行创建示例；每次运行都会追加数据。需要 INSERT 权限。',
        ],
        'github-recent-events': ['近期 GitHub 事件', '查看真实事件、仓库、用户和时间戳。'],
        'github-daily-activity': ['每日活动', '比较过去 30 天的事件量和活跃用户。'],
        'github-top-star-events': ['获星最多的仓库', '按近期 GitHub 获星事件对仓库排序。'],
        'github-pr-contributors': [
            '每月 PR 贡献者',
            '统计 ClickHouse 拉取请求活动中的独立贡献者。',
        ],
        'github-release-cadence': ['ClickHouse 发布节奏', '按年份查看项目发布节奏的变化。'],
        'github-issues-mentioning-clickhouse': [
            '提及 ClickHouse 的议题',
            '跟踪各仓库中提及 ClickHouse 的议题。',
        ],
        'hackernews-daily-pulse': ['帖子与评论', '比较过去 90 天的每日帖子和评论数量。'],
        'nyc-taxi-weekly-rhythm': [
            '按星期和小时统计出租车行程',
            '通过包含 168 个单元格的热力图查看高峰时段。',
        ],
        'nyc-taxi-fare-distance': ['车费与行程距离', '探索行程距离与计价车费之间的关系。'],
        'bluesky-activity-by-hour': [
            'Bluesky 每小时活动',
            '使用 ClickHouse 每小时汇总数据比较帖子、点赞和转发。',
        ],
        'stock-jnj-history': ['强生历史股价', '绘制示例股票表中的 180 个历史交易日。'],
        'pypi-package-downloads': [
            '每月软件包下载量',
            '比较 pandas、Polars 和 ClickHouse Python 驱动的月下载量。',
        ],
        'stackoverflow-qa-volume': [
            'Stack Overflow 问答数量',
            '查看存档中每月问题和回答数量的变化。',
        ],
        'uk-house-prices-by-county': [
            '按郡划分的英国房价',
            '按 2020 年以来的房屋成交中位价对郡排序。',
        ],
        'imdb-ratings-by-year': ['按年份统计电影评分', '比较不同上映年份电影的 IMDb 平均评分。'],
        'noaa-central-park-weather': [
            '纽约天气模式',
            '查看 2018 至 2022 年中央公园的月度天气类型。',
        ],
        'forex-eur-usd-monthly': ['EUR/USD 月度中间价', '跟踪 EUR/USD 每月平均买卖价中间值。'],
        'forex-eur-usd-market-view': [
            'EUR/USD 专业市场视图',
            '查看历史 15 分钟中间价蜡烛图，以及买卖价、报价活动和价差。',
        ],
        'nyc-taxi-fare-quantiles': [
            '按小时统计出租车费分位数',
            '按星期和上车小时比较车费中位数与第 95 百分位数。',
        ],
        'github-rolling-activity': [
            'GitHub 活动与滚动平均值',
            '使用七天窗口平滑 ClickHouse 仓库的每日活动。',
        ],
        'clickhouse-geo-cities': [
            '原生 Point 城市',
            '使用 ClickHouse 原生 Point 值比较全球 20 个城市的事件量。',
        ],
        'clickhouse-geo-flight-routes': [
            '洲际航线',
            '使用 ClickHouse 原生 LineString 值比较八条航线的乘客量。',
        ],
        'clickhouse-geo-delivery-zones': [
            '多彩配送区域',
            '绘制四个配送区域，并使用 ClickHouse 原生 Polygon 值比较订单量。',
        ],
        'preview-starter-getting-started': ['入门', '查看每日活动、独立用户数和归因收入。'],
        'preview-starter-top-countries': ['热门国家', '按国家比较事件、独立用户和收入。'],
        'preview-starter-revenue-channel': [
            '按渠道统计收入',
            '按渠道比较已完成订单和平均订单金额。',
        ],
        'preview-starter-latency': ['请求延迟', '比较请求量、中位延迟和高分位延迟。'],
        'preview-starter-hourly': ['每小时流量', '跟踪每小时事件量和服务器错误。'],
        'preview-starter-funnel': ['注册漏斗', '比较注册漏斗各步骤的用户数。'],
        'preview-starter-device-engagement': ['按设备统计参与度', '按设备比较会话数和转化率。'],
        'preview-starter-customer-value': ['客户价值', '按套餐比较平均客户价值。'],
        'preview-starter-daily-rollup': ['每日汇总', '使用预聚合表中的可加计数和收入。'],
        'preview-starter-latency-anomaly': [
            '延迟异常基线',
            '将 p95 延迟与滚动基线和告警阈值比较。',
        ],
        'preview-starter-latest-event': [
            '每位用户的最新事件',
            '使用 argMax 查找每位用户最近的事件和页面。',
        ],
        'preview-starter-top-pages-country': [
            '各国热门页面',
            '使用 LIMIT BY 查找每个国家最热门的三个页面。',
        ],
        'preview-starter-distinct-estimates': [
            '精确与估算访客数',
            '比较精确访客数和快速近似计数。',
        ],
        'preview-starter-monthly-revenue': ['月度收入', '使用条件聚合按月比较已完成订单和收入。'],
        'preview-starter-channel-conversion': [
            '按渠道统计转化',
            '使用 countIf 计算各渠道的转化次数和转化率。',
        ],
        'preview-starter-signup-cohorts': [
            '按套餐统计注册群组',
            '按月对新账户分组，并比较套餐和客户价值。',
        ],
        'preview-starter-product-page-conversion': [
            '商品页面转化',
            '使用条件聚合比较商品页面浏览量和独立购买用户数。',
        ],
        'clickhouse-server-version': ['ClickHouse 版本', '查看此连接所使用的 ClickHouse 版本。'],
        'clickhouse-server-time': ['服务器时间', '读取 ClickHouse 服务器当前时间。'],
        'clickhouse-numbers': ['生成数字序列', '使用 numbers 表函数创建一个小型结果集。'],
        'amazon-customer-review-health': [
            'Amazon 客户评论健康度',
            '比较高评论量商品类别中负面、中性和正面评论的占比。',
        ],
        'otel-service-latency-slo': [
            '服务延迟 SLO',
            '跟踪最近一小时前端服务端 Span 的 p50、p95 和 p99 延迟。',
        ],
        'ontime-flight-delay-operations': [
            '航班延误运营分析',
            '查看九年美国航班运营中的季节性起飞延误风险。',
        ],
        'stackoverflow-technology-trends': [
            '开发者技术趋势',
            '按季度比较 Python、JavaScript、Java 和 Rust 问题量，作为开发者关注度信号。',
        ],
    },
};

type SqlExampleCategoryFilter = SqlExampleCategory | 'featured';
type CategoryTranslations = Partial<Record<SqlExampleCategoryFilter, string>>;

const categoryTranslations: Record<Exclude<Locale, 'en'>, CategoryTranslations> = {
    zh: {
        featured: '精选',
        business: '业务',
        observability: '可观测性',
        operations: '运维',
        engineering: '工程',
        markets: '市场',
        cities: '城市',
        openSource: '开源',
        internet: '互联网',
        datasets: '数据集',
    },
};

export function localizeSqlExample(example: SqlExample, locale: Locale): ExampleText {
    if (locale === 'en') return { name: example.name, description: example.description };
    const translation = translations[locale]?.[example.id];
    return translation
        ? { name: translation[0], description: translation[1] }
        : { name: example.name, description: example.description };
}

export function localizeSqlExampleCategory(
    category: SqlExampleCategoryFilter,
    locale: Locale,
    fallback: string,
): string {
    if (locale === 'en') return fallback;
    return categoryTranslations[locale][category] ?? fallback;
}

export function hasSqlExampleTranslation(
    exampleId: string,
    locale: Exclude<Locale, 'en'>,
): boolean {
    return Object.hasOwn(translations[locale] ?? {}, exampleId);
}
