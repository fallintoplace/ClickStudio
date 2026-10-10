import type { ProfilePipelineNode } from '../../shared/types';
import type { ExplainIndexAnalysis, ExplainIndexCount } from '../../shared/explain-indexes';
import type { Copy } from '../i18n';
import { PipelineGraph } from './PipelineGraph';

function IndexCount({ label, count }: { label: string; count?: ExplainIndexCount }) {
    if (!count) return null;
    const percent = Math.min(100, Math.max(0, count.percent));
    return (
        <div className="explain-index-metric">
            <span>{label}</span>
            <strong>
                {BigInt(count.selected).toLocaleString()}{' '}
                <small>/ {BigInt(count.total).toLocaleString()}</small>
            </strong>
            <div
                className="explain-index-meter"
                role="meter"
                aria-label={`${label} selected`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
            >
                <span style={{ width: `${percent}%` }} />
            </div>
            <small>{percent}% retained</small>
        </div>
    );
}

function IndexInspection({
    analysis,
    node,
    copy,
}: {
    analysis: ExplainIndexAnalysis;
    node: ProfilePipelineNode;
    copy: Copy['common'];
}) {
    const step = analysis.steps.get(node.id);
    if (!step) return <p className="explain-index-hint">{copy.indexAnalysisHint}</p>;
    const details = step.properties.filter(
        property => !['parts', 'granules'].includes(property.name.toLowerCase()),
    );
    return (
        <div className="explain-index-inspection">
            <div className="explain-index-metrics">
                <IndexCount label="Parts" count={step.parts} />
                <IndexCount label="Granules" count={step.granules} />
            </div>
            {details.length > 0 && (
                <dl className="explain-index-properties">
                    {details.map(({ name, value }, index) => (
                        <div key={`${name}-${index}`}>
                            <dt>{name}</dt>
                            <dd>
                                <code>{value}</code>
                            </dd>
                        </div>
                    ))}
                </dl>
            )}
        </div>
    );
}

export function ExplainIndexesView({
    analysis,
    loading,
    copy,
}: {
    analysis?: ExplainIndexAnalysis;
    loading: boolean;
    copy: Copy['common'];
}) {
    if (loading)
        return (
            <div className="pipeline-graph-empty" role="status">
                {copy.loading}
            </div>
        );
    if (!analysis)
        return (
            <div className="pipeline-graph-empty" role="status">
                {copy.indexAnalysisNoOutput}
            </div>
        );
    return (
        <div className="explain-indexes-view">
            <PipelineGraph
                pipeline={analysis.pipeline}
                graphKind="index-analysis"
                initialSelectedId={analysis.pipeline.nodes.find(node => node.kind === 'filter')?.id}
                copy={copy}
                renderSelection={node => (
                    <IndexInspection analysis={analysis} node={node} copy={copy} />
                )}
            />
        </div>
    );
}
