import type { Copy, Locale } from './i18n-types.js';

export const importTranslations: Partial<Record<Locale, Partial<Copy['imports']>>> = {
    zh: {
        inputRow: '行',
        inputRows: '行',
        reviewOmittedTargets: '未映射的目标列将使用 ClickHouse 默认值：{columns}。',
        reviewMissingValues: '{source} 在 {count} {rowLabel} 中缺失。ClickHouse 将为 {destination} 使用默认值。',
    },
};
