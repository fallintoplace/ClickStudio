import { useLayoutEffect, useRef, useState } from 'react';
import type { WorkspaceState } from './workspace-state';
import { createWorkspaceWriter, type WorkspaceWriter } from './workspace-persistence';

/** Flush committed edits before a keyed workspace unmount or page suspension. */
export function useWorkspacePersistence(key: string, state: WorkspaceState): string {
    const writer = useRef<WorkspaceWriter | null>(null);
    const [error, setError] = useState('');
    useLayoutEffect(() => {
        let mounted = true;
        const current = createWorkspaceWriter(
            key,
            (k, value) => localStorage.setItem(k, value),
            message => {
                if (mounted) setError(message);
            },
        );
        writer.current = current;
        const flush = () => {
            current.flush();
        };
        const visibility = () => {
            if (document.visibilityState === 'hidden') flush();
        };
        const unload = (event: BeforeUnloadEvent) => {
            if (!current.flush()) {
                event.preventDefault();
                event.returnValue = '';
            }
        };
        window.addEventListener('pagehide', flush);
        window.addEventListener('beforeunload', unload);
        document.addEventListener('visibilitychange', visibility);
        return () => {
            mounted = false;
            current.dispose();
            writer.current = null;
            window.removeEventListener('pagehide', flush);
            window.removeEventListener('beforeunload', unload);
            document.removeEventListener('visibilitychange', visibility);
        };
    }, [key]);
    useLayoutEffect(() => {
        writer.current?.schedule(state);
    }, [state, key]);
    return error;
}
