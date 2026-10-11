import { CLICKHOUSE_CLOUD_CONNECTION_ID } from '../../../shared/database/connections/cloud-policy.js';
import type { Principal } from '../../../shared/common/identity.js';

export function assistantConnectionAuthorized(
    authorized: (principal: Principal, connectionId: string) => boolean,
    principal: Principal,
    connectionId: string,
) {
    return connectionId === CLICKHOUSE_CLOUD_CONNECTION_ID
        ? principal.role === 'owner'
        : authorized(principal, connectionId);
}
