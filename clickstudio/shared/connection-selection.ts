import { PLAYGROUND_CONNECTION_ID } from './playground.js';

export function resolveConnectionSelection(
    connections: readonly { id: string }[],
    current: string,
): string {
    return (
        connections.find(connection => connection.id === current)?.id ??
        connections.find(connection => connection.id === PLAYGROUND_CONNECTION_ID)?.id ??
        connections[0]?.id ??
        ''
    );
}
