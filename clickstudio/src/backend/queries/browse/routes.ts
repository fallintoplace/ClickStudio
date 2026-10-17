import type express from 'express';
import type { Driver } from '../../app/types.js';
import type { Principal } from '../../../shared/common/identity.js';
import { BrowseValidationError, parseTableBrowseRequest } from '../../../shared/database/browse/table-browse.js';
import { principal } from '../../system/requests/request-accessors.js';
import { canWrite } from '../../system/login/permissions.js';
import { AppError, requireThat } from '../../system/requests/errors.js';

export function registerTableBrowseRoutes(
    app: ReturnType<typeof express>,
    driver: Driver,
    authorized: (principal: Principal, connectionId: string) => boolean,
) {
    app.post('/api/browse/table', async (req, res, next) => {
        const controller = new AbortController();
        const abort = () => controller.abort();
        res.once('close', abort);
        try {
            const owner = principal(res);
            canWrite(owner);
            const connectionId: unknown = req.body?.connectionId;
            requireThat(typeof connectionId === 'string' && connectionId.length <= 128,
                400, 'BROWSE_CONNECTION', 'Choose a valid connection.');
            requireThat(authorized(owner, connectionId), 403,
                'WORKSPACE_UNTRUSTED', 'Trust this connection before browsing a table.');
            requireThat(driver.browseTable, 409,
                'BROWSE_UNAVAILABLE', 'Table browsing is not available for this connection.');
            const input = parseTableBrowseRequest(req.body);
            res.setHeader('Cache-Control', 'no-store');
            res.json(await driver.browseTable(connectionId, input, controller.signal));
        } catch (error) {
            next(error instanceof BrowseValidationError
                ? new AppError(400, 'BROWSE_INVALID', error.message) : error);
        } finally {
            res.off('close', abort);
        }
    });
}
