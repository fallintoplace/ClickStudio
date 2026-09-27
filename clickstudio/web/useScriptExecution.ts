import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import type { Script } from '../shared/types';
import { rememberRunIds } from '../shared/workspace-view';
import { api, message } from './api';
import type { Draft } from './workspace-state';

export function useScriptExecution({ scriptId, draftId, updateDraft, setScripts, loadHistory, setError, onComplete }: {
    scriptId?: string;
    draftId: string;
    updateDraft: (id: string, change: (draft: Draft) => Draft) => void;
    setScripts: Dispatch<SetStateAction<Record<string, Script>>>;
    loadHistory: () => Promise<void>;
    setError: (error: string) => void;
    onComplete: (script: Script) => void;
}) {
    const followRef = useRef<{ scriptId: string; enabled: boolean } | undefined>(undefined);

    useEffect(() => {
        if (!scriptId) return;
        if (followRef.current?.scriptId !== scriptId) followRef.current = { scriptId, enabled: true };
        let closed = false;
        let inFlight = false;
        let finished = false;
        let timer = 0;
        const refresh = async () => {
            if (closed || inFlight || finished) return;
            inFlight = true;
            try {
                const next = await api<Script>(`/scripts/${encodeURIComponent(scriptId)}`);
                if (closed) return;
                setScripts(current => ({ ...current, [scriptId]: next }));
                const incomingRunIds = next.statements.flatMap(statement => statement.runId ? [statement.runId] : []);
                const latest = [...next.statements].reverse().find(item => item.runId);
                if (incomingRunIds.length) {
                    updateDraft(draftId, draft => ({
                        ...draft,
                        ...(latest?.runId && followRef.current?.scriptId === scriptId && followRef.current.enabled ? { activeRunId: latest.runId } : {}),
                        runIds: rememberRunIds(draft.runIds, incomingRunIds),
                    }));
                }
                if (next.status !== 'running') {
                    finished = true;
                    window.clearInterval(timer);
                    void loadHistory().catch(() => undefined);
                    onComplete(next);
                }
            } catch (caught) {
                if (!closed) setError(message(caught));
            } finally { inFlight = false; }
        };
        void refresh();
        timer = window.setInterval(() => { void refresh(); }, 900);
        return () => { closed = true; window.clearInterval(timer); };
    }, [draftId, loadHistory, onComplete, scriptId, setError, setScripts, updateDraft]);

    return followRef;
}
