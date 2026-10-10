import type { ExplainAnalyzeEvidence } from '../../shared/explain-analyze';
import type { Copy } from '../i18n';
import { PipelineGraph } from './PipelineGraph';

export function ExplainAnalyzeView({
    evidence,
    loading,
    copy,
}: {
    evidence?: ExplainAnalyzeEvidence;
    loading: boolean;
    copy: Copy['common'];
}) {
    if (loading)
        return (
            <div className="pipeline-graph-empty" role="status">
                {copy.planLoading}
            </div>
        );
    if (!evidence)
        return (
            <div className="pipeline-graph-empty" role="status">
                {copy.runtimeNoOutput}
            </div>
        );

    const metrics = [
        [copy.runtimeTime, evidence.summary.totalTime],
        [copy.runtimePlanning, evidence.summary.planningTime],
        [copy.runtimeExecution, evidence.summary.executionTime],
        [copy.runtimeRowsRead, evidence.summary.readRows],
        [copy.runtimeBytesRead, evidence.summary.readBytes],
        [copy.runtimePeakMemory, evidence.summary.peakMemory],
    ].filter((metric): metric is [string, string] => Boolean(metric[1]));

    return (
        <section className="explain-analyze-view" aria-label={copy.explainAnalyze}>
            {metrics.length > 0 && (
                <div className="runtime-summary-grid" aria-label={copy.runtimeGraph}>
                    {metrics.map(([label, value]) => (
                        <article className="runtime-summary-card" key={label}>
                            <span>{label}</span>
                            <strong>{value}</strong>
                        </article>
                    ))}
                </div>
            )}
            {evidence.pipeline.nodes.length > 0 ? (
                <PipelineGraph
                    pipeline={evidence.pipeline}
                    copy={copy}
                    graphKind="runtime"
                    heading={copy.runtimeGraph}
                    subheading={copy.runtimeGraphDescription}
                />
            ) : (
                <div className="pipeline-graph-empty" role="status">
                    {copy.runtimeNoOutput}
                </div>
            )}
        </section>
    );
}
