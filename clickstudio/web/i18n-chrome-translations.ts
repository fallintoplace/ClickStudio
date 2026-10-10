import type { Copy, Locale } from './i18n-types.js';

export const chromeTranslations: Record<Exclude<Locale, 'en'>, {
    app: Pick<Copy['app'], 'darkTheme' | 'lightTheme' | 'accent' | 'cyanAccent' | 'clickhouseYellowAccent'>;
    auth: Pick<Copy['auth'], 'privateWorkspace' | 'unavailable' | 'retry' | 'credentialsNotice'>;
}> = {
    zh: {
        app: { darkTheme: '深色主题', lightTheme: '浅色主题', accent: '强调色', cyanAccent: '青色强调', clickhouseYellowAccent: 'ClickHouse 黄色强调' },
        auth: { privateWorkspace: '私有工作区', unavailable: '工作区不可用', retry: '重试', credentialsNotice: '凭据由工作区服务器处理。' },
    },
};

export const exampleCommonTranslations: Record<Exclude<Locale, 'en'>, Pick<Copy['common'],
    'exampleCharts' | 'exampleChartTable' | 'exampleChartNumber' | 'exampleChartLine' | 'exampleChartBar' | 'exampleChartScatter' | 'exampleChartHeatmap' | 'exampleChartCandlestick' | 'examplePreviewTable' | 'exampleReadRows' | 'openExample'>> = {
    zh: {
        exampleCharts: '图表', exampleChartTable: '表格', exampleChartNumber: '数值', exampleChartLine: '折线图',
        exampleChartBar: '柱状图', exampleChartScatter: '散点图', exampleChartHeatmap: '热力图', exampleChartCandlestick: '蜡烛图',
        examplePreviewTable: '预览：{table}', exampleReadRows: '读取此表最多 50 行。', openExample: '打开',
    },
};
