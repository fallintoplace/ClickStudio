import { useCallback, useEffect, useRef, useState } from 'react';

export type DetachedEditorWindow = Readonly<{
    window: Window;
    container: HTMLDivElement;
}>;

function copyAttributes(source: Element, target: Element) {
    for (const attribute of Array.from(target.attributes)) target.removeAttribute(attribute.name);
    for (const attribute of Array.from(source.attributes)) target.setAttribute(attribute.name, attribute.value);
}

function copyEditorStyles(source: Document, target: Document) {
    target.head.querySelectorAll('[data-clickstudio-editor-style]').forEach(node => node.remove());
    for (const sourceNode of Array.from(source.head.querySelectorAll('style, link[rel~="stylesheet"]'))) {
        const clone = sourceNode.cloneNode(true) as HTMLStyleElement | HTMLLinkElement;
        clone.setAttribute('data-clickstudio-editor-style', '');
        if (clone.tagName === 'LINK') (clone as HTMLLinkElement).href = (sourceNode as HTMLLinkElement).href;
        target.head.append(clone);
    }
}

function prepareEditorWindow(child: Window, title: string, experience: 'beginner' | 'expert'): HTMLDivElement {
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
    copyEditorStyles(source, target);

    copyAttributes(source.documentElement, html);
    copyAttributes(source.body, body);
    body.replaceChildren();
    target.title = title;

    const container = target.createElement('div');
    container.className = 'detached-query-window-root workspace-root';
    container.classList.add(`is-${experience}`);
    container.setAttribute('aria-label', 'Detached SQL editor');
    body.append(container);
    return container;
}

export function useDetachedEditorWindow() {
    const [detached, setDetached] = useState<DetachedEditorWindow | null>(null);
    const detachedWindow = useRef<Window | null>(null);

    const open = useCallback((title: string, experience: 'beginner' | 'expert') => {
        const current = detachedWindow.current;
        if (current && !current.closed) {
            current.focus();
            return true;
        }

        const child = window.open('', 'clickstudio-query-editor', 'popup=yes,width=1280,height=900');
        if (!child) return false;
        try {
            const container = prepareEditorWindow(child, `ClickStudio · ${title}`, experience);
            detachedWindow.current = child;
            setDetached({ window: child, container });
            child.focus();
            return true;
        } catch {
            child.close();
            return false;
        }
    }, []);

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
                copyEditorStyles(document, child.document);
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
