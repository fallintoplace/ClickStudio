import {
    useEffect,
    useRef,
    useState,
    type CSSProperties,
    type Dispatch,
    type SetStateAction,
} from 'react';
import {
    WORKSPACE_LAYOUT_STORAGE_KEY,
    clampPanelSplitRatio,
    normalizeWorkspacePanelLayout,
    recoverWorkspacePanelLayout,
    type WorkspacePanelId,
} from '../workspace-layout';

export type PanelPointerStartEvent = {
    clientX: number;
    clientY: number;
    target: EventTarget | null;
    preventDefault: () => void;
    stopPropagation: () => void;
};

const panelViewport = () => ({ width: window.innerWidth, height: window.innerHeight });

export function useWorkspacePanels({
    activeDraftId,
    compactViewport,
    hasOutput,
}: {
    activeDraftId: string;
    compactViewport: boolean;
    hasOutput: boolean;
}) {
    const [panelLayout, setPanelLayout] = useState(() => {
        let stored: string | null = null;
        try {
            stored = window.localStorage.getItem(WORKSPACE_LAYOUT_STORAGE_KEY);
        } catch {}
        return recoverWorkspacePanelLayout(stored, panelViewport());
    });
    const [temporaryReveals, setTemporaryReveals] = useState<
        Partial<Record<WorkspacePanelId, string>>
    >({});
    const workspaceContentRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        try {
            window.localStorage.setItem(WORKSPACE_LAYOUT_STORAGE_KEY, JSON.stringify(panelLayout));
        } catch {}
    }, [panelLayout]);

    useEffect(() => {
        setTemporaryReveals(current => {
            const next = { ...current };
            let changed = false;
            for (const panel of ['query', 'results'] as const) {
                if (next[panel] && next[panel] !== activeDraftId) {
                    delete next[panel];
                    changed = true;
                }
            }
            return changed ? next : current;
        });
    }, [activeDraftId]);

    useEffect(() => {
        const normalize = () =>
            setPanelLayout(current => normalizeWorkspacePanelLayout(current, panelViewport()));
        window.addEventListener('resize', normalize);
        return () => window.removeEventListener('resize', normalize);
    }, []);

    const queryCollapsed = panelLayout.query.collapsed && temporaryReveals.query !== activeDraftId;
    const resultsCollapsed =
        panelLayout.results.collapsed && temporaryReveals.results !== activeDraftId;
    const revealPanelTemporarily = (panel: WorkspacePanelId, draftId = activeDraftId) => {
        setTemporaryReveals(current => ({ ...current, [panel]: draftId }));
    };
    const clearTemporaryPanelReveal = (panel: WorkspacePanelId) => {
        setTemporaryReveals(current =>
            current[panel] === undefined ? current : { ...current, [panel]: undefined },
        );
    };
    const setPanelCollapsed = (panel: WorkspacePanelId, next: SetStateAction<boolean>) => {
        const current = panel === 'query' ? queryCollapsed : resultsCollapsed;
        const collapsed = typeof next === 'function' ? next(current) : next;
        setPanelLayout(layout => ({ ...layout, [panel]: { ...layout[panel], collapsed } }));
        clearTemporaryPanelReveal(panel);
    };
    const setQueryCollapsed: Dispatch<SetStateAction<boolean>> = next =>
        setPanelCollapsed('query', next);
    const setResultsCollapsed: Dispatch<SetStateAction<boolean>> = next =>
        setPanelCollapsed('results', next);
    const canSplitPanels = Boolean(
        hasOutput && !queryCollapsed && !resultsCollapsed && !compactViewport,
    );
    const workspaceLayoutStyle = canSplitPanels
        ? ({ '--query-panel-basis': `${panelLayout.splitRatio * 100}%` } as CSSProperties)
        : undefined;
    const startPanelSplit = (event: PanelPointerStartEvent) => {
        const content = workspaceContentRef.current;
        if (!content || !canSplitPanels) return;
        event.preventDefault();
        event.stopPropagation();
        const rect = content.getBoundingClientRect();
        const computed = getComputedStyle(content);
        const paddingTop = Number.parseFloat(computed.paddingTop) || 0;
        const paddingBottom = Number.parseFloat(computed.paddingBottom) || 0;
        const top = rect.top + paddingTop;
        const usableHeight = Math.max(1, rect.height - paddingTop - paddingBottom);
        let latest = panelLayout.splitRatio;
        document.body.classList.add('is-workspace-panel-gesturing');
        const move = (pointer: PointerEvent) => {
            latest = clampPanelSplitRatio((pointer.clientY - top) / usableHeight);
            content.style.setProperty('--query-panel-basis', `${latest * 100}%`);
        };
        const stop = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', stop);
            window.removeEventListener('pointercancel', stop);
            document.body.classList.remove('is-workspace-panel-gesturing');
            setPanelLayout(current => ({ ...current, splitRatio: latest }));
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', stop);
        window.addEventListener('pointercancel', stop);
    };

    return {
        compactViewport,
        queryCollapsed,
        setQueryCollapsed,
        resultsCollapsed,
        setResultsCollapsed,
        revealPanelTemporarily,
        clearTemporaryPanelReveal,
        panelLayout,
        setPanelLayout,
        workspaceContentRef,
        canSplitPanels,
        workspaceLayoutStyle,
        startPanelSplit,
    };
}

export type WorkspacePanelController = ReturnType<typeof useWorkspacePanels>;
