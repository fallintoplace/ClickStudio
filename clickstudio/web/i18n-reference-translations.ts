import type { Copy, Locale } from './i18n-types.js';

type ReferenceTranslation = Pick<Copy['common'],
    'reference' | 'referenceSearch' | 'referenceAll' | 'referenceFunctions' | 'referenceTypes' | 'referenceEngines' |
    'referenceSettings' | 'referenceSystem' | 'referenceNoMatches' | 'referenceNative' |
    'referenceBundled' | 'referenceSource' | 'referenceBack' | 'referenceEntryUnavailable' | 'referenceRetry' |
    'referenceBundledNote' | 'referenceCategories' | 'referenceMatches' | 'referenceEmptyHint' | 'referenceResults' |
    'referenceInsert' | 'referenceCopy' | 'referenceSystemTable' | 'clearSearch'>;

export const referenceTranslations: Record<Exclude<Locale, 'en'>, ReferenceTranslation> = {
    zh: { reference: '参考', referenceSearch: '搜索 ClickHouse…', referenceAll: '全部', referenceFunctions: '函数', referenceTypes: '类型', referenceEngines: '引擎', referenceSettings: '设置', referenceSystem: '系统', referenceNoMatches: '没有匹配的参考条目。', referenceNative: 'ClickHouse 原生参考', referenceBundled: '内置演示参考', referenceSource: '来源', referenceBack: '返回结果', referenceEntryUnavailable: '所选服务器没有此条目的文档。', referenceRetry: '重试', referenceBundledNote: 'ClickStudio 内含示例条目。', referenceCategories: '参考类别', referenceMatches: '{count} 条匹配', referenceEmptyHint: '尝试其他名称或类别。', referenceResults: '参考结果', referenceInsert: '插入名称', referenceCopy: '复制名称', referenceSystemTable: '系统表参考', clearSearch: '清除搜索' },
};

type ReferenceCatalogTranslation = Pick<Copy['common'], 'referenceFormats' | 'referenceSql' | 'referenceBrowse' | 'referenceBundled' | 'referenceBundledNote'>;

export const referenceCatalogTranslations: Record<Exclude<Locale, 'en'>, ReferenceCatalogTranslation> = {
    zh: { referenceFormats: '格式', referenceSql: 'SQL', referenceBrowse: '浏览完整目录', referenceBundled: '离线 ClickHouse 参考', referenceBundledNote: '完整离线目录，包含 SQL 示例。' },
};

type ObjectExplorerTranslation = Pick<Copy['common'],
    'objects' | 'objectSearch' | 'objectCount' | 'noObjectsMatch' | 'noObjectsMatchHint' | 'noObjectsAvailable' | 'noObjectsAvailableHint' | 'views' | 'dictionaries' | 'columns' |
    'previewRows' | 'generateSelect' | 'newTable' | 'insertRow' | 'deleteTable' | 'insertName' | 'copyName' | 'copied'>;

export const objectExplorerTranslations: Record<Exclude<Locale, 'en'>, ObjectExplorerTranslation> = {
    zh: { objects: '对象', objectSearch: '搜索对象、列、引擎和索引…', objectCount: '{count} 个对象', noObjectsMatch: '没有匹配的对象。', noObjectsMatchHint: '请尝试其他名称、类型、引擎、索引或列。', noObjectsAvailable: '未找到对象。', noObjectsAvailableHint: '此连接中没有可见的表、视图或字典。', views: '视图', dictionaries: '字典', columns: '列', previewRows: '预览行', generateSelect: '生成 SELECT', newTable: '新建表', insertRow: '插入行', deleteTable: '删除表', insertName: '插入名称', copyName: '复制名称', copied: '已复制' },
};
