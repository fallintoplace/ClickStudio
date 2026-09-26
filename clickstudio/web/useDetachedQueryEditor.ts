import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { Copy, ExperienceLevel } from './i18n';
import type { EditorHandle } from './components/SqlEditor';
import type { WorkspacePanelController } from './useWorkspacePanels';
import { useDetachedEditorWindow } from './useDetachedWorkspaceWindow';

export function useDetachedQueryEditor({
    activeName,
    experience,
    panels,
    editorRef,
    copy,
    setError,
    setNotice,
}: {
    activeName: string;
    experience: ExperienceLevel;
    panels: WorkspacePanelController;
    editorRef: RefObject<EditorHandle | null>;
    copy: Copy['common'];
    setError: (message: string) => void;
    setNotice: (message: string) => void;
}) {
    const { detached, open, focus, dock, setTitle } = useDetachedEditorWindow();
    const previousQueryMode = useRef(panels.panelLayout.query.mode);
    const detachedWasOpen = useRef(false);
    const { panelLayout, setPanelLayout, setQueryCollapsed } = panels;

    useEffect(() => {
        if (!detached) {
            if (detachedWasOpen.current) {
                detachedWasOpen.current = false;
                setPanelLayout(current => ({
                    ...current,
                    query: { ...current.query, mode: previousQueryMode.current },
                }));
                window.requestAnimationFrame(() => editorRef.current?.focus());
            }
            return;
        }

        if (!detachedWasOpen.current) {
            detachedWasOpen.current = true;
            window.requestAnimationFrame(() => {
                if (detached.window.closed) return;
                detached.window.focus();
                editorRef.current?.focus();
            });
        }
        detached.container.classList.toggle('is-beginner', experience === 'beginner');
        detached.container.classList.toggle('is-expert', experience === 'expert');
        setTitle(activeName);
    }, [activeName, detached, editorRef, experience, setPanelLayout, setTitle]);

    const openEditor = useCallback(() => {
        previousQueryMode.current = panelLayout.query.mode;
        if (!open(activeName, experience)) {
            setError(copy.queryWindowBlocked);
            return;
        }
        setQueryCollapsed(false);
        setPanelLayout(current => ({ ...current, query: { ...current.query, mode: 'docked' } }));
        setNotice(copy.queryWindowOpened);
    }, [activeName, copy.queryWindowBlocked, copy.queryWindowOpened, experience, open, panelLayout.query.mode, setError, setNotice, setPanelLayout, setQueryCollapsed]);

    const dockEditor = useCallback(() => {
        dock();
        setNotice(copy.queryWindowDocked);
    }, [copy.queryWindowDocked, dock, setNotice]);

    const focusEditor = useCallback(() => {
        if (!focus()) {
            dockEditor();
            return;
        }
        window.requestAnimationFrame(() => editorRef.current?.focus());
    }, [dockEditor, editorRef, focus]);

    return { detached, openEditor, dockEditor, focusEditor };
}
