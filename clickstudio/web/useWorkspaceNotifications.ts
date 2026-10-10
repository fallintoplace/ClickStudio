import { useCallback, useEffect, useRef, useState } from 'react';

export const WORKSPACE_TOAST_TIMEOUT_MS = 10_000;

function useTimedMessage(timeoutMs: number) {
    const [value, setValue] = useState('');
    const timerRef = useRef<number | undefined>(undefined);

    const setMessage = useCallback(
        (message: string) => {
            if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
            timerRef.current = undefined;
            setValue(message);
            if (message) {
                timerRef.current = window.setTimeout(() => {
                    timerRef.current = undefined;
                    setValue('');
                }, timeoutMs);
            }
        },
        [timeoutMs],
    );

    useEffect(
        () => () => {
            if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
        },
        [],
    );

    return [value, setMessage] as const;
}

export function useWorkspaceNotifications() {
    const [error, setError] = useTimedMessage(WORKSPACE_TOAST_TIMEOUT_MS);
    const [notice, setNotice] = useTimedMessage(WORKSPACE_TOAST_TIMEOUT_MS);
    return { error, setError, notice, setNotice };
}
