import { useMemo, useState, type SyntheticEvent } from 'react';
import type { ExplainPlan, ExplainPlanNode, ExplainPlanProperty } from '../../shared/explain-plan';
import type { Json, ProfilePipeline, ProfilePipelineNode } from '../../shared/types';
import { PipelineGraph } from './PipelineGraph';
import { ScrollEdgeFrame } from './ScrollEdgeShadows';
import { Icon } from './ui';
import type { Copy } from '../i18n';

const MAX_PROPERTY_TEXT = 12_000;

function propertyCount(value: Json) {
    if (Array.isArray(value)) return value.length.toLocaleString();
    if (value !== null && typeof value === 'object')
        return Object.keys(value).length.toLocaleString();
    return '';
}

function propertyText(value: Json) {
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    return text.length > MAX_PROPERTY_TEXT ? `${text.slice(0, MAX_PROPERTY_TEXT)}\n…` : text;
}

function PlanProperty({ property }: { property: ExplainPlanProperty }) {
    const [open, setOpen] = useState(false);
    const structured = property.value !== null && typeof property.value === 'object';
    const count = structured ? propertyCount(property.value) : '';
    const onToggle = (event: SyntheticEvent<HTMLDetailsElement>) =>
        setOpen(event.currentTarget.open);
    return structured ? (
        <details className="explain-plan-property" onToggle={onToggle}>
            <summary>
                <span>{property.name}</span>
                <small>{count}</small>
            </summary>
            {open && <pre>{propertyText(property.value)}</pre>}
        </details>
    ) : (
        <div className="explain-plan-property is-scalar">
            <span>{property.name}</span>
            <code>{propertyText(property.value)}</code>
        </div>
    );
}

function planNodeType(node: ExplainPlanNode, unknownStep: string, depthLimit: string) {
    switch (node.type) {
        case 'Unknown step':
            return unknownStep;

        case 'Depth limit reached':
            return depthLimit;

        default:
            return node.type;
    }
}

function planGraph(plan: ExplainPlan, unknownStep: string, depthLimit: string) {
    const nodes: ProfilePipelineNode[] = [];
    const edges: ProfilePipeline['edges'] = [];
    const byId = new Map<string, ExplainPlanNode>();
    const visit = (node: ExplainPlanNode, path: number[], parentId?: string) => {
        const id = `plan-${path.join('-')}`;
        nodes.push({
            id,
            label: planNodeType(node, unknownStep, depthLimit),
            kind: 'stage',
            status: 'planned',
        });
        byId.set(id, node);
        if (parentId) edges.push({ source: parentId, target: id });
        node.children.forEach((child, index) => visit(child, [...path, index], id));
    };
    visit(plan.root, [0]);
    const pipeline: ProfilePipeline = {
        available: true,
        source: 'explain_plan',
        nodes,
        edges,
        ...(plan.truncated ? { truncated: true } : {}),
        notice: '',
    };
    return { pipeline, byId };
}

function PlanNode({
    node,
    depth = 0,
    propertyLabel,
    unknownStep,
    depthLimit,
}: {
    node: ExplainPlanNode;
    depth?: number;
    propertyLabel: string;
    unknownStep: string;
    depthLimit: string;
}) {
    const [open, setOpen] = useState(depth < 2);
    const hasContent = Boolean(node.children.length || node.properties.length || node.description);
    const type = planNodeType(node, unknownStep, depthLimit);
    if (!hasContent)
        return (
            <li className="explain-plan-leaf">
                <strong>{type}</strong>
                {node.id && <code>{node.id}</code>}
            </li>
        );
    return (
        <li className="explain-plan-node">
            <details open={open} onToggle={event => setOpen(event.currentTarget.open)}>
                <summary>
                    <span className="explain-plan-step-type">{type}</span>
                    {node.id && <code>{node.id}</code>}
                </summary>
                <div className="explain-plan-node-body">
                    {node.description && <p>{node.description}</p>}
                    {node.properties.length > 0 && (
                        <div className="explain-plan-properties" aria-label={propertyLabel}>
                            <span className="eyebrow">{propertyLabel}</span>
                            {node.properties.map((property, index) => (
                                <PlanProperty
                                    key={`${property.name}-${index}`}
                                    property={property}
                                />
                            ))}
                        </div>
                    )}
                    {node.children.length > 0 && (
                        <ul>
                            {node.children.map((child, index) => (
                                <PlanNode
                                    key={`${child.id ?? child.type}-${index}`}
                                    node={child}
                                    depth={depth + 1}
                                    propertyLabel={propertyLabel}
                                    unknownStep={unknownStep}
                                    depthLimit={depthLimit}
                                />
                            ))}
                        </ul>
                    )}
                </div>
            </details>
        </li>
    );
}

export function ExplainPlanView({
    plan,
    loading,
    copy,
}: {
    plan?: ExplainPlan;
    loading: boolean;
    copy: Copy['common'];
}) {
    const [view, setView] = useState<'graph' | 'tree'>('graph');
    const graph = useMemo(
        () => (plan ? planGraph(plan, copy.planUnknownStep, copy.planDepthLimit) : undefined),
        [plan, copy.planDepthLimit, copy.planUnknownStep],
    );
    if (loading)
        return (
            <div className="pipeline-graph-empty" role="status">
                {copy.planLoading}
            </div>
        );
    if (!plan)
        return (
            <div className="pipeline-graph-empty" role="status">
                {copy.planNoOutput}
            </div>
        );
    return (
        <ScrollEdgeFrame<HTMLDivElement> className="explain-plan-view-frame">
            {ref => (
                <div ref={ref} className="explain-plan-view">
                    <header className="explain-plan-heading">
                        <h3>{copy.logicalPlan}</h3>
                        <div className="explain-plan-heading-actions">
                            <div
                                className="explain-plan-view-switch"
                                role="group"
                                aria-label={copy.logicalPlan}
                            >
                                <button
                                    type="button"
                                    aria-pressed={view === 'graph'}
                                    onClick={() => setView('graph')}
                                >
                                    <Icon name="graph" />
                                    {copy.planGraphView}
                                </button>
                                <button
                                    type="button"
                                    aria-pressed={view === 'tree'}
                                    onClick={() => setView('tree')}
                                >
                                    <Icon name="tree" />
                                    {copy.planTreeView}
                                </button>
                            </div>
                            <strong>
                                {copy.planNodeCount.replace(
                                    '{count}',
                                    plan.nodeCount.toLocaleString(),
                                )}
                            </strong>
                        </div>
                    </header>
                    {plan.truncated && (
                        <p className="pipeline-graph-warning" role="status">
                            {copy.planTruncated}
                        </p>
                    )}
                    {view === 'graph' && graph ? (
                        <PipelineGraph
                            pipeline={graph.pipeline}
                            graphKind="explain-plan"
                            copy={copy}
                            renderSelection={selected => {
                                const node = graph.byId.get(selected.id);
                                if (!node) return null;
                                return (
                                    <div
                                        className="explain-plan-inspection"
                                        aria-label={copy.planStepDetails}
                                    >
                                        {node.id && <code>{node.id}</code>}
                                        {node.description && <p>{node.description}</p>}
                                        {node.properties.length > 0 && (
                                            <div
                                                className="explain-plan-properties"
                                                aria-label={copy.planProperties}
                                            >
                                                <span className="eyebrow">
                                                    {copy.planProperties}
                                                </span>
                                                {node.properties.map((property, index) => (
                                                    <PlanProperty
                                                        key={`${property.name}-${index}`}
                                                        property={property}
                                                    />
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                );
                            }}
                        />
                    ) : (
                        <ul className="explain-plan-tree" aria-label={copy.logicalPlan}>
                            <PlanNode
                                node={plan.root}
                                propertyLabel={copy.planProperties}
                                unknownStep={copy.planUnknownStep}
                                depthLimit={copy.planDepthLimit}
                            />
                        </ul>
                    )}
                </div>
            )}
        </ScrollEdgeFrame>
    );
}
