import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { ExperienceLevel } from './i18n';
import type { EditorHandle } from './components/SqlEditor';
import type { WorkspacePanelController } from './useWorkspacePanels';
import { useDetachedEditorWindow } from './useDetachedWorkspaceWindow';

export function useDetachedQueryEditor({
    activeDraftId,
    activeName,
    experience,
    panels,
    editorRef,
    setError,
}: {
    activeDraftId: string;
    activeName: string;
    experience: ExperienceLevel;
    panels: WorkspacePanelController;
    editorRef: RefObject<EditorHandle | null>;
    setError: (message: string) => void;
}) {
    const { detached, open, focus, dock, setTitle } = useDetachedEditorWindow();
    const detachedWasOpen = useRef(false);
    const { setPanelLayout, revealPanelTemporarily, clearTemporaryPanelReveal } = panels;

    useEffect(() => {
        if (!detached) {
            if (detachedWasOpen.current) {
                detachedWasOpen.current = false;
                clearTemporaryPanelReveal('query');
                setPanelLayout(current => ({
                    ...current,
                    query: { ...current.query, mode: 'docked' },
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
    }, [
        activeName,
        clearTemporaryPanelReveal,
        detached,
        editorRef,
        experience,
        setPanelLayout,
        setTitle,
    ]);

    const openEditor = useCallback(() => {
        if (!open(activeName, experience)) {
            setError('Editor window blocked. Allow pop-ups and try again.');
            return;
        }
        revealPanelTemporarily('query', activeDraftId);
        setPanelLayout(current => ({ ...current, query: { ...current.query, mode: 'docked' } }));
    }, [
        activeDraftId,
        activeName,
        experience,
        open,
        revealPanelTemporarily,
        setError,
        setPanelLayout,
    ]);

    const dockEditor = useCallback(() => dock(), [dock]);
    const closeEditor = useCallback(() => dock(), [dock]);

    const focusEditor = useCallback(() => {
        if (!focus()) {
            dockEditor();
            return;
        }
        window.requestAnimationFrame(() => editorRef.current?.focus());
    }, [dockEditor, editorRef, focus]);

    return { detached, openEditor, dockEditor, closeEditor, focusEditor };
}
