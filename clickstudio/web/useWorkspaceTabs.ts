import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type Dispatch,
    type SetStateAction,
} from 'react';
import { newDraft, type Draft, type WorkspaceState } from './workspace-state';

export function useWorkspaceTabs(
    workspace: WorkspaceState,
    setWorkspace: Dispatch<SetStateAction<WorkspaceState>>,
) {
    const emptyDraft = useRef<Draft | null>(null);
    if (workspace.tabs.length) emptyDraft.current = null;
    const active =
        workspace.tabs.find(tab => tab.id === workspace.activeId) ??
        workspace.tabs[0] ??
        (emptyDraft.current ??= newDraft());
    const tabScrollerRef = useRef<HTMLDivElement>(null);
    const [tabScrollState, setTabScrollState] = useState({
        overflow: false,
        canScrollLeft: false,
        canScrollRight: false,
    });
    const [renamingTabId, setRenamingTabId] = useState<string>();
    const [tabRenameValue, setTabRenameValue] = useState('');
    const cancelTabRenameOnBlur = useRef(false);
    const tabLayoutKey = workspace.tabs.map(tab => `${tab.id}\u0000${tab.name}`).join('\u0001');

    const updateTabScrollState = useCallback(() => {
        const scroller = tabScrollerRef.current;
        if (!scroller) return;
        const maxScrollLeft = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
        const next = {
            overflow: maxScrollLeft > 1,
            canScrollLeft: scroller.scrollLeft > 1,
            canScrollRight: scroller.scrollLeft < maxScrollLeft - 1,
        };
        setTabScrollState(current =>
            current.overflow === next.overflow &&
            current.canScrollLeft === next.canScrollLeft &&
            current.canScrollRight === next.canScrollRight
                ? current
                : next,
        );
    }, []);

    const scrollTabs = useCallback(
        (direction: -1 | 1) => {
            const scroller = tabScrollerRef.current;
            if (!scroller) return;
            const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            scroller.scrollBy({
                left: direction * Math.max(180, scroller.clientWidth * 0.65),
                behavior: reducedMotion ? 'auto' : 'smooth',
            });
            if (reducedMotion) window.requestAnimationFrame(updateTabScrollState);
        },
        [updateTabScrollState],
    );

    const revealActiveTab = useCallback(() => {
        const scroller = tabScrollerRef.current;
        const tab = document.getElementById(`document-tab-${active.id}`);
        if (!scroller || !tab) return;
        const scrollerRect = scroller.getBoundingClientRect();
        const tabRect = tab.getBoundingClientRect();
        if (tabRect.left < scrollerRect.left)
            scroller.scrollBy({ left: tabRect.left - scrollerRect.left - 6 });
        else if (tabRect.right > scrollerRect.right)
            scroller.scrollBy({ left: tabRect.right - scrollerRect.right + 6 });
        updateTabScrollState();
    }, [active.id, updateTabScrollState]);

    useEffect(() => {
        const scroller = tabScrollerRef.current;
        const tabBar = scroller?.parentElement;
        let observedWidth = tabBar?.clientWidth;
        const handleResize = () => {
            updateTabScrollState();
            revealActiveTab();
        };
        const observer =
            tabBar && typeof ResizeObserver !== 'undefined'
                ? new ResizeObserver(() => {
                      updateTabScrollState();
                      const width = tabBar.clientWidth;
                      if (observedWidth !== undefined && width !== observedWidth) revealActiveTab();
                      observedWidth = width;
                  })
                : undefined;
        if (tabBar) observer?.observe(tabBar);
        window.addEventListener('resize', handleResize);
        return () => {
            observer?.disconnect();
            window.removeEventListener('resize', handleResize);
        };
    }, [revealActiveTab, updateTabScrollState]);

    useEffect(() => {
        const frame = window.requestAnimationFrame(updateTabScrollState);
        return () => window.cancelAnimationFrame(frame);
    }, [tabLayoutKey, updateTabScrollState]);

    useEffect(() => {
        const frame = window.requestAnimationFrame(revealActiveTab);
        return () => window.cancelAnimationFrame(frame);
    }, [active.id, active.name, revealActiveTab]);

    const beginTabRename = (draft: WorkspaceState['tabs'][number]) => {
        cancelTabRenameOnBlur.current = false;
        setTabRenameValue(draft.name);
        setRenamingTabId(draft.id);
    };
    const finishTabRename = (
        draftId: string,
        value: string,
        restoreFocus = false,
    ): Draft | undefined => {
        let renamedDraft: Draft | undefined;
        if (cancelTabRenameOnBlur.current) {
            cancelTabRenameOnBlur.current = false;
        } else {
            const name = value.trim();
            const draft = workspace.tabs.find(item => item.id === draftId);
            if (name && draft && draft.name !== name) {
                renamedDraft = { ...draft, name };
                setWorkspace(current => ({
                    ...current,
                    tabs: current.tabs.map(item =>
                        item.id === draftId ? { ...item, name } : item,
                    ),
                }));
            }
        }
        setRenamingTabId(current => (current === draftId ? undefined : current));
        if (restoreFocus)
            window.requestAnimationFrame(() =>
                document.getElementById(`document-tab-${draftId}`)?.focus(),
            );
        return renamedDraft;
    };
    const cancelTabRename = (draftId: string) => {
        cancelTabRenameOnBlur.current = true;
        setRenamingTabId(current => (current === draftId ? undefined : current));
        window.requestAnimationFrame(() =>
            document.getElementById(`document-tab-${draftId}`)?.focus(),
        );
    };

    return {
        active,
        tabScrollerRef,
        tabScrollState,
        updateTabScrollState,
        scrollTabs,
        revealActiveTab,
        renamingTabId,
        tabRenameValue,
        setTabRenameValue,
        beginTabRename,
        finishTabRename,
        cancelTabRename,
    };
}
