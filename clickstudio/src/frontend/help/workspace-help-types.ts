import type { SchemaTable } from '../../shared/database/schema/types';
import type { Copy, Locale } from '../common/translations/i18n';
import type { SqlExample } from './examples/sql-examples';
import type { Connected } from '../workspace/workspace-types';
import { type RunComparisonProps } from '../workspace/queries/history/RunComparison';
import { type SqlFlowViewProps } from '../workspace/queries/inspection/diagrams/SqlFlowView';
import { type HelpPanelSection } from './workspace-help-model';

export type WorkspaceHelpPanelProps = {
    examples: SqlExample[];
    sourceLabel: string;
    copy: Copy['common'];
    experimentalLabel: string;
    locale: Locale;
    open: boolean;
    section: HelpPanelSection;
    onSectionChange: (section: HelpPanelSection) => void;
    onClose: (restoreFocus?: boolean) => void;
    onOpenExample: (example: SqlExample) => boolean;
    onRunExample: (example: SqlExample, view: 'results' | 'chart' | 'map') => boolean;
    onStartBlankSql: () => boolean;
    onOpenMonitoring: () => void;
    onOpenAssistant: () => void;
    connection: Connected;
    databases?: readonly string[];
    tables: SchemaTable[];
    schemaLoaded: boolean;
    schemaLoading: boolean;
    schemaError: string;
    onRefreshSchema: () => void;
    trusted: boolean;
    queryEngine: SqlFlowViewProps;
    busy: boolean;
    unsupportedParameters: boolean;
    onRunExplain: (kind: 'explain' | 'plan' | 'pipeline' | 'analyze') => void;
    comparison: RunComparisonProps;
    onReferenceInsert: (value: string) => void;
};

export type HelpExplainAction = {
    id: 'indexes' | 'plan' | 'pipeline' | 'analyze';
    label: string;
    description: string;
    disabled: boolean;
    title?: string;
    onSelect: () => void;
};
