import { useState } from 'react';
import type { Capability } from '../../shared/types';
import { NativeExplorerDialog } from './NativeExplorerDialog';
import { ReplicationExplorer } from './ReplicationExplorer';
import { WorkloadExplorer } from './WorkloadExplorer';

type ObservabilityTab = 'workload' | 'replication';

export function ObservabilityExplorer({
    connectionId,
    connectionLabel,
    trusted,
    queryLog,
    replication,
    onClose,
}: {
    connectionId: string;
    connectionLabel: string;
    trusted: boolean;
    queryLog?: Capability;
    replication?: Capability;
    onClose: () => void;
}) {
    const [tab, setTab] = useState<ObservabilityTab>('workload');
    return (
        <NativeExplorerDialog
            title="Monitoring"
            description={`${connectionLabel} · workload and replication`}
            closeLabel="Close monitoring"
            onClose={onClose}
        >
            <div className="observability-shell">
                <div
                    className="native-tabs observability-tabs"
                    role="tablist"
                    aria-label="Monitoring views"
                >
                    <button
                        id="monitoring-workload-tab"
                        type="button"
                        role="tab"
                        aria-selected={tab === 'workload'}
                        aria-controls="monitoring-workload-panel"
                        onClick={() => setTab('workload')}
                    >
                        Workload
                    </button>
                    <button
                        id="monitoring-replication-tab"
                        type="button"
                        role="tab"
                        aria-selected={tab === 'replication'}
                        aria-controls="monitoring-replication-panel"
                        onClick={() => setTab('replication')}
                    >
                        Replication
                    </button>
                </div>
                {tab === 'workload' ? (
                    <div
                        id="monitoring-workload-panel"
                        className="observability-tabpanel"
                        role="tabpanel"
                        aria-labelledby="monitoring-workload-tab"
                        tabIndex={0}
                    >
                        <WorkloadExplorer
                            connectionId={connectionId}
                            capability={queryLog}
                            trusted={trusted}
                        />
                        <p className="observability-profile-hint">
                            For one query’s call stacks, open its run and choose{' '}
                            <strong>Insights → CPU profile</strong>.
                        </p>
                    </div>
                ) : (
                    <div
                        id="monitoring-replication-panel"
                        className="observability-tabpanel"
                        role="tabpanel"
                        aria-labelledby="monitoring-replication-tab"
                        tabIndex={0}
                    >
                        <ReplicationExplorer
                            connectionId={connectionId}
                            capability={replication}
                            trusted={trusted}
                        />
                    </div>
                )}
            </div>
        </NativeExplorerDialog>
    );
}
