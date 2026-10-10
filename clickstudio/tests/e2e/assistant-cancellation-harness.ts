export {};

declare global {
    interface Window {
        assistantCancellationHarness: {
            cancelRequest: (mode: 'ask' | 'repair' | 'run') => Promise<{
                busy: boolean;
                phase: string | undefined;
                statuses: string[];
            }>;
        };
    }
}
