import type {} from '../assistant-cancellation-harness.js';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { useWorkspaceAssistant } from '../../../web/useWorkspaceAssistant.js';
import { newDraft, type WorkspaceState } from '../../../web/workspace-state.js';
import type { Schema } from '../../../shared/types.js';

const active = newDraft('Cancellation regression', 'SELECT 1');
const workspaceRef = {
    current: { version: 1, activeId: active.id, tabs: [active] } as WorkspaceState,
};
const schema: Schema = {
    connectionId: 'assistant-cancellation-test',
    fetchedAt: '2026-10-10T00:00:00.000Z',
    databases: [],
    tables: [],
    columns: [],
    warnings: [],
    truncated: false,
};
let assistant: ReturnType<typeof useWorkspaceAssistant>;

function Harness() {
    const [, setWorkspace] = useState(workspaceRef.current);
    assistant = useWorkspaceAssistant({
        active,
        activeRunId: 'selected-run',
        connectionId: schema.connectionId,
        trusted: true,
        workspaceRef,
        setWorkspace,
    });
    return null;
}

const root = createRoot(document.getElementById('assistant-harness')!);
flushSync(() => root.render(<Harness />));

function snapshot() {
    return {
        busy: assistant.assistantBusy,
        phase: assistant.assistantPhase,
        statuses: assistant.assistantTurns.map(turn => turn.status),
    };
}

async function cancelRequest(mode: 'ask' | 'repair' | 'run') {
    flushSync(() => {
        assistant.setIncludeRun(mode === 'run');
        assistant.changeAssistantQuestion('Explain this query');
    });
    let releaseContext: (() => void) | undefined;
    const context = new Promise<{ evidenceSql: string }>(resolve => {
        releaseContext = () => resolve({ evidenceSql: 'SELECT 1' });
    });
    let request: Promise<void>;
    flushSync(() => {
        request = assistant.requestAssistantSql(
            schema,
            undefined,
            undefined,
            () => context,
            mode === 'repair' ? { repair: { sql: 'SELECT broken()', error: 'Failed' } } : undefined,
        );
        if (mode !== 'run') assistant.cancelAssistantRequest();
    });
    if (mode === 'run') {
        releaseContext?.();
        await Promise.resolve();
        flushSync(() => assistant.cancelAssistantRequest());
    }
    await request!;
    flushSync(() => root.render(<Harness />));
    return snapshot();
}

window.assistantCancellationHarness = { cancelRequest };
