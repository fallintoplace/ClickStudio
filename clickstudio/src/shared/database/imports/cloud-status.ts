export type CloudImportQueryLogEvent = { type: string };

export type CloudImportQueryLogOutcome = 'finished' | 'exception' | 'started' | 'missing';

export function cloudImportQueryLogOutcome(
    events: readonly CloudImportQueryLogEvent[],
): CloudImportQueryLogOutcome {
    if (events.some(event => event.type === 'QueryFinish')) return 'finished';
    if (events.some(event => event.type.startsWith('Exception'))) return 'exception';
    if (events.some(event => event.type === 'QueryStart')) return 'started';
    return 'missing';
}
