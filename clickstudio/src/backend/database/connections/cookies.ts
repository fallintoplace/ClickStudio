import { type Config } from '../../system/settings/config.js';

export function cloudSessionCookieOptions(config: Config) {
    return {
        httpOnly: true,
        sameSite: 'strict' as const,
        secure: config.origin.startsWith('https:'),
        path: '/api',
    };
}
