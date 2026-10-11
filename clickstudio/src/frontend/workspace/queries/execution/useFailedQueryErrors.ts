import { useState } from 'react';
import type { FailedQueryError } from '../../workspace-helpers';

export function useFailedQueryErrors(activeDraftId: string) {
    const [errors, setErrors] = useState<Record<string, FailedQueryError>>({});
    const clear = (draftId: string) =>
        setErrors(current => {
            const next = { ...current };
            delete next[draftId];
            return next;
        });
    const record = (failure: FailedQueryError) =>
        setErrors(current => ({ ...current, [failure.draftId]: failure }));
    return { error: errors[activeDraftId], clear, record };
}
