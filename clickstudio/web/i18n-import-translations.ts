import type { Copy, Locale } from './i18n-types.js';

export const importTranslations: Partial<Record<Locale, Partial<Copy['imports']>>> = {
    zh: {
        inputRow: '行',
        inputRows: '行',
        reviewOmittedTargets: '未映射的目标列将使用 ClickHouse 默认值：{columns}。',
        reviewMissingValues:
            '{source} 在 {count} {rowLabel} 中缺失。ClickHouse 将为 {destination} 使用默认值。',
        reviewRows: '待导入的行',
        reviewRowsNote: '显示的值已应用列映射。导入时，ClickHouse 会填充默认值和自动生成的列。',
        reviewRowRange: '显示第 {start}–{end} 行，共 {count} 行',
        reviewRowNumber: '行号',
        reviewRowsPagination: '导入行分页',
        reviewPage: '第 {page} / {pages} 页',
        reviewPreviousPage: '上一页',
        reviewNextPage: '下一页',
    },
};
