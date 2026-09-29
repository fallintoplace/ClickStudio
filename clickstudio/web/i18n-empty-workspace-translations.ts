import type { Copy, Locale } from './i18n-types.js';

type EmptyWorkspaceTranslation = Pick<Copy['common'], 'noSqlTabsOpen' | 'noSqlTabsOpenDescription'>;

export const emptyWorkspaceTranslations: Record<Exclude<Locale, 'en'>, EmptyWorkspaceTranslation> = {
    de: { noSqlTabsOpen: 'Keine SQL-Tabs geöffnet', noSqlTabsOpenDescription: 'Starten Sie eine leere Abfrage oder stellen Sie einen kürzlich geschlossenen Tab wieder her.' },
    es: { noSqlTabsOpen: 'No hay pestañas SQL abiertas', noSqlTabsOpenDescription: 'Inicia una consulta en blanco o restaura una pestaña cerrada recientemente.' },
    nl: { noSqlTabsOpen: 'Geen SQL-tabbladen geopend', noSqlTabsOpenDescription: 'Start een lege query of herstel een onlangs gesloten tabblad.' },
    zh: { noSqlTabsOpen: '没有打开的 SQL 标签页', noSqlTabsOpenDescription: '开始一个空白查询，或恢复最近关闭的标签页。' },
    ru: { noSqlTabsOpen: 'Нет открытых вкладок SQL', noSqlTabsOpenDescription: 'Создайте пустой запрос или восстановите недавно закрытую вкладку.' },
};
