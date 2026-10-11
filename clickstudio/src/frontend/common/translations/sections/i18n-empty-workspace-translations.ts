import type { Copy, Locale } from '../i18n-types.js';

type EmptyWorkspaceTranslation = Pick<Copy['common'], 'noSqlTabsOpen' | 'noSqlTabsOpenDescription'>;

export const emptyWorkspaceTranslations: Record<
    Exclude<Locale, 'en'>,
    EmptyWorkspaceTranslation
> = {
    zh: {
        noSqlTabsOpen: '没有打开的 SQL 标签页',
        noSqlTabsOpenDescription: '开始一个空白查询，或恢复最近关闭的标签页。',
    },
};
