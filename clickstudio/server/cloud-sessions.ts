import { createHash, randomBytes } from 'node:crypto';
import { requireThat } from '../core/errors.js';

export const CLOUD_SESSION_COOKIE = 'clickstudio_cloud_session';
export const CLOUD_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export type CloudCredentials = { host: string; database: string; username: string; password: string };
export type CloudProfile = Pick<CloudCredentials, 'host' | 'database' | 'username'>;
export type CloudSessionSnapshot = { profile: CloudProfile; tested: Record<string, unknown> };

type CloudSession = {
    credentials: CloudCredentials;
    tested: Record<string, unknown>;
    expiresAt: number;
};

function tokenFromCookie(cookie?: string) {
    const token = cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(`${CLOUD_SESSION_COOKIE}=`))?.slice(CLOUD_SESSION_COOKIE.length + 1);
    return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : undefined;
}

function keyFor(token: string) {
    return createHash('sha256').update(token).digest('hex');
}

export class CloudConnectionSessions {
    private readonly sessions = new Map<string, CloudSession>();

    constructor(private readonly now: () => number = Date.now, private readonly ttlMs = CLOUD_SESSION_TTL_MS, private readonly maxSessions = 30) { }

    private sweep(now = this.now()) {
        for (const [key, session] of this.sessions)
            if (session.expiresAt <= now) this.sessions.delete(key);
    }

    private lookup(cookie?: string) {
        const token = tokenFromCookie(cookie);
        if (!token) return undefined;
        const key = keyFor(token), session = this.sessions.get(key), now = this.now();
        if (!session) return undefined;
        if (session.expiresAt <= now) {
            this.sessions.delete(key);
            return undefined;
        }
        session.expiresAt = now + this.ttlMs;
        return { key, session };
    }

    create(credentials: CloudCredentials, tested: Record<string, unknown>, previousCookie?: string) {
        const now = this.now();
        this.sweep(now);
        const previous = tokenFromCookie(previousCookie), previousKey = previous ? keyFor(previous) : undefined;
        requireThat(this.sessions.size - (previousKey && this.sessions.has(previousKey) ? 1 : 0) < this.maxSessions,
            429, 'CLOUD_SESSION_LIMIT', 'Too many local Cloud sessions are active. Disconnect another session and retry.');
        if (previousKey) this.sessions.delete(previousKey);
        const token = randomBytes(32).toString('base64url');
        this.sessions.set(keyFor(token), { credentials: { ...credentials }, tested: structuredClone(tested), expiresAt: now + this.ttlMs });
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
        return { profile: { host, database, username }, tested: structuredClone(hit.session.tested) };
    }

    revoke(cookie?: string) {
        const token = tokenFromCookie(cookie);
        if (token) this.sessions.delete(keyFor(token));
    }

    get size() { return this.sessions.size; }
}
