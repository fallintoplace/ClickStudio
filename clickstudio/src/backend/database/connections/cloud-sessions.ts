import type { CloudCredentials } from '../../../shared/database/connections/cloud-requests.js';
import { createHash, randomBytes } from 'node:crypto';
import { requireThat } from '../../system/requests/errors.js';

export const CLOUD_SESSION_COOKIE = 'clickstudio_cloud_session';
export const CLOUD_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export type { CloudCredentials } from '../../../shared/database/connections/cloud-requests.js';
export type CloudProfile = Pick<CloudCredentials, 'host' | 'database' | 'username'>;
export type CloudSessionSnapshot = { profile: CloudProfile; tested: Record<string, unknown> };

type CloudSession = {
    credentials: CloudCredentials;
    tested: Record<string, unknown>;
    expiresAt: number;
};

function tokensFromCookie(cookie?: string) {
    return (
        cookie
            ?.split(';')
            .map(part => part.trim())
            .filter(part => part.startsWith(`${CLOUD_SESSION_COOKIE}=`))
            .map(part => part.slice(CLOUD_SESSION_COOKIE.length + 1))
            .filter(token => /^[A-Za-z0-9_-]{43}$/.test(token)) ?? []
    );
}

function keyFor(token: string) {
    return createHash('sha256').update(token).digest('hex');
}

export class CloudConnectionSessions {
    private readonly sessions = new Map<string, CloudSession>();

    constructor(
        private readonly now: () => number = Date.now,
        private readonly ttlMs = CLOUD_SESSION_TTL_MS,
        private readonly maxSessions = 30,
    ) {}

    private sweep(now = this.now()) {
        for (const [key, session] of this.sessions)
            if (session.expiresAt <= now) this.sessions.delete(key);
    }

    private lookup(cookie?: string) {
        const now = this.now();
        for (const token of tokensFromCookie(cookie)) {
            const key = keyFor(token),
                session = this.sessions.get(key);
            if (!session) continue;
            if (session.expiresAt <= now) {
                this.sessions.delete(key);
                continue;
            }
            session.expiresAt = now + this.ttlMs;
            return { key, session };
        }
        return undefined;
    }

    create(
        credentials: CloudCredentials,
        tested: Record<string, unknown>,
        previousCookie?: string,
    ) {
        const now = this.now();
        this.sweep(now);
        const previousKeys = new Set(tokensFromCookie(previousCookie).map(keyFor));
        const previousSessionCount = [...previousKeys].filter(key => this.sessions.has(key)).length;
        requireThat(
            this.sessions.size - previousSessionCount < this.maxSessions,
            429,
            'CLOUD_SESSION_LIMIT',
            'Too many local Cloud sessions are active. Disconnect another session and retry.',
        );
        for (const key of previousKeys) this.sessions.delete(key);
        const token = randomBytes(32).toString('base64url');
        this.sessions.set(keyFor(token), {
            credentials: { ...credentials },
            tested: structuredClone(tested),
            expiresAt: now + this.ttlMs,
        });
        return token;
    }

    credentials(cookie?: string) {
        const hit = this.lookup(cookie);
        return hit ? { ...hit.session.credentials } : undefined;
    }

    snapshot(cookie?: string): CloudSessionSnapshot | undefined {
        const hit = this.lookup(cookie);
        if (!hit) return undefined;
        const { host, database, username } = hit.session.credentials;
        return {
            profile: { host, database, username },
            tested: structuredClone(hit.session.tested),
        };
    }

    revoke(cookie?: string) {
        for (const token of tokensFromCookie(cookie)) this.sessions.delete(keyFor(token));
    }

    get size() {
        return this.sessions.size;
    }
}
