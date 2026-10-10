import { isFrontendDemoPreview } from './api';
import {
    DEMO_PREVIEW_INITIAL_STARTERS,
    DEMO_PREVIEW_SQL,
    DEMO_PREVIEW_STARTER_DOCUMENT_ID,
    PLAYGROUND_PREVIEW_STARTER,
    demoPreviewStarterRunId,
} from './demo-preview';
import { newDraft, recover, SAMPLE_SQL, type WorkspaceState } from './workspace-state';

export const workspaceStateKey = (connectionId: string) =>
    `clickstudio:workspace:${connectionId}:v1`;

function previewStarterDraft(starter: (typeof DEMO_PREVIEW_INITIAL_STARTERS)[number]) {
    const runId = demoPreviewStarterRunId(starter.id);
    return {
        ...newDraft(starter.name, starter.sql),
        serverId: starter.id,
        baseRevision: starter.revision ?? 1,
        chart: { ...starter.chart, ys: [...starter.chart.ys] },
        runIds: [runId],
        activeRunId: runId,
    };
}

export function initialWorkspaceState(connectionId: string): WorkspaceState {
    const recovered = recover(workspaceStateKey(connectionId));
    if (!isFrontendDemoPreview) return recovered;
    if (!recovered.tabs.length) return recovered;
    const activeId =
        recovered.tabs.find(tab => tab.id === recovered.activeId)?.id ?? recovered.tabs[0]!.id;
    const active = recovered.tabs.find(tab => tab.id === activeId)!;
    const isStarterDraft =
        active.name === 'Getting started.sql' &&
        (active.sql.trim() === SAMPLE_SQL.trim() ||
            active.sql.trim() === DEMO_PREVIEW_SQL.trim()) &&
        (!active.serverId || active.serverId === DEMO_PREVIEW_STARTER_DOCUMENT_ID);
    if (!isStarterDraft || recovered.tabs.length !== 1 || recovered.closedTabs?.length)
        return recovered;

    if (connectionId === 'playground') {
        return {
            ...recovered,
            tabs: [
                {
                    ...active,
                    name: PLAYGROUND_PREVIEW_STARTER.name,
                    sql: PLAYGROUND_PREVIEW_STARTER.sql,
                    serverId: undefined,
                    baseRevision: undefined,
                    chart: { ...PLAYGROUND_PREVIEW_STARTER.chart, ys: [] },
                    runIds: [],
                    activeRunId: undefined,
                    scriptId: undefined,
                    parentRunId: undefined,
                    parentDocumentId: undefined,
                    kind: 'query',
                    metric: undefined,
                    dependencies: [],
                },
            ],
        };
    }

    const gettingStarted = DEMO_PREVIEW_INITIAL_STARTERS[0]!;
    const runId = demoPreviewStarterRunId(gettingStarted.id);
    return {
        ...recovered,
        tabs: [
            {
                ...active,
                sql: DEMO_PREVIEW_SQL,
                serverId: DEMO_PREVIEW_STARTER_DOCUMENT_ID,
                baseRevision: gettingStarted.revision ?? 1,
                chart: { ...gettingStarted.chart, ys: [...gettingStarted.chart.ys] },
                activeRunId: runId,
                runIds: [...new Set([...active.runIds, runId])],
            },
            ...DEMO_PREVIEW_INITIAL_STARTERS.slice(1).map(previewStarterDraft),
        ],
    };
}
