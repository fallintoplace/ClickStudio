import type { Principal } from '../../../shared/common/identity.js';
import { requireThat } from '../requests/errors.js';

export function mustOwn(principal: Principal, owner: string) {
    requireThat(principal.id === owner, 404, 'NOT_FOUND', 'Resource not found');
}

export function canWrite(principal: Principal) {
    requireThat(
        principal.role === 'owner',
        403,
        'ROLE_READ_ONLY',
        'This identity cannot change or execute workspace objects',
    );
}
