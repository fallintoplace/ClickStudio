import { useCallback, useEffect, useRef } from 'react';
import type { Copy, ExperienceLevel } from './i18n';
import type { WorkspacePanelController } from './useWorkspacePanels';
import { useDetachedResultsWindow } from './useDetachedWorkspaceWindow';

export function useDetachedResultsPanel({
    activeName,
    resultsTitle,
    experience,
    panels,
    copy,
    setError,
    setNotice,
}: {
    activeName: string;
    resultsTitle: string;
    experience: ExperienceLevel;
    panels: WorkspacePanelController;
    copy: Copy['common'];
    setError: (message: string) => void;
    setNotice: (message: string) => void;
}) {
    const { detached, open, focus, dock, setTitle } = useDetachedResultsWindow();
    const previousResultsMode = useRef(panels.panelLayout.results.mode);
    const detachedWasOpen = useRef(false);
    const { panelLayout, setPanelLayout, setResultsCollapsed } = panels;

    useEffect(() => {
        if (!detached) {
            if (detachedWasOpen.current) {
                detachedWasOpen.current = false;
                setPanelLayout(current => ({
                    ...current,
                    results: { ...current.results, mode: previousResultsMode.current },
                }));
            }
            return;
        }

        if (!detachedWasOpen.current) {
            detachedWasOpen.current = true;
            window.requestAnimationFrame(() => {
                if (!detached.window.closed) detached.window.focus();
            });
        }
        detached.container.classList.toggle('is-beginner', experience === 'beginner');
        detached.container.classList.toggle('is-expert', experience === 'expert');
        setTitle(`${activeName} · ${resultsTitle}`);
    }, [activeName, detached, experience, resultsTitle, setPanelLayout, setTitle]);

    const openResults = useCallback(() => {
        previousResultsMode.current = panelLayout.results.mode;
        if (!open(`${activeName} · ${resultsTitle}`, experience)) {
            setError(copy.resultsWindowBlocked);
            return;
        }
        setResultsCollapsed(false);
        setPanelLayout(current => ({ ...current, results: { ...current.results, mode: 'docked' } }));
        setNotice(copy.resultsWindowOpened);
    }, [activeName, copy.resultsWindowBlocked, copy.resultsWindowOpened, experience, open, panelLayout.results.mode, resultsTitle, setError, setNotice, setPanelLayout, setResultsCollapsed]);

    const dockResults = useCallback(() => {
        dock();
        setNotice(copy.resultsWindowDocked);
    }, [copy.resultsWindowDocked, dock, setNotice]);
    const closeResults = useCallback(() => dock(), [dock]);

    const focusResults = useCallback(() => {
        if (!focus()) dockResults();
    }, [dockResults, focus]);

    return { detached, openResults, dockResults, closeResults, focusResults };
}
