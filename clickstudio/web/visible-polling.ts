interface VisiblePollingOptions {
    intervalMs?: number;
    immediate?: boolean;
}

/** Pause hidden-page refreshes and wait for each request before scheduling another. */
export function startVisiblePolling(
    task: (signal: AbortSignal) => Promise<void>,
    { intervalMs, immediate = true }: VisiblePollingOptions = {},
): () => void {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const visible = () => document.visibilityState !== 'hidden';

    function clearTimer() {
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
    }

    function schedule() {
        if (!stopped && visible() && intervalMs !== undefined)
            timer = setTimeout(() => {
                timer = undefined;
                void refresh();
            }, intervalMs);
    }

    async function refresh() {
        if (stopped || !visible() || controller) return;
        const current = new AbortController();
        controller = current;
        try {
            await task(current.signal);
        } catch {
            // Callers report errors. A failed refresh must not stop future polls.
        } finally {
            controller = undefined;
            if (!stopped && visible()) {
                // The page may have become visible before an aborted request settled.
                if (current.signal.aborted) void refresh();
                else schedule();
            }
        }
    }

    function onVisibilityChange() {
        clearTimer();
        if (!visible()) controller?.abort();
        else void refresh();
    }

    document.addEventListener('visibilitychange', onVisibilityChange);
    if (immediate) void refresh();
    else schedule();

    return () => {
        stopped = true;
        clearTimer();
        document.removeEventListener('visibilitychange', onVisibilityChange);
        controller?.abort();
    };
}
