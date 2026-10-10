import { Icon } from '../ui';
import { type HelpSectionDefinition } from '../workspace-help-model';
import type { WorkspaceHelpPanelProps } from './workspace-help-types';
import type { HelpExplainAction } from './workspace-help-types';
import { HelpSectionHeading } from './HelpSectionHeading';
import type { Copy } from '../../i18n';

export function HelpTour({
    copy,
    experimentalLabel,
    standardTourSections,
    experimentalTourSections,
    renderTourCard,
}: {
    copy: Copy['common'];
    experimentalLabel: string;
    standardTourSections: HelpSectionDefinition[];
    experimentalTourSections: HelpSectionDefinition[];
    renderTourCard: (item: HelpSectionDefinition) => import('react').ReactElement;
}) {
    return (
        <>
            <HelpSectionHeading
                eyebrow="CLICKSTUDIO TOUR"
                title={copy.helpTourTitle}
                description={copy.helpTourDescription}
            />
            <div className="workspace-help-feature-grid">
                {standardTourSections.map(renderTourCard)}
            </div>
            {experimentalTourSections.length > 0 && (
                <section
                    className="workspace-help-tour-experimental"
                    aria-label={experimentalLabel}
                >
                    <h4 className="workspace-help-tour-experimental-heading">
                        <span className="workspace-help-experimental-label">
                            <Icon name="bolt" />
                            {experimentalLabel}
                        </span>
                    </h4>
                    <div className="workspace-help-feature-grid">
                        {experimentalTourSections.map(renderTourCard)}
                    </div>
                </section>
            )}
        </>
    );
}

export function HelpWorkflows({ copy }: { copy: Copy['common'] }) {
    return (
        <>
            <HelpSectionHeading
                eyebrow="QUERY WORKFLOW"
                title={copy.helpQueryWorkflows}
                description={copy.helpQueryWorkflowsDescription}
            />
            <div className="workspace-help-guide-scroll">
                <div className="workspace-help-guide-grid">
                    <article className="workspace-help-guide-card">
                        <span className="workspace-help-guide-index">01</span>
                        <span className="eyebrow">PREPARE</span>
                        <h4>Bind typed values</h4>
                        <p>
                            Write a ClickHouse parameter such as{' '}
                            <code>{'{event_type:String}'}</code>. Its value appears below the editor
                            and is sent separately from the SQL text.
                        </p>
                    </article>
                    <article className="workspace-help-guide-card">
                        <span className="workspace-help-guide-index">02</span>
                        <span className="eyebrow">FORMAT</span>
                        <h4>{copy.formatSql}</h4>
                        <p>
                            With the WASM parser enabled, use the ClickHouse-aware local formatter;
                            Built-in works without it. Formatting changes whitespace and does not
                            run the query.
                        </p>
                    </article>
                    <article className="workspace-help-guide-card">
                        <span className="workspace-help-guide-index">03</span>
                        <span className="eyebrow">EXECUTE</span>
                        <h4>{copy.run}</h4>
                        <p>
                            {copy.run} executes all SQL in the editor and stops after the first
                            error. Select SQL to run only that selection.
                        </p>
                    </article>
                    <article className="workspace-help-guide-card">
                        <span className="workspace-help-guide-index">04</span>
                        <span className="eyebrow">REVIEW</span>
                        <h4>{copy.results} and execution status</h4>
                        <p>
                            Inspect each script statement and its run in Results, then switch to{' '}
                            {copy.chart}, SQL map, or {copy.insights} in Experimental mode. Cancel a
                            running query from the execution bar.
                        </p>
                    </article>
                </div>
            </div>
        </>
    );
}

export function HelpExplain({
    copy,
    explainActions,
    onClose,
}: {
    copy: Copy['common'];
    explainActions: HelpExplainAction[];
    onClose: WorkspaceHelpPanelProps['onClose'];
}) {
    return (
        <>
            <HelpSectionHeading
                eyebrow="CLICKHOUSE EXPLAIN"
                title={copy.helpExplain}
                description={copy.helpExplainDescription}
            />
            <div className="workspace-help-explain-grid">
                {explainActions.map((action, index) => (
                    <button
                        key={action.id}
                        type="button"
                        className="workspace-help-explain-card"
                        disabled={action.disabled}
                        title={action.title ?? action.label}
                        onClick={() => {
                            onClose(false);
                            action.onSelect();
                        }}
                    >
                        <span className="workspace-help-explain-index">
                            {String(index + 1).padStart(2, '0')}
                        </span>
                        <strong>{action.label}</strong>
                        <p>{action.description}</p>
                        <span>
                            {action.disabled ? (action.title ?? 'Unavailable') : copy.run + ' →'}
                        </span>
                    </button>
                ))}
            </div>
            <p className="workspace-help-safe-note">
                <span className="status-light is-warning" />
                EXPLAIN ANALYZE executes the selected query to measure runtime. The other EXPLAIN
                views inspect planning.
            </p>
        </>
    );
}
