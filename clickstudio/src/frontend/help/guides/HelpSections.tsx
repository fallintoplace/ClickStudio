import { type ReactNode } from 'react';
import type { SqlExample } from '../examples/sql-examples';
import { MaterializedViewExplorer } from '../../database/explorer/objects/MaterializedViewExplorer';
import { MergeTreePartsPanel } from '../../database/explorer/storage/MergeTreePartsPanel';
import { ReferenceExplorer } from '../reference/ReferenceExplorer';
import { RunComparisonView } from '../../workspace/queries/history/RunComparison';
import { SqlFlowView } from '../../workspace/queries/inspection/diagrams/SqlFlowView';
import { Icon } from '../../common/components/icons';
import {
    type HelpSectionDefinition,
    type CategoryFilter,
    type HelpPanelSection,
} from '../workspace-help-model';
import type { WorkspaceHelpPanelProps } from '../workspace-help-types';
import type { HelpExplainAction } from '../workspace-help-types';
import { HelpSectionHeading } from '../HelpSectionHeading';
import { SqlExamplesHelp } from '../examples/SqlExamplesHelp';
import { GeoHelpPreview } from '../previews/HelpFeaturePreviews';
import { AssistantHelpPreview } from '../previews/HelpFeaturePreviews';
import { MonitoringHelp } from '../previews/HelpFeaturePreviews';
import { HelpTour } from './HelpGuides';
import { HelpWorkflows } from './HelpGuides';
import { HelpExplain } from './HelpGuides';

export function HelpSections({
    renderTabPanel,
    standardTourSections,
    renderTourCard,
    experimentalTourSections,
    props,
    availableCategories,
    category,
    setCategory,
    searchRef,
    search,
    setSearch,
    cloudSchemaNotice,
    filteredExamples,
    optionRefs,
    selected,
    setSelectedId,
    selectedIsScript,
    explainActions,
}: {
    renderTabPanel: (
        id: HelpPanelSection,
        className: string,
        children: ReactNode,
    ) => import('react').ReactElement;
    standardTourSections: HelpSectionDefinition[];
    renderTourCard: (item: HelpSectionDefinition) => import('react').ReactElement;
    experimentalTourSections: HelpSectionDefinition[];
    props: WorkspaceHelpPanelProps;
    availableCategories: CategoryFilter[];
    category: CategoryFilter;
    setCategory: import('react').Dispatch<import('react').SetStateAction<CategoryFilter>>;
    searchRef: import('react').RefObject<HTMLInputElement | null>;
    search: string;
    setSearch: import('react').Dispatch<import('react').SetStateAction<string>>;
    cloudSchemaNotice: { message: string; error: boolean } | undefined;
    filteredExamples: SqlExample[];
    optionRefs: import('react').RefObject<Map<string, HTMLButtonElement>>;
    selected: SqlExample | undefined;
    setSelectedId: import('react').Dispatch<import('react').SetStateAction<string>>;
    selectedIsScript: boolean;
    explainActions: HelpExplainAction[];
}) {
    const {
        copy,
        experimentalLabel,
        section,
        queryEngine,
        onClose,
        connection,
        tables,
        schemaLoading,
        trusted,
        open,
        databases = [props.connection.database],
        comparison,
        onReferenceInsert,
    } = props;

    return (
        <div className="workspace-help-content">
            {renderTabPanel(
                'tour',
                'workspace-help-tour',
                <HelpTour
                    {...{
                        copy,
                        experimentalLabel,
                        standardTourSections,
                        experimentalTourSections,
                        renderTourCard,
                    }}
                />,
            )}

            {renderTabPanel(
                'workflows',
                'workspace-help-feature-view workspace-help-workflows',
                section === 'workflows' ? <HelpWorkflows {...{ copy }} /> : null,
            )}

            {renderTabPanel(
                'assistant',
                'workspace-help-feature-view workspace-help-assistant',
                section === 'assistant' ? (
                    <AssistantHelpPreview
                        copy={props.copy}
                        onClose={props.onClose}
                        onOpenAssistant={props.onOpenAssistant}
                    />
                ) : null,
            )}

            {renderTabPanel(
                'monitoring',
                'workspace-help-feature-view workspace-help-monitoring',
                section === 'monitoring' ? (
                    <MonitoringHelp
                        copy={props.copy}
                        connection={props.connection}
                        trusted={props.trusted}
                        onClose={props.onClose}
                        onOpenMonitoring={props.onOpenMonitoring}
                    />
                ) : null,
            )}

            {renderTabPanel(
                'examples',
                'workspace-help-examples',
                section === 'examples' ? (
                    <SqlExamplesHelp
                        {...{
                            availableCategories,
                            category,
                            setCategory,
                            searchRef,
                            search,
                            setSearch,
                            cloudSchemaNotice,
                            filteredExamples,
                            optionRefs,
                            selected,
                            setSelectedId,
                            selectedIsScript,
                            copy: props.copy,
                            locale: props.locale,
                            schemaLoading: props.schemaLoading,
                            onRefreshSchema: props.onRefreshSchema,
                            onOpenExample: props.onOpenExample,
                            onClose: props.onClose,
                            onRunExample: props.onRunExample,
                        }}
                    />
                ) : null,
            )}

            {renderTabPanel(
                'query',
                'workspace-help-feature-view workspace-help-query',
                section === 'query' ? (
                    <>
                        <HelpSectionHeading
                            eyebrow="QUERY ENGINE"
                            title={copy.helpQueryEngine}
                            description={copy.helpQueryEngineDescription}
                        />
                        <div className="workspace-help-feature-scroll">
                            <SqlFlowView {...queryEngine} />
                        </div>
                    </>
                ) : null,
            )}

            {renderTabPanel(
                'geo',
                'workspace-help-feature-view workspace-help-geo',
                section === 'geo' ? (
                    <>
                        <HelpSectionHeading
                            eyebrow="CLICKHOUSE GEO"
                            title={copy.helpGeoTitle}
                            description={copy.helpGeoDescription}
                        />
                        {
                            <GeoHelpPreview
                                onOpenExample={props.onOpenExample}
                                onClose={props.onClose}
                                copy={props.copy}
                                onRunExample={props.onRunExample}
                            />
                        }
                        <p className="workspace-help-safe-note">
                            <span className="status-light is-trusted" />
                            Uses native ClickHouse <code>Point</code> values. The map renders the
                            bounded retained result without another SQL request or an external map
                            service.
                        </p>
                    </>
                ) : null,
            )}

            {renderTabPanel(
                'explain',
                'workspace-help-feature-view workspace-help-explain',
                section === 'explain' ? (
                    <HelpExplain {...{ copy, explainActions, onClose }} />
                ) : null,
            )}

            {renderTabPanel(
                'storage',
                'workspace-help-storage',
                section === 'storage' ? (
                    <MergeTreePartsPanel
                        connection={connection}
                        copy={copy}
                        tables={tables}
                        schemaLoading={schemaLoading}
                        trusted={trusted}
                        active={open && section === 'storage'}
                    />
                ) : null,
            )}

            {renderTabPanel(
                'dependencies',
                'workspace-help-feature-view workspace-help-dependencies',
                section === 'dependencies' ? (
                    <>
                        <HelpSectionHeading
                            eyebrow="HOW DATA MOVES"
                            title={copy.helpDependencies}
                            description={copy.helpDependenciesDescription}
                        />
                        {!trusted ? (
                            <div className="workspace-help-locked">
                                <Icon name="lock" />
                                <strong>{copy.schemaPrivate}</strong>
                                <p>{copy.trustToInspect}</p>
                            </div>
                        ) : (
                            <div className="workspace-help-feature-scroll">
                                <MaterializedViewExplorer
                                    embedded
                                    active={open && section === 'dependencies'}
                                    connection={connection}
                                    database={connection.database}
                                    databases={databases}
                                />
                            </div>
                        )}
                    </>
                ) : null,
            )}

            {renderTabPanel(
                'compare',
                'workspace-help-feature-view workspace-help-compare',
                section === 'compare' ? (
                    <>
                        <HelpSectionHeading
                            eyebrow="QUERY EVIDENCE"
                            title={copy.helpCompareRuns}
                            description={copy.helpCompareRunsDescription}
                        />
                        <div className="workspace-help-feature-scroll">
                            <RunComparisonView {...comparison} />
                        </div>
                    </>
                ) : null,
            )}

            {renderTabPanel(
                'reference',
                'workspace-help-feature-view workspace-help-reference',
                section === 'reference' ? (
                    <>
                        <HelpSectionHeading
                            eyebrow="CLICKHOUSE REFERENCE"
                            title={copy.helpReference}
                            description={copy.helpReferenceDescription}
                        />
                        <div className="workspace-help-feature-scroll">
                            <ReferenceExplorer
                                copy={copy}
                                connection={connection}
                                trusted={trusted}
                                onTargetHandled={() => undefined}
                                onInsert={onReferenceInsert}
                            />
                        </div>
                    </>
                ) : null,
            )}
        </div>
    );
}
