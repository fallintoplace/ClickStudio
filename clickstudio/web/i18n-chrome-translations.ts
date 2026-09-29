import type { Copy, Locale } from './i18n-types.js';

export const chromeTranslations: Record<Exclude<Locale, 'en'>, {
    app: Pick<Copy['app'], 'darkTheme' | 'lightTheme' | 'accent' | 'cyanAccent' | 'clickhouseYellowAccent'>;
    auth: Pick<Copy['auth'], 'privateWorkspace' | 'unavailable' | 'retry' | 'credentialsNotice'>;
}> = {
    de: {
        app: { darkTheme: 'Dunkles Design', lightTheme: 'Helles Design', accent: 'Akzentfarbe', cyanAccent: 'Cyan-Akzent', clickhouseYellowAccent: 'ClickHouse-gelber Akzent' },
        auth: { privateWorkspace: 'Privater Arbeitsbereich', unavailable: 'Arbeitsbereich nicht verfügbar', retry: 'Erneut versuchen', credentialsNotice: 'Anmeldedaten werden vom Workspace-Server verarbeitet.' },
    },
    es: {
        app: { darkTheme: 'Tema oscuro', lightTheme: 'Tema claro', accent: 'Color de acento', cyanAccent: 'Acento cian', clickhouseYellowAccent: 'Acento amarillo de ClickHouse' },
        auth: { privateWorkspace: 'Espacio de trabajo privado', unavailable: 'Espacio de trabajo no disponible', retry: 'Intentar de nuevo', credentialsNotice: 'Las credenciales se procesan en el servidor del espacio de trabajo.' },
    },
    nl: {
        app: { darkTheme: 'Donker thema', lightTheme: 'Licht thema', accent: 'Accentkleur', cyanAccent: 'Cyaan accent', clickhouseYellowAccent: 'ClickHouse-geel accent' },
        auth: { privateWorkspace: 'Privéwerkruimte', unavailable: 'Werkruimte niet beschikbaar', retry: 'Opnieuw proberen', credentialsNotice: 'Aanmeldgegevens worden verwerkt door de werkruimteserver.' },
    },
    zh: {
        app: { darkTheme: '深色主题', lightTheme: '浅色主题', accent: '强调色', cyanAccent: '青色强调', clickhouseYellowAccent: 'ClickHouse 黄色强调' },
        auth: { privateWorkspace: '私有工作区', unavailable: '工作区不可用', retry: '重试', credentialsNotice: '凭据由工作区服务器处理。' },
    },
    ru: {
        app: { darkTheme: 'Тёмная тема', lightTheme: 'Светлая тема', accent: 'Цвет акцента', cyanAccent: 'Голубой акцент', clickhouseYellowAccent: 'Жёлтый акцент ClickHouse' },
        auth: { privateWorkspace: 'Приватная рабочая область', unavailable: 'Рабочая область недоступна', retry: 'Повторить', credentialsNotice: 'Учётные данные обрабатываются сервером рабочей области.' },
    },
};

export const exampleCommonTranslations: Record<Exclude<Locale, 'en'>, Pick<Copy['common'],
    'exampleCharts' | 'exampleChartTable' | 'exampleChartNumber' | 'exampleChartLine' | 'exampleChartBar' | 'exampleChartScatter' | 'exampleChartHeatmap' | 'exampleChartCandlestick' | 'examplePreviewTable' | 'exampleReadRows' | 'openExample'>> = {
    de: {
        exampleCharts: 'Diagramme', exampleChartTable: 'Tabelle', exampleChartNumber: 'Zahl', exampleChartLine: 'Liniendiagramm',
        exampleChartBar: 'Balkendiagramm', exampleChartScatter: 'Streudiagramm', exampleChartHeatmap: 'Heatmap', exampleChartCandlestick: 'Candlestick-Diagramm',
        examplePreviewTable: 'Vorschau: {table}', exampleReadRows: 'Bis zu 50 Zeilen aus dieser Tabelle lesen.', openExample: 'Öffnen',
    },
    es: {
        exampleCharts: 'Gráficos', exampleChartTable: 'Tabla', exampleChartNumber: 'Número', exampleChartLine: 'Gráfico de líneas',
        exampleChartBar: 'Gráfico de barras', exampleChartScatter: 'Gráfico de dispersión', exampleChartHeatmap: 'Mapa de calor', exampleChartCandlestick: 'Gráfico de velas',
        examplePreviewTable: 'Vista previa: {table}', exampleReadRows: 'Leer hasta 50 filas de esta tabla.', openExample: 'Abrir',
    },
    nl: {
        exampleCharts: 'Grafieken', exampleChartTable: 'Tabel', exampleChartNumber: 'Getal', exampleChartLine: 'Lijndiagram',
        exampleChartBar: 'Staafdiagram', exampleChartScatter: 'Spreidingsdiagram', exampleChartHeatmap: 'Heatmap', exampleChartCandlestick: 'Candlestickgrafiek',
        examplePreviewTable: 'Voorbeeld van {table}', exampleReadRows: 'Lees maximaal 50 rijen uit deze tabel.', openExample: 'Openen',
    },
    zh: {
        exampleCharts: '图表', exampleChartTable: '表格', exampleChartNumber: '数值', exampleChartLine: '折线图',
        exampleChartBar: '柱状图', exampleChartScatter: '散点图', exampleChartHeatmap: '热力图', exampleChartCandlestick: '蜡烛图',
        examplePreviewTable: '预览：{table}', exampleReadRows: '读取此表最多 50 行。', openExample: '打开',
    },
    ru: {
        exampleCharts: 'Графики', exampleChartTable: 'Таблица', exampleChartNumber: 'Число', exampleChartLine: 'Линейный график',
        exampleChartBar: 'Столбчатая диаграмма', exampleChartScatter: 'Диаграмма рассеяния', exampleChartHeatmap: 'Тепловая карта', exampleChartCandlestick: 'Свечной график',
        examplePreviewTable: 'Просмотр: {table}', exampleReadRows: 'Прочитать до 50 строк из этой таблицы.', openExample: 'Открыть',
    },
};
