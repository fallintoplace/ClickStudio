import { useCallback, useLayoutEffect, useState } from 'react';

export function useChartPlotWidth() {
    const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
    const [width, setWidth] = useState(0);
    const onViewport = useCallback((element: HTMLDivElement | null) => setViewport(element), []);

    useLayoutEffect(() => {
        if (!viewport) return;
        const measure = () => setWidth(viewport.clientWidth);
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(viewport);
        return () => observer.disconnect();
    }, [viewport]);

    return { width, onViewport };
}
