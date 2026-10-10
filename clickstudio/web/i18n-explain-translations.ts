import type { Copy, Locale } from './i18n-types.js';

export const explainCommonTranslations: Record<
    Exclude<Locale, 'en'>,
    Pick<
        Copy['common'],
        | 'explain'
        | 'explainPlan'
        | 'indexAnalysisGraph'
        | 'indexAnalysisDescription'
        | 'indexAnalysisItem'
        | 'indexAnalysisSelected'
        | 'indexAnalysisInspect'
        | 'indexAnalysisDetails'
        | 'indexAnalysisHint'
        | 'indexAnalysisNoOutput'
        | 'logicalPlan'
        | 'planGraphView'
        | 'planTreeView'
        | 'planGraphHint'
        | 'planStep'
        | 'planSelectedStep'
        | 'planInspectStep'
        | 'planStepDetails'
        | 'planUnknownStep'
        | 'planDepthLimit'
        | 'pipelineGraph'
        | 'pipelineGraphDescription'
        | 'pipelineGraphHint'
        | 'pipelineGraphTruncated'
        | 'pipelineZoomControls'
        | 'pipelineZoomOut'
        | 'pipelineZoomIn'
        | 'pipelineZoomReset'
        | 'pipelineZoomLevel'
        | 'pipelineFocusNode'
        | 'pipelineFit'
        | 'pipelineInputs'
        | 'pipelineOutputs'
        | 'pipelineRunDuration'
        | 'pipelineRunRows'
        | 'pipelineRunBytes'
        | 'planNodeCount'
        | 'planProperties'
        | 'planNoOutput'
        | 'planLoading'
        | 'planTruncated'
        | 'pipelineNoOutput'
        | 'selectedOperator'
        | 'inspectOperator'
        | 'selectedOperatorDetails'
        | 'parallelism'
        | 'plannedStatus'
    >
> = {
    zh: {
        explain: 'EXPLAIN INDEXES',
        explainPlan: 'EXPLAIN PLAN',
        logicalPlan: '逻辑查询计划',
        indexAnalysisGraph: '索引裁剪图',
        indexAnalysisDescription: 'ClickHouse 返回的索引检查及保留的数据分区和粒度。',
        indexAnalysisItem: '索引检查',
        indexAnalysisSelected: '已选索引',
        indexAnalysisInspect: '查看索引',
        indexAnalysisDetails: '所选索引详情',
        indexAnalysisHint: '选择索引以查看条件和裁剪数量。',
        indexAnalysisNoOutput: 'ClickHouse 未返回索引详情。',
        planGraphView: '图',
        planTreeView: '树',
        planGraphHint: '选择步骤以查看其属性。',
        planStep: '步骤',
        planSelectedStep: '已选步骤',
        planInspectStep: '查看步骤',
        planStepDetails: '所选计划步骤详情',
        pipelineGraph: 'ClickHouse 执行管线',
        pipelineGraphDescription: '来自 EXPLAIN PIPELINE 的计划处理器拓扑。运行时数据单独显示。',
        planUnknownStep: '未知步骤',
        planDepthLimit: '已达到计划深度上限',
        pipelineGraphHint: '选择算子以查看详情。',
        pipelineGraphTruncated: '计划较大，图中仅显示有限数量的算子。',
        pipelineZoomControls: '图表视图控件',
        pipelineZoomOut: '缩小',
        pipelineZoomIn: '放大',
        pipelineZoomReset: '重置缩放',
        pipelineZoomLevel: '缩放级别',
        pipelineFocusNode: '聚焦节点',
        pipelineFit: '适配图表',
        pipelineInputs: '输入',
        pipelineOutputs: '输出',
        pipelineRunDuration: '运行时长',
        pipelineRunRows: '运行行数',
        pipelineRunBytes: '运行字节数',
        planNodeCount: '{count} 个步骤',
        planProperties: '属性',
        planNoOutput: 'ClickHouse 未返回 JSON 计划。打开“结果”查看原始输出。',
        planLoading: '正在加载保留的计划…',
        planTruncated: '计划内容较多。为保持视图流畅，部分步骤或详情已隐藏。',
        pipelineNoOutput: '未返回执行管线图。打开“结果”查看原始输出。',
        selectedOperator: '已选算子',
        inspectOperator: '查看算子',
        selectedOperatorDetails: '已选算子详情',
        parallelism: '并行度',
        plannedStatus: '计划中',
    },
};
