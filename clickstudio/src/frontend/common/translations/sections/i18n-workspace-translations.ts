import type { Copy, Locale } from '../i18n-types.js';

type WorkspaceCommonTranslation = Pick<
    Copy['common'],
    | 'queryChanged'
    | 'queryChangedDescription'
    | 'parametersChanged'
    | 'parametersChangedDescription'
    | 'connectionChanged'
    | 'connectionChangedDescription'
    | 'sourceDeleted'
    | 'lastExecutionFailed'
    | 'output'
    | 'showOutput'
    | 'queryFailed'
    | 'fixWithAi'
    | 'syntaxError'
    | 'errorLocation'
    | 'syntaxErrorNearToken'
    | 'previousRun'
    | 'errorDetails'
    | 'failedSql'
    | 'previousResultsDescription'
    | 'workspaceMode'
    | 'browse'
    | 'readOnly'
    | 'tables'
    | 'queries'
    | 'more'
    | 'query'
    | 'format'
    | 'parserUnavailable'
    | 'retryParser'
    | 'sqlMap'
    | 'visualizeSqlStructure'
    | 'runScript'
    | 'runActionTrustRequired'
    | 'runActionWait'
    | 'runActionRemoveParameters'
    | 'playgroundScriptUnavailable'
    | 'askAi'
    | 'running'
    | 'incompleteSql'
    | 'oneStatement'
    | 'manyStatements'
    | 'queryVisualization'
    | 'workspaceOutput'
    | 'sqlStructure'
    | 'queryResults'
    | 'expand'
    | 'collapse'
    | 'expandQuery'
    | 'collapseQuery'
    | 'expandOutput'
    | 'collapseOutput'
    | 'sqlFlowTitle'
    | 'sqlFlowClickStage'
    | 'sqlFlowParserStarting'
    | 'sqlFlowParserUnavailable'
    | 'sqlFlowCodeMirror'
    | 'sqlFlowEmpty'
    | 'sqlFlowAstDetail'
    | 'sqlFlowSqlDetail'
    | 'sqlFlowNativeHeading'
    | 'sqlFlowFallbackHeading'
    | 'sqlFlowGraphHint'
    | 'sqlFlowReturnResult'
    | 'sqlFlowOutputColumns'
    | 'sqlFlowSelectedStage'
    | 'sqlFlowInspectStage'
    | 'sqlFlowStageDetails'
    | 'sqlFlowStages'
    | 'sqlFlowOperators'
    | 'sqlFlowConnections'
    | 'sqlFlowInputs'
    | 'sqlFlowOutputs'
    | 'sqlFlowReadKind'
    | 'sqlFlowOutputKind'
    | 'sqlFlowEstimatedStatus'
    | 'sqlFlowSourceDetail'
    | 'sqlFlowNoStages'
    | 'statusReady'
    | 'statusQueued'
    | 'statusRunning'
    | 'statusSucceeded'
    | 'statusTruncated'
    | 'statusCancelled'
    | 'statusTimedOut'
    | 'statusInterrupted'
    | 'statusComplete'
    | 'statusLiveUpdates'
    | 'statusReconnecting'
    | 'rowsRead'
    | 'bytesRead'
    | 'memory'
    | 'import'
    | 'export'
    | 'refresh'
    | 'workspaceInspector'
    | 'workspaceBrowser'
    | 'workspacePanels'
    | 'loading'
    | 'schemaPrivate'
    | 'trustToInspect'
    | 'readingSchema'
    | 'insertTableName'
    | 'rowsEstimated'
    | 'parts'
    | 'projections'
    | 'skipIndexes'
    | 'metadataUnavailable'
    | 'systemTable'
    | 'clickhouseSql'
    | 'runActions'
    | 'formatSql'
    | 'sqlFlowNativeAst'
    | 'sqlFlowLogicalMode'
    | 'sqlAstClickNode'
    | 'sqlAstGraphHint'
    | 'sqlAstUnavailable'
    | 'sqlAstSelectedNode'
    | 'sqlAstPath'
    | 'sqlAstChildren'
    | 'sqlAstProperties'
    | 'sqlAstNodes'
    | 'sqlAstTruncatedWarning'
    | 'sqlFlowKeywordEstimate'
    | 'sqlFlowTruncatedWarning'
    | 'lines'
    | 'sqlFlowFilterKind'
    | 'sqlFlowAggregateKind'
    | 'sqlFlowSortKind'
    | 'sqlFlowJoinKind'
    | 'sqlFlowTransformKind'
    | 'sqlFlowStageKind'
    | 'sqlFlowResizeKind'
>;

export const workspaceCommonTranslations: Record<
    Exclude<Locale, 'en'>,
    WorkspaceCommonTranslation
> = {
    zh: {
        queryChanged: '查询已更改',
        queryChangedDescription: '查询已更改。这些结果来自之前的 SQL。请重新运行以刷新。',
        parametersChanged: '参数已更改',
        parametersChangedDescription: '绑定参数已更改。这些结果使用之前的值。请重新运行以刷新。',
        connectionChanged: '连接已更改',
        connectionChangedDescription: '这些结果来自其他连接。请在当前连接上重新运行查询以刷新。',
        sourceDeleted: '数据源已删除',
        queryFailed: '查询失败',
        fixWithAi: '用 AI 修复',
        lastExecutionFailed: '上次执行失败',
        output: '输出',
        showOutput: '显示输出',
        syntaxError: '语法错误',
        errorLocation: '第 {line} 行，第 {column} 列',
        syntaxErrorNearToken: '{token} 附近有语法错误',
        previousRun: '上次执行',
        errorDetails: '详情',
        failedSql: '失败的 SQL',
        previousResultsDescription: '最新查询失败。这些结果来自上次成功的执行。',
        workspaceMode: '工作区',
        browse: '浏览',
        readOnly: '只读',
        tables: '表',
        queries: '已保存的查询',
        more: '更多',
        query: '查询',
        format: '格式化',
        parserUnavailable: '解析器不可用',
        retryParser: '重试解析器',
        sqlMap: 'SQL 结构图',
        visualizeSqlStructure: '可视化 SQL 结构',
        runScript: '运行脚本',
        runActionTrustRequired: '运行 SQL 前请先信任此连接。',
        runActionWait: '请等待当前操作完成。',
        runActionRemoveParameters: '运行此操作前请移除查询参数。',
        playgroundScriptUnavailable:
            '公共 Playground 每次请求只接受一条只读语句。此处无法运行脚本。',
        askAi: '询问 AI',
        running: '运行中…',
        incompleteSql: 'SQL 不完整',
        oneStatement: '{count} 条语句',
        manyStatements: '{count} 条语句',
        queryVisualization: '查询可视化',
        workspaceOutput: '工作区输出',
        sqlStructure: 'SQL 结构',
        queryResults: '查询结果',
        expand: '展开',
        collapse: '折叠',
        expandQuery: '展开 SQL 查询',
        collapseQuery: '折叠 SQL 查询',
        expandOutput: '展开输出',
        collapseOutput: '折叠输出',
        sqlFlowTitle: '此查询的组成方式',
        sqlFlowClickStage: '点击阶段可跳转到对应 SQL。',
        sqlFlowParserStarting: '解析器正在启动',
        sqlFlowParserUnavailable: '解析器不可用',
        sqlFlowCodeMirror: 'CodeMirror 模式',
        sqlFlowEmpty: '编写 SELECT 查询以生成结构图。',
        sqlFlowAstDetail: 'AST 详情：',
        sqlFlowSqlDetail: 'SQL 详情：',
        sqlFlowNativeHeading: 'CLICKHOUSE SQL 流程',
        sqlFlowFallbackHeading: 'SQL 流程 · 尽力解析',
        sqlFlowGraphHint: '点击节点查看子句，并在编辑器中定位到对应 SQL',
        sqlFlowReturnResult: '返回结果',
        sqlFlowOutputColumns: 'SELECT 列表生成的列',
        sqlFlowSelectedStage: '已选阶段',
        sqlFlowInspectStage: '查看阶段',
        sqlFlowStageDetails: '所选阶段详情',
        sqlFlowStages: '个阶段',
        sqlFlowOperators: '个算子',
        sqlFlowConnections: '条连接',
        sqlFlowInputs: '输入',
        sqlFlowOutputs: '输出',
        sqlFlowReadKind: '读取',
        sqlFlowOutputKind: '输出',
        sqlFlowEstimatedStatus: '估算',
        sqlFlowSourceDetail: '表来源',
        sqlFlowNoStages: '此语句中未找到 SQL 阶段。',
        statusReady: '就绪',
        statusQueued: '排队中',
        statusRunning: '运行中',
        statusSucceeded: '成功',
        statusTruncated: '已截断',
        statusCancelled: '已取消',
        statusTimedOut: '已超时',
        statusInterrupted: '已中断',
        statusComplete: '已完成',
        statusLiveUpdates: '实时更新',
        statusReconnecting: '正在重新连接',
        rowsRead: '行已读取',
        bytesRead: '已读取',
        memory: '内存',
        import: '导入',
        export: '导出',
        refresh: '刷新',
        workspaceInspector: '工作区检查器',
        workspaceBrowser: '工作区浏览器',
        workspacePanels: '更多工作区面板',
        loading: '加载中…',
        schemaPrivate: '架构为私有',
        trustToInspect: '信任此连接后即可查看表和列。',
        readingSchema: '正在读取 ClickHouse 架构…',
        insertTableName: '插入表名',
        rowsEstimated: '估算行数',
        parts: '分区片段',
        projections: '投影',
        skipIndexes: '跳过索引',
        metadataUnavailable: 'ClickHouse 元数据不可用',
        systemTable: 'ClickHouse 系统表',
        clickhouseSql: 'ClickHouse SQL',
        runActions: '运行操作',
        formatSql: '格式化 SQL',
        sqlFlowNativeAst: '原生 AST',
        sqlFlowLogicalMode: '逻辑流程',
        sqlAstClickNode: '选择节点以查看其解析器字段。',
        sqlAstGraphHint: '选择节点查看详情。双击可展开或折叠。',
        sqlAstUnavailable: '此语句没有可用的原生 AST。',
        sqlAstSelectedNode: '已选 AST 节点',
        sqlAstPath: '路径',
        sqlAstChildren: '子节点',
        sqlAstProperties: '属性',
        sqlAstNodes: '个节点',
        sqlAstTruncatedWarning: '此 AST 较大，视图仅显示有限数量的解析器节点。',
        sqlFlowKeywordEstimate: '关键词估算',
        lines: '行',
        sqlFlowTruncatedWarning: '此查询较大，图中仅显示有限数量的 SQL 阶段。',
        sqlFlowFilterKind: '筛选',
        sqlFlowAggregateKind: '聚合',
        sqlFlowSortKind: '排序',
        sqlFlowJoinKind: '联接',
        sqlFlowTransformKind: '转换',
        sqlFlowStageKind: '阶段',
        sqlFlowResizeKind: '调整并行度',
    },
};
