import { useCallback, useEffect, useRef, useState } from 'react';

export type DetachedWorkspaceWindow = Readonly<{
    window: Window;
    container: HTMLDivElement;
}>;

function copyAttributes(source: Element, target: Element) {
    for (const attribute of Array.from(target.attributes)) target.removeAttribute(attribute.name);
    for (const attribute of Array.from(source.attributes)) target.setAttribute(attribute.name, attribute.value);
}

function copyWorkspaceStyles(source: Document, target: Document) {
    target.head.querySelectorAll('[data-clickstudio-detached-style]').forEach(node => node.remove());
    for (const sourceNode of Array.from(source.head.querySelectorAll('style, link[rel~="stylesheet"]'))) {
        const clone = sourceNode.cloneNode(true) as HTMLStyleElement | HTMLLinkElement;
        clone.setAttribute('data-clickstudio-detached-style', '');
        if (clone.tagName === 'LINK') (clone as HTMLLinkElement).href = (sourceNode as HTMLLinkElement).href;
        target.head.append(clone);
    }
}

function prepareWorkspaceWindow(child: Window, title: string, experience: 'beginner' | 'expert', rootClassName: string, label: string): HTMLDivElement {
    const source = document;
    const target = child.document;
    const html = target.documentElement;
    const head = target.head ?? html.appendChild(target.createElement('head'));
    const body = target.body ?? html.appendChild(target.createElement('body'));

    target.head.replaceChildren();
    for (const meta of Array.from(source.head.querySelectorAll('meta'))) head.append(meta.cloneNode(true));
    const base = target.createElement('base');
    base.setAttribute('data-clickstudio-editor-base', '');
    base.href = source.baseURI;
    head.prepend(base);
    copyWorkspaceStyles(source, target);

    copyAttributes(source.documentElement, html);
    copyAttributes(source.body, body);
    body.replaceChildren();
    target.title = title;

    const container = target.createElement('div');
    container.className = rootClassName;
    container.classList.add(`is-${experience}`);
    container.setAttribute('aria-label', label);
    body.append(container);
    return container;
}

function useDetachedWorkspaceWindow(windowName: string, rootClassName: string, label: string) {
    const [detached, setDetached] = useState<DetachedWorkspaceWindow | null>(null);
    const detachedWindow = useRef<Window | null>(null);

    const open = useCallback((title: string, experience: 'beginner' | 'expert') => {
        const current = detachedWindow.current;
        if (current && !current.closed) {
            current.focus();
            return true;
        }

        const child = window.open('', windowName, 'popup=yes,width=1280,height=900');
        if (!child) return false;
        try {
            const container = prepareWorkspaceWindow(child, `ClickStudio · ${title}`, experience, rootClassName, label);
            detachedWindow.current = child;
            setDetached({ window: child, container });
            child.focus();
            return true;
        } catch {
            child.close();
            return false;
        }
    }, [label, rootClassName, windowName]);

    const focus = useCallback(() => {
        const child = detachedWindow.current;
        if (!child || child.closed) return false;
        child.focus();
        return true;
    }, []);

    const dock = useCallback(() => {
        const child = detachedWindow.current;
        detachedWindow.current = null;
        setDetached(null);
        window.requestAnimationFrame(() => {
            if (child && !child.closed) child.close();
        });
    }, []);

    const setTitle = useCallback((title: string) => {
        const child = detachedWindow.current;
        if (!child || child.closed) return;
        try { child.document.title = `ClickStudio · ${title}`; } catch {}
    }, []);

    useEffect(() => {
        if (!detached) return;
        const child = detached.window;
        const syncDocument = () => {
            if (child.closed) return;
            try {
                copyAttributes(document.documentElement, child.document.documentElement);
                copyAttributes(document.body, child.document.body);
                copyWorkspaceStyles(document, child.document);
            } catch {}
        };
        const observer = new MutationObserver(syncDocument);
        observer.observe(document.documentElement, { attributes: true });
        observer.observe(document.body, { attributes: true });
        observer.observe(document.head, { attributes: true, characterData: true, childList: true, subtree: true });
        const interval = window.setInterval(() => {
            if (child.closed) {
                detachedWindow.current = null;
                setDetached(current => current?.window === child ? null : current);
            }
        }, 300);
        return () => {
            observer.disconnect();
            window.clearInterval(interval);
        };
    }, [detached]);

    useEffect(() => () => {
        const child = detachedWindow.current;
        detachedWindow.current = null;
        if (child && !child.closed) child.close();
    }, []);

    return { detached, open, focus, dock, setTitle };
}

export function useDetachedEditorWindow() {
    return useDetachedWorkspaceWindow('clickstudio-query-editor', 'detached-query-window-root workspace-root', 'Detached SQL editor');
}
