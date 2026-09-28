import { useCallback, useLayoutEffect, useState } from 'react';
import type { ReactNode, RefCallback } from 'react';

export type ScrollEdges = Readonly<{ top: boolean; bottom: boolean; left: boolean; right: boolean }>;

const NO_EDGES: ScrollEdges = { top: false, bottom: false, left: false, right: false };
const EDGE_NAMES = ['top', 'right', 'bottom', 'left'] as const;

export function useScrollEdges<T extends HTMLElement>() {
    const [viewport, setViewport] = useState<T | null>(null);
    const [edges, setEdges] = useState<ScrollEdges>(NO_EDGES);
    const ref = useCallback((element: T | null) => setViewport(element), []);

    useLayoutEffect(() => {
        if (!viewport) return;

        let frame = 0;
        const measure = () => {
            const next: ScrollEdges = {
                top: viewport.scrollTop > 1,
                bottom: viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop > 1,
                left: viewport.scrollLeft > 1,
                right: viewport.scrollWidth - viewport.clientWidth - viewport.scrollLeft > 1,
            };
            setEdges(current => current.top === next.top && current.bottom === next.bottom && current.left === next.left && current.right === next.right ? current : next);
        };
        const scheduleMeasure = () => {
            if (frame) return;
            frame = requestAnimationFrame(() => {
                frame = 0;
                measure();
            });
        };

        measure();
        viewport.addEventListener('scroll', scheduleMeasure, { passive: true });
        viewport.addEventListener('input', scheduleMeasure);

        const resizeObserver = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(scheduleMeasure);
        const observeChildren = () => {
            for (const child of Array.from(viewport.children)) resizeObserver?.observe(child);
        };
        resizeObserver?.observe(viewport);
        observeChildren();

        const mutationObserver = typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(() => {
            observeChildren();
            scheduleMeasure();
        });
        mutationObserver?.observe(viewport, { childList: true, characterData: true, subtree: true });

        return () => {
            viewport.removeEventListener('scroll', scheduleMeasure);
            viewport.removeEventListener('input', scheduleMeasure);
            resizeObserver?.disconnect();
            mutationObserver?.disconnect();
            if (frame) cancelAnimationFrame(frame);
        };
    }, [viewport]);

    return { ref, edges };
}

export function ScrollEdgeFrame<T extends HTMLElement>({ className, hidden, onViewport, children }: {
    className?: string;
    hidden?: boolean;
    onViewport?: RefCallback<T>;
    children: (ref: RefCallback<T>, edges: ScrollEdges) => ReactNode;
}) {
    const { ref, edges } = useScrollEdges<T>();
    const setViewport = useCallback((element: T | null) => {
        ref(element);
        onViewport?.(element);
    }, [onViewport, ref]);

    return <div className={['scroll-edge-frame', className].filter(Boolean).join(' ')} hidden={hidden}>
        {children(setViewport, edges)}
        <ScrollEdgeShadows edges={edges}/>
    </div>;
}

export function ScrollEdgeShadows({ edges }: { edges: ScrollEdges }) {
    return <div className="scroll-edge-shadows" aria-hidden="true">
        {EDGE_NAMES.map(edge => <span className={`scroll-edge-shadow is-${edge}${edges[edge] ? ' is-visible' : ''}`} key={edge}/>)}
    </div>;
}
