import type { WorkspaceHelpPanelProps } from './workspace-help-types';
import type { HelpExplainAction } from './workspace-help-types';

export function createHelpExplainActions({
    copy,
    connection,
    trusted,
    busy,
    unsupportedParameters,
    onRunExplain,
}: {
    copy: WorkspaceHelpPanelProps['copy'];
    connection: WorkspaceHelpPanelProps['connection'];
    trusted: WorkspaceHelpPanelProps['trusted'];
    busy: WorkspaceHelpPanelProps['busy'];
    unsupportedParameters: WorkspaceHelpPanelProps['unsupportedParameters'];
    onRunExplain: WorkspaceHelpPanelProps['onRunExplain'];
}) {
    const explainDefinitions = [
        {
            id: 'indexes',
            kind: 'explain',
            label: copy.explain,
            description: copy.helpExplainIndexesDescription,
            capability: connection.manifest?.explain,
        },
        {
            id: 'plan',
            kind: 'plan',
            label: copy.explainPlan,
            description: copy.helpExplainPlanDescription,
            capability: connection.manifest?.explainPlan ?? connection.manifest?.explain,
        },
        {
            id: 'pipeline',
            kind: 'pipeline',
            label: copy.explainPipeline,
            description: copy.helpExplainPipelineDescription,
            capability: connection.manifest?.explainPipeline ?? connection.manifest?.pipeline,
        },
        {
            id: 'analyze',
            kind: 'analyze',
            label: copy.explainAnalyze,
            description: copy.helpExplainAnalyzeDescription,
            capability: connection.manifest?.explainAnalyze,
        },
    ] as const;
    const explainActions: HelpExplainAction[] = explainDefinitions.map(definition => {
        const unavailableReason =
            definition.capability?.available === false ? definition.capability.reason : undefined;
        let title: string | undefined;

        if (!trusted) {
            title = copy.runActionTrustRequired;
        } else if (busy) {
            title = copy.runActionWait;
        } else if (unsupportedParameters) {
            title = copy.runActionRemoveParameters;
        } else {
            title =
                unavailableReason ??
                (definition.kind === 'analyze' ? copy.runtimeExecutesQuery : undefined);
        }
        return {
            id: definition.id,
            label: definition.label,
            description: definition.description,
            disabled:
                !trusted ||
                busy ||
                unsupportedParameters ||
                definition.capability?.available !== true,
            title,
            onSelect: () => onRunExplain(definition.kind),
        };
    });
    return { explainActions };
}
