import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { resolve } from 'node:path';
import type { Connection } from '../../../shared/database/connections/types.js';
import type { Limits } from '../../../shared/queries/execution/settings.js';
import {
    PLAYGROUND_CONNECTION,
    PLAYGROUND_CONNECTION_ID,
    PLAYGROUND_URL,
} from '../../../shared/database/connections/playground.js';
import { requireThat } from '../requests/errors.js';
import { identifier, integer, limits, record, text } from '../requests/validation.js';
function isLoopbackHost(host: string) {
    const normalized = host
        .toLowerCase()
        .replace(/^\[|\]$/g, '')
        .replace(/\.$/, '');
    if (normalized === 'localhost' || normalized.endsWith('.localhost')) return true;
    const family = isIP(normalized);
    return family === 4 ? normalized.startsWith('127.') : family === 6 && normalized === '::1';
}
export interface Profile {
    id: string;
    name: string;
    url: string;
    database: string;
    username: string;
    password: string;
    limits: Limits;
    publicPlayground?: boolean;
    writer?: {
        username: string;
        password: string;
    };
}
export interface Config {
    host: string;
    port: number;
    origin: string;
    dataDir: string;
    token?: string;
    demo: boolean;
    profiles: Profile[];
    openaiKey?: string;
    openaiModel?: string;
    openaiRealtimeModel?: string;
    sensitiveColumns: string[];
    telemetryUrl?: string;
    traceUrl?: string;
    production: boolean;
}
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
    const host = env.HOST ?? '127.0.0.1',
        port = integer(
            Number(env.CLICKSTUDIO_API_PORT ?? env.PORT ?? 8080),
            'CLICKSTUDIO_API_PORT',
            1,
            65535,
        );
    const originUrl = new URL(env.APP_ORIGIN ?? 'http://localhost:5173');
    requireThat(
        ['http:', 'https:'].includes(originUrl.protocol),
        400,
        'APP_ORIGIN',
        'APP_ORIGIN must be HTTP(S)',
    );
    const origin = originUrl.origin,
        local = isLoopbackHost(host) && isLoopbackHost(originUrl.hostname),
        token = env.CLICKSTUDIO_TOKEN;
    requireThat(
        local || (typeof token === 'string' && token.length >= 32),
        400,
        'AUTH_REQUIRED',
        'A non-loopback HOST or APP_ORIGIN requires a CLICKSTUDIO_TOKEN of at least 32 characters',
    );
    const getSecret = (key: unknown) => {
        if (key === undefined) return '';
        const name = text(key, 'passwordEnv', 100);
        requireThat(
            /^[A-Z][A-Z0-9_]*$/.test(name),
            400,
            'SECRET_REFERENCE',
            'Invalid environment secret reference',
        );
        return env[name] ?? '';
    };
    const raw: unknown = env.CONNECTIONS_FILE
        ? JSON.parse(readFileSync(resolve(env.CONNECTIONS_FILE), 'utf8'))
        : [
              {
                  id: 'local',
                  name: 'Local ClickHouse',
                  url: env.CLICKHOUSE_URL ?? 'http://127.0.0.1:8123',
                  database: env.CLICKHOUSE_DATABASE ?? 'default',
                  username: env.CLICKHOUSE_USER ?? 'default',
                  passwordEnv: 'CLICKHOUSE_PASSWORD',
                  ...(env.CLICKHOUSE_WRITER_USER && env.CLICKHOUSE_WRITER_PASSWORD
                      ? {
                            writer: {
                                username: env.CLICKHOUSE_WRITER_USER,
                                passwordEnv: 'CLICKHOUSE_WRITER_PASSWORD',
                            },
                        }
                      : {}),
              },
          ];
    requireThat(
        Array.isArray(raw) && raw.length > 0 && raw.length <= 20,
        400,
        'CONNECTIONS_CONFIG',
        'Configure 1–20 connection profiles',
    );
    const profiles = raw.map(value => {
        const v = record(value),
            url = new URL(text(v.url, 'connection URL', 2000));
        requireThat(
            ['http:', 'https:'].includes(url.protocol) &&
                !url.username &&
                !url.password &&
                !url.search &&
                !url.hash &&
                url.pathname === '/',
            400,
            'CONNECTION_URL',
            'Use a root HTTP(S) endpoint; credentials must use environment references',
        );
        const username = text(v.username, 'username', 128);
        requireThat(
            local || username !== 'default',
            400,
            'RESTRICTED_IDENTITY',
            'Shared binding requires a restricted ClickHouse identity, not default',
        );
        const profile: Profile = {
            id: identifier(v.id, 'profile id'),
            name: text(v.name, 'profile name', 128),
            url: url.toString(),
            database: text(v.database, 'database', 128),
            username,
            password: getSecret(v.passwordEnv),
            limits: limits(v.limits),
        };
        if (v.writer !== undefined) {
            const w = record(v.writer);
            const password = getSecret(w.passwordEnv);
            if (password)
                profile.writer = { username: text(w.username, 'writer username', 128), password };
        }
        return profile;
    });
    if (
        local &&
        env.DEMO_MODE !== 'true' &&
        !profiles.some(profile => profile.id === PLAYGROUND_CONNECTION_ID)
    )
        profiles.push({
            id: PLAYGROUND_CONNECTION_ID,
            name: PLAYGROUND_CONNECTION.name,
            url: PLAYGROUND_URL,
            database: PLAYGROUND_CONNECTION.database,
            username: PLAYGROUND_CONNECTION.username,
            password: '',
            limits: limits(PLAYGROUND_CONNECTION.limits),
            publicPlayground: true,
        });
    requireThat(
        new Set(profiles.map(p => p.id)).size === profiles.length,
        400,
        'CONNECTION_IDS',
        'Connection IDs must be unique',
    );
    requireThat(
        env.DEMO_MODE !== 'true' || local,
        400,
        'DEMO_LOCAL_ONLY',
        'Fixture mode is loopback-only',
    );
    return {
        host,
        port,
        origin,
        dataDir: resolve(env.DATA_DIR ?? '.data'),
        token,
        demo: env.DEMO_MODE === 'true',
        profiles,
        openaiKey: env.OPENAI_API_KEY,
        openaiModel: env.OPENAI_MODEL?.trim() || 'gpt-6-luna',
        openaiRealtimeModel: env.OPENAI_REALTIME_MODEL ?? 'gpt-realtime-2.1',
        sensitiveColumns: (env.AI_SENSITIVE_COLUMNS ?? 'password,token,secret,api_key')
            .split(',')
            .map(s => s.trim()),
        telemetryUrl: env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
        traceUrl: env.TRACE_URL_TEMPLATE,
        production: env.NODE_ENV === 'production',
    };
}
export function publicProfile(p: Profile): Connection {
    return {
        dataSource: 'clickhouse',
        id: p.id,
        name: p.name,
        host: new URL(p.url).origin,
        database: p.database,
        username: p.username,
        readonly: true,
        limits: p.limits,
        ...(p.publicPlayground ? { manifest: PLAYGROUND_CONNECTION.manifest } : {}),
    };
}
export function configuredSecrets(config: Config): string[] {
    return [
        config.token,
        config.openaiKey,
        ...config.profiles.flatMap(p => [p.password, p.writer?.password]),
    ].filter((s): s is string => Boolean(s));
}
export function redactor(config: Config) {
    const secrets = configuredSecrets(config);
    return (value: string) => {
        for (const secret of secrets) value = value.split(secret).join('[redacted]');
        return value
            .replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/g, 'https://[redacted]@')
            .slice(0, 3000);
    };
}
