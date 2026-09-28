import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import type { SchemaTable } from '../../shared/types';
import type { Copy, Locale } from '../i18n';
import type { SqlExample } from '../sql-examples';
import type { Connected } from '../workspace-types';
import { PLAYGROUND_CONNECTION_ID } from '../playground';
import { GEO_HELP_CITIES, GEO_HELP_EXAMPLE } from '../help-demos';
import { geoHueForValue } from '../geo-color';
import { safeStatementCount } from '../workspace-helpers';
import { MaterializedViewExplorer } from './MaterializedViewExplorer';
import { MergeTreePartsPanel } from './MergeTreePartsPanel';
import { MonitoringHelpPreview } from './MonitoringHelpPreview';
import { OverlayPortal } from './OverlayPortal';
import { ReferenceExplorer } from './ReferenceExplorer';
import { RunComparisonView, type RunComparisonProps } from './RunComparison';
import { SqlFlowView, type SqlFlowViewProps } from './SqlFlowView';
import { Button, Icon, cx } from './ui';
import {
    categoryLabel,
    chartLabel,
    exampleText,
    helpCategories,
    helpSections,
    type CategoryFilter,
    type HelpPanelSection,
} from './workspace-help-model';
export type { HelpPanelSection } from './workspace-help-model';

const minimumGeoPreviewEvents = Math.min(0, ...GEO_HELP_CITIES.map(city => city.events));
const maximumGeoPreviewEvents = Math.max(0, ...GEO_HELP_CITIES.map(city => city.events));
const geoPreviewMarkerStyle = (city: typeof GEO_HELP_CITIES[number]): CSSProperties => {
    const range = maximumGeoPreviewEvents - minimumGeoPreviewEvents;
    const intensity = range === 0 ? .5 : (city.events - minimumGeoPreviewEvents) / range;
    return {
        left: `${5 + ((city.longitude + 180) / 360) * 90}%`,
        top: `${7 + ((90 - city.latitude) / 180) * 86}%`,
        '--geo-hue': geoHueForValue(city.events, minimumGeoPreviewEvents, maximumGeoPreviewEvents),
        '--geo-demo-size': `${7 + intensity * 5}px`,
    } as CSSProperties;
};

export type HelpExplainAction = {
    id: 'indexes' | 'plan' | 'pipeline' | 'analyze';
    label: string;
    description: string;
    disabled: boolean;
    title?: string;
    onSelect: () => void;
};

function HelpSectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
    return <header className="workspace-help-section-heading">
        <span className="eyebrow">{eyebrow}</span>
        <h3>{title}</h3>
        <p>{description}</p>
    </header>;
}

export function WorkspaceHelpPanel({ examples, sourceLabel, copy, locale, open, section, onSectionChange, onClose, onOpenExample, onRunExample, onStartBlankSql, onOpenMonitoring, onOpenAssistant, connection, tables, schemaLoaded, schemaLoading, schemaError, onRefreshSchema, trusted, queryEngine, busy, unsupportedParameters, onRunExplain, comparison, onReferenceInsert }: {
    examples: SqlExample[];
    sourceLabel: string;
    copy: Copy['common'];
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
}) {
    const panelRef = useRef<HTMLElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    const tabRefs = useRef(new Map<HelpPanelSection, HTMLButtonElement>());
    const sectionRef = useRef(section);
    sectionRef.current = section;
    const optionRefs = useRef(new Map<string, HTMLButtonElement>());
    const sections = helpSections(copy);
    const explainDefinitions = [
        { id: 'indexes', kind: 'explain', label: copy.explain, description: copy.helpExplainIndexesDescription, capability: connection.manifest?.explain },
        { id: 'plan', kind: 'plan', label: copy.explainPlan, description: copy.helpExplainPlanDescription, capability: connection.manifest?.explainPlan ?? connection.manifest?.explain },
        { id: 'pipeline', kind: 'pipeline', label: copy.explainPipeline, description: copy.helpExplainPipelineDescription, capability: connection.manifest?.explainPipeline ?? connection.manifest?.pipeline },
        { id: 'analyze', kind: 'analyze', label: copy.explainAnalyze, description: copy.helpExplainAnalyzeDescription, capability: connection.manifest?.explainAnalyze },
    ] as const;
    const explainActions: HelpExplainAction[] = explainDefinitions.map(definition => {
        const unavailableReason = definition.capability?.available === false ? definition.capability.reason : undefined;
        const title = !trusted ? copy.runActionTrustRequired
            : busy ? copy.runActionWait
                : unsupportedParameters ? copy.runActionRemoveParameters
                    : unavailableReason ?? (definition.kind === 'analyze' ? copy.runtimeExecutesQuery : undefined);
        return {
            id: definition.id,
            label: definition.label,
            description: definition.description,
            disabled: !trusted || busy || unsupportedParameters || definition.capability?.available !== true,
            title,
            onSelect: () => onRunExplain(definition.kind),
        };
    });
    const featuredExamples = useMemo(() => examples
        .filter(example => example.featuredOrder !== undefined)
        .sort((left, right) => left.featuredOrder! - right.featuredOrder!), [examples]);
    const defaultExample = featuredExamples[0] ?? examples[0];
    const [search, setSearch] = useState('');
    const [category, setCategory] = useState<CategoryFilter>(featuredExamples.length ? 'featured' : 'all');
    const [selectedId, setSelectedId] = useState(defaultExample?.id ?? '');

    const filteredExamples = useMemo(() => {
        const term = search.trim().toLocaleLowerCase();
        const candidates = category === 'featured' ? featuredExamples : examples;
        return candidates.filter(example => {
            if (category === 'charts' && example.chart.kind === 'table') return false;
            if (category !== 'all' && category !== 'charts' && category !== 'featured' && example.category !== category) return false;
            if (!term) return true;
            const localized = exampleText(example, locale, copy);
            return [example.name, localized.name, example.dataset ?? '', example.description, localized.description, example.sql].join(' ').toLocaleLowerCase().includes(term);
        });
    }, [category, copy, examples, featuredExamples, locale, search]);
    const selected = filteredExamples.find(example => example.id === selectedId) ?? filteredExamples[0];
    const selectedIsScript = selected ? (safeStatementCount(selected.sql) ?? 0) > 1 : false;
    const availableCategories = helpCategories.filter(value => {
        if (value === 'all') return true;
        if (value === 'featured') return featuredExamples.length > 0;
        if (value === 'charts') return examples.some(example => example.chart.kind !== 'table');
        return examples.some(example => example.category === value);
    });
    const visibleTables = tables.some(table => !['system', 'information_schema'].includes(table.database.toLowerCase()));
    const cloudSchemaNotice = connection.dataSource === 'clickhouse' && connection.id !== PLAYGROUND_CONNECTION_ID && trusted && !schemaLoading
        ? schemaError
            ? { message: schemaLoaded ? copy.sqlExamplesSchemaRefreshFailed : copy.sqlExamplesSchemaUnavailable, error: true }
            : schemaLoaded && !visibleTables
                ? { message: copy.sqlExamplesNoTables, error: false }
                : undefined
        : undefined;

    useEffect(() => {
        if (selected && selected.id !== selectedId) setSelectedId(selected.id);
    }, [selected, selectedId]);

    useEffect(() => {
        if (!open) return;
        setSearch('');
        setCategory(featuredExamples.length ? 'featured' : 'all');
        setSelectedId(defaultExample?.id ?? '');

        const previousOverflow = document.body.style.overflow;
        const appRoot = document.getElementById('root');
        const previousInert = appRoot?.inert ?? false;
        document.body.style.overflow = 'hidden';
        if (appRoot) appRoot.inert = true;
        const focusFrame = window.requestAnimationFrame(() => {
            const currentSection = sectionRef.current;
            if (currentSection === 'examples') {
                searchRef.current?.focus();
                return;
            }
            if (currentSection === 'storage') {
                panelRef.current?.querySelector<HTMLElement>('.help-parts-table-picker select:not(:disabled)')?.focus();
                return;
            }
            const activePanel = panelRef.current?.querySelector<HTMLElement>('#workspace-help-panel-' + currentSection);
            const firstAction = activePanel?.querySelector<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])');
            (firstAction ?? tabRefs.current.get(currentSection))?.focus();
        });
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
                return;
            }
            if (event.key !== 'Tab') return;

            const panel = panelRef.current;
            if (!panel) return;
            const focusable = Array.from(panel.querySelectorAll<HTMLElement>(
                'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
            )).filter(element => !element.closest('[hidden]'));
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            const focusIsOutside = !panel.contains(document.activeElement);
            if (!first || !last) {
                event.preventDefault();
                panel.focus();
            } else if (event.shiftKey && (document.activeElement === first || focusIsOutside)) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && (document.activeElement === last || focusIsOutside)) {
                event.preventDefault();
                first.focus();
            }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => {
            window.cancelAnimationFrame(focusFrame);
            document.removeEventListener('keydown', onKeyDown);
            document.body.style.overflow = previousOverflow;
            if (appRoot) appRoot.inert = previousInert;
        };
    }, [defaultExample?.id, featuredExamples.length, open, onClose]);

    const handleTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, current: HelpPanelSection) => {
        const currentIndex = sections.findIndex(item => item.id === current);
        let nextIndex: number | undefined;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % sections.length;
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + sections.length) % sections.length;
        else if (event.key === 'Home') nextIndex = 0;
        else if (event.key === 'End') nextIndex = sections.length - 1;
        if (nextIndex === undefined) return;
        event.preventDefault();
        const next = sections[nextIndex]!.id;
        onSectionChange(next);
        window.requestAnimationFrame(() => tabRefs.current.get(next)?.focus());
    };

    const renderTabPanel = (id: HelpPanelSection, className: string, children: ReactNode) =>
        <div id={'workspace-help-panel-' + id} className={cx('workspace-help-tabpanel', className)} role="tabpanel" aria-labelledby={'workspace-help-tab-' + id} hidden={section !== id}>{children}</div>;

    return <>
        {open && <OverlayPortal><div className="workspace-help-backdrop" onClick={event => {
            if (event.target === event.currentTarget) onClose();
        }}>
            <section ref={panelRef} id="workspace-help-panel" className="workspace-help-panel" role="dialog" aria-modal="true" aria-labelledby="workspace-help-title" tabIndex={-1}>
                <header className="workspace-help-header">
                    <div><span className="eyebrow">{sourceLabel}</span><h2 id="workspace-help-title">{copy.helpCenterTitle}</h2><p>{copy.helpCenterDescription}</p></div>
                    <div className="workspace-help-header-actions">
                        <Button variant="secondary" className="sql-example-blank" data-testid="blank-sql" onClick={() => { if (onStartBlankSql()) onClose(false); }}><Icon name="plus"/>{copy.startBlankSql}</Button>
                        <button type="button" className="workspace-help-close" aria-label={copy.closeHelp} title={copy.closeHelp} onClick={() => onClose()}><Icon name="close"/></button>
                    </div>
                </header>
                <div className="workspace-help-body">
                    <div className="workspace-help-tabs" role="tablist" aria-label={copy.helpPanelSections}>
                        {sections.map(item => <button
                            key={item.id}
                            ref={element => { if (element) tabRefs.current.set(item.id, element); else tabRefs.current.delete(item.id); }}
                            id={'workspace-help-tab-' + item.id}
                            data-testid={'help-section-' + item.id}
                            type="button"
                            role="tab"
                            aria-selected={section === item.id}
                            aria-controls={'workspace-help-panel-' + item.id}
                            tabIndex={section === item.id ? 0 : -1}
                            className={cx('workspace-help-tab', section === item.id && 'is-active')}
                            onClick={() => onSectionChange(item.id)}
                            onKeyDown={event => handleTabKeyDown(event, item.id)}
                        ><Icon name={item.icon}/><span><strong>{item.label}</strong><small>{item.description}</small></span></button>)}
                    </div>
                    <div className="workspace-help-content">
                        {renderTabPanel('tour', 'workspace-help-tour', <>
                            <HelpSectionHeading eyebrow="CLICKSTUDIO TOUR" title={copy.helpTourTitle} description={copy.helpTourDescription}/>
                            <div className="workspace-help-feature-grid">
                                {sections.filter(item => item.id !== 'tour').map(item => <button type="button" key={item.id} className="workspace-help-feature-card" onClick={() => onSectionChange(item.id)}>
                                    <span className="workspace-help-feature-icon"><Icon name={item.icon}/></span>
                                    <span className="workspace-help-feature-copy"><strong>{item.label}</strong><small>{item.description}</small></span>
                                    <span className="workspace-help-feature-arrow">›</span>
                                </button>)}
                            </div>
                        </>)}

                        {renderTabPanel('workflows', 'workspace-help-feature-view workspace-help-workflows', section === 'workflows' ? <>
                            <HelpSectionHeading eyebrow="QUERY WORKFLOW" title={copy.helpQueryWorkflows} description={copy.helpQueryWorkflowsDescription}/>
                            <div className="workspace-help-guide-scroll">
                                <div className="workspace-help-guide-grid">
                                    <article className="workspace-help-guide-card">
                                        <span className="workspace-help-guide-index">01</span>
                                        <span className="eyebrow">PREPARE</span>
                                        <h4>Bind typed values</h4>
                                        <p>Write a ClickHouse parameter such as <code>{'{event_type:String}'}</code>. Its value appears below the editor and is sent separately from the SQL text.</p>
                                    </article>
                                    <article className="workspace-help-guide-card">
                                        <span className="workspace-help-guide-index">02</span>
                                        <span className="eyebrow">FORMAT</span>
                                        <h4>{copy.formatSql}</h4>
                                        <p>With the WASM parser enabled, use the ClickHouse-aware local formatter; Built-in works without it. Formatting changes whitespace and does not run the query.</p>
                                    </article>
                                    <article className="workspace-help-guide-card">
                                        <span className="workspace-help-guide-index">03</span>
                                        <span className="eyebrow">EXECUTE</span>
                                        <h4>{copy.run}</h4>
                                        <p>{copy.run} executes all SQL in the editor and stops after the first error. Select SQL to run only that selection.</p>
                                    </article>
                                    <article className="workspace-help-guide-card">
                                        <span className="workspace-help-guide-index">04</span>
                                        <span className="eyebrow">REVIEW</span>
                                        <h4>{copy.results} and execution status</h4>
                                        <p>Inspect each script statement and its run in Results, then switch to {copy.chart}, SQL map, or {copy.insights} in Experimental mode. Cancel a running query from the execution bar.</p>
                                    </article>
                                </div>
                            </div>
                        </> : null)}

                        {renderTabPanel('assistant', 'workspace-help-feature-view workspace-help-assistant', section === 'assistant' ? <>
                            <HelpSectionHeading eyebrow="AI ASSISTANT" title={copy.helpAssistantTitle} description={copy.helpAssistantDescription}/>
                            <div className="workspace-help-assistant-scroll">
                                <div className="workspace-help-assistant-demo">
                                    <header className="workspace-help-assistant-demo-heading"><span className="eyebrow">A QUICK EXAMPLE</span><span className="workspace-help-assistant-demo-tag">DEMO</span></header>
                                    <div className="workspace-help-assistant-demo-steps">
                                        <article>
                                            <span className="workspace-help-assistant-step"><b>01</b> ASK</span>
                                            <p className="workspace-help-assistant-prompt">{copy.helpAssistantExamplePrompt}</p>
                                        </article>
                                        <article>
                                            <span className="workspace-help-assistant-step"><b>02</b> REVIEW</span>
                                            <p>{copy.helpAssistantExampleContext}</p>
                                            <small>The preview shows the context gathered for this request.</small>
                                        </article>
                                        <article>
                                            <span className="workspace-help-assistant-step"><b>03</b> PROPOSAL</span>
                                            <p>{copy.helpAssistantExampleProposal}</p>
                                        </article>
                                    </div>
                                    <div className="workspace-help-assistant-sql">
                                        <span className="eyebrow">EXAMPLE SQL</span>
                                        <pre><code>{copy.helpAssistantExampleSql}</code></pre>
                                    </div>
                                    <div className="workspace-help-assistant-footer">
                                        <span>Open the assistant to use your current SQL draft.</span>
                                        <Button variant="secondary" onClick={() => { onClose(false); onOpenAssistant(); }}><Icon name="assistant"/>{copy.helpOpenAssistant}</Button>
                                    </div>
                                </div>
                            </div>
                        </> : null)}

                        {renderTabPanel('monitoring', 'workspace-help-feature-view workspace-help-monitoring', section === 'monitoring' ? <>
                            <HelpSectionHeading eyebrow="CLICKHOUSE MONITORING" title={copy.helpMonitoring} description={copy.helpMonitoringDescription}/>
                            <div className="workspace-help-guide-scroll">
                                <div className="workspace-help-guide-grid">
                                    <article className="workspace-help-guide-card">
                                        <span className="workspace-help-guide-index"><Icon name="details"/></span>
                                        <span className="eyebrow">QUERY LOG</span>
                                        <h4>Workload</h4>
                                        <p>Explore query history for the current user and local server.</p>
                                        <ul><li>Compare duration with peak memory and rows read.</li><li>Rank query families by total duration; inspect p50, p95, and p99 latency.</li><li>Review execution counts, read volume, and errors over a selected time window.</li></ul>
                                    </article>
                                    <article className="workspace-help-guide-card">
                                        <span className="workspace-help-guide-index"><Icon name="database"/></span>
                                        <span className="eyebrow">REPLICA STATUS</span>
                                        <h4>Replication</h4>
                                        <p>Review replica state and queued work reported by the connected server.</p>
                                        <ul><li>Check active replicas, delay, and read-only or expired sessions.</li><li>Inspect queued inserts and merges, plus errors and postponed tasks.</li><li>Explore replica rows and the tasks waiting in the queue.</li></ul>
                                    </article>
                                </div>
                                <MonitoringHelpPreview
                                    connectionId={connection.id}
                                    workloadSample={!trusted || connection.manifest?.queryLog.available !== true}
                                    replicationSample={!trusted || connection.manifest?.replication?.available !== true}
                                />
                                <div className="workspace-help-monitoring-actions">
                                    <Button variant="secondary" onClick={() => { onClose(false); onOpenMonitoring(); }}><Icon name="observability"/>{copy.helpOpenMonitoring}</Button>
                                </div>
                            </div>
                        </> : null)}

                        {renderTabPanel('examples', 'workspace-help-examples', section === 'examples' ? <>
                            <div className="sql-examples-toolbar">
                                <div className="sql-example-categories" role="group" aria-label={copy.exampleCategories}>
                                    {availableCategories.map(value => <button key={value} data-testid={'sql-example-category-' + value} type="button" className={cx('sql-example-category', category === value && 'is-active')} aria-pressed={category === value} onClick={() => setCategory(value)}>{categoryLabel(value, copy, locale)}</button>)}
                                </div>
                                <label className="sql-example-search"><Icon name="search"/><input ref={searchRef} data-testid="sql-example-search" type="search" aria-label={copy.searchExamples} placeholder={copy.searchExamples} value={search} onChange={event => {
                                    const value = event.target.value;
                                    setSearch(value);
                                    if (value.trim() && category === 'featured') setCategory('all');
                                }}/></label>
                            </div>
                            {cloudSchemaNotice && <div className={cx('sql-examples-schema-notice', cloudSchemaNotice.error && 'is-error')} role={cloudSchemaNotice.error ? 'alert' : 'status'}>
                                <p>{cloudSchemaNotice.message}</p>
                                <Button variant="ghost" className="toolbar-small" aria-label={copy.sqlExamplesRefreshSchema} title={copy.sqlExamplesRefreshSchema} disabled={schemaLoading} onClick={onRefreshSchema}>{schemaLoading ? copy.loading : copy.refresh}</Button>
                            </div>}
                            {filteredExamples.length === 0 ? <p className="sql-examples-empty" role="status">{copy.noExamplesFound}</p> : <div className="sql-examples-layout">
                                <div className="sql-examples-list" role="listbox" aria-label={copy.sqlExamples}>
                                {filteredExamples.map((example, index) => <button key={example.id} data-testid={'sql-example-' + example.id} ref={element => { if (element) optionRefs.current.set(example.id, element); else optionRefs.current.delete(example.id); }} type="button" role="option" tabIndex={example.id === selected?.id ? 0 : -1} aria-selected={example.id === selected?.id} className={cx('sql-example-option', example.id === selected?.id && 'is-selected')} onFocus={() => setSelectedId(example.id)} onClick={() => setSelectedId(example.id)} onKeyDown={event => {
                                    let nextIndex: number | undefined;
                                    if (event.key === 'ArrowDown') nextIndex = (index + 1) % filteredExamples.length;
                                    else if (event.key === 'ArrowUp') nextIndex = (index - 1 + filteredExamples.length) % filteredExamples.length;
                                    else if (event.key === 'Home') nextIndex = 0;
                                    else if (event.key === 'End') nextIndex = filteredExamples.length - 1;
                                    if (nextIndex === undefined) return;
                                    event.preventDefault();
                                    const nextExample = filteredExamples[nextIndex]!;
                                    setSelectedId(nextExample.id);
                                    optionRefs.current.get(nextExample.id)?.focus();
                                }}>
                                    <span className="sql-example-option-title">{exampleText(example, locale, copy).name}</span>
                                    <span className="sql-example-option-description">{exampleText(example, locale, copy).description}</span>
                                    <span className="sql-example-option-meta">
                                        <span className="sql-example-option-category">{example.dataset ?? categoryLabel(example.category, copy, locale)}</span>
                                        <span className="sql-example-chart-kind">{example.category === 'writeOperations' ? copy.exampleWriteOperations : chartLabel(example, copy)}</span>
                                    </span>
                                </button>)}
                                </div>
                                {selected && <article className="sql-example-preview">
                                <div className="sql-example-preview-heading"><div><span className="eyebrow">{selected.dataset ?? categoryLabel(selected.category, copy, locale)}</span><h3>{exampleText(selected, locale, copy).name}.sql</h3></div><span className="sql-example-readonly">{selected.category === 'writeOperations' ? copy.exampleWriteOperations : chartLabel(selected, copy)}</span></div>
                                <p>{exampleText(selected, locale, copy).description}</p>
                                <pre><code>{selected.sql}</code></pre>
                                <div className="sql-example-actions">
                                    <Button variant="secondary" className="sql-example-action" data-testid="open-sql-example" aria-label={copy.openInNewSql} title={copy.openInNewSql} onClick={() => { if (onOpenExample(selected)) onClose(false); }}><Icon name="plus"/>{copy.openExample}</Button>
                                    <Button variant="primary" className="sql-example-action" data-testid="run-sql-example" onClick={() => { if (onRunExample(selected, 'results')) onClose(false); }}><Icon name="play"/>{selectedIsScript ? copy.runScript : copy.run}</Button>
                                    {!selectedIsScript && selected.category !== 'writeOperations' && <Button variant="secondary" className="sql-example-action" data-testid="chart-sql-example" onClick={() => { if (onRunExample(selected, 'chart')) onClose(false); }}><Icon name="chart"/>{copy.chart}</Button>}
                                </div>
                                </article>}
                            </div>}
                        </> : null)}

                        {renderTabPanel('query', 'workspace-help-feature-view workspace-help-query', section === 'query' ? <>
                            <HelpSectionHeading eyebrow="QUERY ENGINE" title={copy.helpQueryEngine} description={copy.helpQueryEngineDescription}/>
                            <div className="workspace-help-feature-scroll"><SqlFlowView {...queryEngine}/></div>
                        </> : null)}

                        {renderTabPanel('geo', 'workspace-help-feature-view workspace-help-geo', section === 'geo' ? <>
                            <HelpSectionHeading eyebrow="CLICKHOUSE GEO" title={copy.helpGeoTitle} description={copy.helpGeoDescription}/>
                            <div className="workspace-help-geo-demo">
                                <div className="workspace-help-geo-preview" aria-hidden="true">
                                    {GEO_HELP_CITIES.map(city => <span key={city.city} className={cx('geo-demo-marker', city.previewLabel && 'has-label', city.previewLabel && `geo-demo-marker-label-${city.previewLabel}`)} style={geoPreviewMarkerStyle(city)}>
                                        {city.previewLabel && <span className="geo-demo-marker-label"><span>{city.city}</span><strong>{city.events}</strong></span>}
                                    </span>)}
                                </div>
                                <div className="workspace-help-geo-copy">
                                    <div className="sql-example-option-meta"><span className="sql-example-option-category">Point</span><span className="sql-example-chart-kind">20 global cities · event volume</span></div>
                                    <pre><code>{GEO_HELP_EXAMPLE.sql}</code></pre>
                                    <div className="sql-example-actions">
                                        <Button variant="secondary" className="sql-example-action" data-testid="open-geo-example" onClick={() => { if (onOpenExample(GEO_HELP_EXAMPLE)) onClose(false); }}><Icon name="plus"/>{copy.openExample}</Button>
                                        <Button variant="primary" className="sql-example-action" data-testid="run-geo-example" onClick={() => { if (onRunExample(GEO_HELP_EXAMPLE, 'map')) onClose(false); }}><Icon name="play"/>Run map</Button>
                                    </div>
                                </div>
                            </div>
                            <p className="workspace-help-safe-note"><span className="status-light is-trusted"/>Uses native ClickHouse <code>Point</code> values. The map renders the bounded retained result without another SQL request or an external map service.</p>
                        </> : null)}

                        {renderTabPanel('explain', 'workspace-help-feature-view workspace-help-explain', section === 'explain' ? <>
                            <HelpSectionHeading eyebrow="CLICKHOUSE EXPLAIN" title={copy.helpExplain} description={copy.helpExplainDescription}/>
                            <div className="workspace-help-explain-grid">{explainActions.map((action, index) => <button key={action.id} type="button" className="workspace-help-explain-card" disabled={action.disabled} title={action.title ?? action.label} onClick={() => { onClose(false); action.onSelect(); }}>
                                <span className="workspace-help-explain-index">{String(index + 1).padStart(2, '0')}</span>
                                <strong>{action.label}</strong>
                                <p>{action.description}</p>
                                <span>{action.disabled ? action.title ?? 'Unavailable' : copy.run + ' →'}</span>
                            </button>)}</div>
                            <p className="workspace-help-safe-note"><span className="status-light is-warning"/>EXPLAIN ANALYZE executes the selected query to measure runtime. The other EXPLAIN views inspect planning.</p>
                        </> : null)}

                        {renderTabPanel('storage', 'workspace-help-storage', section === 'storage'
                            ? <MergeTreePartsPanel connection={connection} copy={copy} tables={tables} schemaLoading={schemaLoading} trusted={trusted} active={open && section === 'storage'}/>
                            : null)}

                        {renderTabPanel('dependencies', 'workspace-help-feature-view workspace-help-dependencies', section === 'dependencies' ? <>
                            <HelpSectionHeading eyebrow="HOW DATA MOVES" title={copy.helpDependencies} description={copy.helpDependenciesDescription}/>
                            {!trusted ? <div className="workspace-help-locked"><Icon name="lock"/><strong>{copy.schemaPrivate}</strong><p>{copy.trustToInspect}</p></div> : <div className="workspace-help-feature-scroll"><MaterializedViewExplorer embedded active={open && section === 'dependencies'} connection={connection} database={connection.database}/></div>}
                        </> : null)}

                        {renderTabPanel('compare', 'workspace-help-feature-view workspace-help-compare', section === 'compare' ? <>
                            <HelpSectionHeading eyebrow="QUERY EVIDENCE" title={copy.helpCompareRuns} description={copy.helpCompareRunsDescription}/>
                            <div className="workspace-help-feature-scroll"><RunComparisonView {...comparison}/></div>
                        </> : null)}

                        {renderTabPanel('reference', 'workspace-help-feature-view workspace-help-reference', section === 'reference' ? <>
                            <HelpSectionHeading eyebrow="CLICKHOUSE REFERENCE" title={copy.helpReference} description={copy.helpReferenceDescription}/>
                            <div className="workspace-help-feature-scroll"><ReferenceExplorer copy={copy} connection={connection} trusted={trusted} onTargetHandled={() => undefined} onInsert={onReferenceInsert}/></div>
                        </> : null)}
                    </div>
                </div>
            </section>
        </div></OverlayPortal>}
    </>;
}
