import { type CSSProperties } from 'react';
import { GEO_HELP_CITIES, GEO_HELP_EXAMPLE } from './help-demos';
import { geoHueForValue } from '../../workspace/results/maps/geo-color';
import { MonitoringHelpPreview } from './MonitoringHelpPreview';
import { Button, cx } from '../../common/components/ui';
import { Icon } from '../../common/components/icons';
import type { WorkspaceHelpPanelProps } from '../workspace-help-types';
import { HelpSectionHeading } from '../HelpSectionHeading';

const minimumGeoPreviewEvents = Math.min(0, ...GEO_HELP_CITIES.map(city => city.events));
const maximumGeoPreviewEvents = Math.max(0, ...GEO_HELP_CITIES.map(city => city.events));
const geoPreviewMarkerStyle = (city: (typeof GEO_HELP_CITIES)[number]): CSSProperties => {
    const range = maximumGeoPreviewEvents - minimumGeoPreviewEvents;
    const intensity = range === 0 ? 0.5 : (city.events - minimumGeoPreviewEvents) / range;
    return {
        left: `${5 + ((city.longitude + 180) / 360) * 90}%`,
        top: `${7 + ((90 - city.latitude) / 180) * 86}%`,
        '--geo-hue': geoHueForValue(city.events, minimumGeoPreviewEvents, maximumGeoPreviewEvents),
        '--geo-demo-size': `${7 + intensity * 5}px`,
    } as CSSProperties;
};

export function GeoHelpPreview({
    onOpenExample,
    onClose,
    copy,
    onRunExample,
}: Pick<WorkspaceHelpPanelProps, 'onOpenExample' | 'onClose' | 'copy' | 'onRunExample'>) {
    return (
        <div className="workspace-help-geo-demo">
            <div className="workspace-help-geo-preview" aria-hidden="true">
                {GEO_HELP_CITIES.map(city => (
                    <span
                        key={city.city}
                        className={cx(
                            'geo-demo-marker',
                            city.previewLabel && 'has-label',
                            city.previewLabel && `geo-demo-marker-label-${city.previewLabel}`,
                        )}
                        style={geoPreviewMarkerStyle(city)}
                    >
                        {city.previewLabel && (
                            <span className="geo-demo-marker-label">
                                <span>{city.city}</span>
                                <strong>{city.events}</strong>
                            </span>
                        )}
                    </span>
                ))}
            </div>
            <div className="workspace-help-geo-copy">
                <div className="sql-example-option-meta">
                    <span className="sql-example-option-category">Point</span>
                    <span className="sql-example-chart-kind">20 global cities · event volume</span>
                </div>
                <pre>
                    <code>{GEO_HELP_EXAMPLE.sql}</code>
                </pre>
                <div className="sql-example-actions">
                    <Button
                        variant="secondary"
                        className="sql-example-action"
                        data-testid="open-geo-example"
                        onClick={() => {
                            if (onOpenExample(GEO_HELP_EXAMPLE)) onClose(false);
                        }}
                    >
                        <Icon name="plus" />
                        {copy.openExample}
                    </Button>
                    <Button
                        variant="primary"
                        className="sql-example-action"
                        data-testid="run-geo-example"
                        onClick={() => {
                            if (onRunExample(GEO_HELP_EXAMPLE, 'map')) onClose(false);
                        }}
                    >
                        <Icon name="play" />
                        Run map
                    </Button>
                </div>
            </div>
        </div>
    );
}

export function AssistantHelpPreview({
    copy,
    onClose,
    onOpenAssistant,
}: Pick<WorkspaceHelpPanelProps, 'copy' | 'onClose' | 'onOpenAssistant'>) {
    return (
        <>
            <HelpSectionHeading
                eyebrow="AI ASSISTANT"
                title={copy.helpAssistantTitle}
                description={copy.helpAssistantDescription}
            />
            <div className="workspace-help-assistant-scroll">
                <div className="workspace-help-assistant-demo">
                    <header className="workspace-help-assistant-demo-heading">
                        <span className="eyebrow">A QUICK EXAMPLE</span>
                        <span className="workspace-help-assistant-demo-tag">DEMO</span>
                    </header>
                    <div className="workspace-help-assistant-demo-steps">
                        <article>
                            <span className="workspace-help-assistant-step">
                                <b>01</b> ASK
                            </span>
                            <p className="workspace-help-assistant-prompt">
                                {copy.helpAssistantExamplePrompt}
                            </p>
                        </article>
                        <article>
                            <span className="workspace-help-assistant-step">
                                <b>02</b> REVIEW
                            </span>
                            <p>{copy.helpAssistantExampleContext}</p>
                            <small>The preview shows the context gathered for this request.</small>
                        </article>
                        <article>
                            <span className="workspace-help-assistant-step">
                                <b>03</b> PROPOSAL
                            </span>
                            <p>{copy.helpAssistantExampleProposal}</p>
                        </article>
                    </div>
                    <div className="workspace-help-assistant-sql">
                        <span className="eyebrow">EXAMPLE SQL</span>
                        <pre>
                            <code>{copy.helpAssistantExampleSql}</code>
                        </pre>
                    </div>
                    <div className="workspace-help-assistant-footer">
                        <span>Open the assistant to use your current SQL draft.</span>
                        <Button
                            variant="secondary"
                            onClick={() => {
                                onClose(false);
                                onOpenAssistant();
                            }}
                        >
                            <Icon name="assistant" />
                            {copy.helpOpenAssistant}
                        </Button>
                    </div>
                </div>
            </div>
        </>
    );
}

export function MonitoringHelp({
    copy,
    connection,
    trusted,
    onClose,
    onOpenMonitoring,
}: Pick<
    WorkspaceHelpPanelProps,
    'copy' | 'connection' | 'trusted' | 'onClose' | 'onOpenMonitoring'
>) {
    return (
        <>
            <HelpSectionHeading
                eyebrow="CLICKHOUSE MONITORING"
                title={copy.helpMonitoring}
                description={copy.helpMonitoringDescription}
            />
            <div className="workspace-help-guide-scroll">
                <div className="workspace-help-guide-grid">
                    <article className="workspace-help-guide-card">
                        <span className="workspace-help-guide-index">
                            <Icon name="details" />
                        </span>
                        <span className="eyebrow">QUERY LOG</span>
                        <h4>Workload</h4>
                        <p>Explore query history for the current user and local server.</p>
                        <ul>
                            <li>Compare duration with peak memory and rows read.</li>
                            <li>
                                Rank query families by total duration; inspect p50, p95, and p99
                                latency.
                            </li>
                            <li>
                                Review execution counts, read volume, and errors over a selected
                                time window.
                            </li>
                        </ul>
                    </article>
                    <article className="workspace-help-guide-card">
                        <span className="workspace-help-guide-index">
                            <Icon name="database" />
                        </span>
                        <span className="eyebrow">REPLICA STATUS</span>
                        <h4>Replication</h4>
                        <p>
                            Review replica state and queued work reported by the connected server.
                        </p>
                        <ul>
                            <li>
                                Check active replicas, delay, and read-only or expired sessions.
                            </li>
                            <li>
                                Inspect queued inserts and merges, plus errors and postponed tasks.
                            </li>
                            <li>Explore replica rows and the tasks waiting in the queue.</li>
                        </ul>
                    </article>
                </div>
                <MonitoringHelpPreview
                    connectionId={connection.id}
                    workloadSample={!trusted || connection.manifest?.queryLog.available !== true}
                    replicationSample={
                        !trusted || connection.manifest?.replication?.available !== true
                    }
                />
                <div className="workspace-help-monitoring-actions">
                    <Button
                        variant="secondary"
                        onClick={() => {
                            onClose(false);
                            onOpenMonitoring();
                        }}
                    >
                        <Icon name="observability" />
                        {copy.helpOpenMonitoring}
                    </Button>
                </div>
            </div>
        </>
    );
}
