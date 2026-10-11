import type { WorkspaceState } from './workspace-state.js';

export const STORAGE_ERROR =
    'Browser draft storage is unavailable or full. Export your local drafts before closing this page.';
export interface WorkspaceWriter {
    schedule: (state: WorkspaceState) => void;
    flush: () => boolean;
    dispose: () => boolean;
}

/** A failed write stays pending, so a later flush can retry without losing the draft. */
export function createWorkspaceWriter(
    key: string,
    write: (key: string, value: string) => void,
    report: (message: string) => void,
    delay = 150,
): WorkspaceWriter {
    let pending: WorkspaceState | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let saved: string | undefined;
    let disposed = false;
    const cancelTimer = () => {
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
    };
    const flush = () => {
        cancelTimer();
        if (!pending) return true;
        try {
            const value = JSON.stringify(pending);
            if (value !== saved) write(key, value);
            saved = value;
            pending = undefined;
            report('');
            return true;
        } catch {
            report(STORAGE_ERROR);
            return false;
        }
    };
    return {
        schedule(state) {
            if (disposed) return;
            pending = state;
            cancelTimer();
            timer = setTimeout(flush, delay);
        },
        flush,
        dispose() {
            const ok = flush();
            disposed = true;
            return ok;
        },
    };
}
