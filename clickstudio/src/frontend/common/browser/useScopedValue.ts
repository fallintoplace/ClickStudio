import { useCallback, useRef, useState } from 'react';

export function useScopedValue<T>(key: string | undefined) {
    const keyRef = useRef(key);
    keyRef.current = key;
    const [scoped, setScoped] = useState<Record<string, T>>({});
    const value = key === undefined ? undefined : scoped[key];
    const setForKey = useCallback(
        (target: string, next: T | ((current: T | undefined) => T), allowInactive = false) => {
            setScoped(current => {
                if (!allowInactive && keyRef.current !== target) return current;
                const previous = current[target];
                const value =
                    typeof next === 'function'
                        ? (next as (current: T | undefined) => T)(previous)
                        : next;
                return { ...current, [target]: value };
            });
        },
        [],
    );
    return [value, setForKey, scoped] as const;
}
