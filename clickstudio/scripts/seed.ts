/** Operator-only setup for the bundled LOCAL ClickHouse server. Never invoked by the web API. */
import { createClient } from '@clickhouse/client';
import { randomUUID } from 'node:crypto';
const env = process.env;
for (const name of ['CLICKHOUSE_ADMIN_PASSWORD', 'CLICKHOUSE_PASSWORD', 'CLICKHOUSE_WRITER_PASSWORD']) {
    if (!env[name] || env[name]!.length < 16)
        throw new Error(`${name} must be set and at least 16 characters long`);
}
const literal = (s: string) => "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
const client = createClient({ url: env.CLICKHOUSE_URL ?? 'http://127.0.0.1:8123', username: env.CLICKHOUSE_ADMIN_USER ?? 'clickstudio_admin', password: env.CLICKHOUSE_ADMIN_PASSWORD, request_timeout: 30000 });
async function command(query: string) { await client.command({ query, query_id: `clickstudio-setup-${randomUUID()}`, abort_signal: AbortSignal.timeout(30000) }); }
try {
    await command('CREATE TABLE IF NOT EXISTS default.events (day Date, events UInt64) ENGINE = MergeTree ORDER BY day');
    await command('CREATE TABLE IF NOT EXISTS default.import_events (day Date, events UInt64) ENGINE = MergeTree ORDER BY day');
    await command("INSERT INTO default.events SELECT toDate('2026-01-01') + toUInt32(number), (number+1)*10 FROM numbers(7) WHERE (SELECT count() FROM default.events) = 0");
    for (const [user, password, profile] of [
        ['clickstudio_reader', env.CLICKHOUSE_PASSWORD!, ' SETTINGS PROFILE clickstudio_reader'],
        ['clickstudio_writer', env.CLICKHOUSE_WRITER_PASSWORD!, ''],
    ]) {
        await command(`CREATE USER IF NOT EXISTS ${user} IDENTIFIED WITH sha256_password BY ${literal(password!)}${profile}`);
        await command(`ALTER USER ${user} IDENTIFIED WITH sha256_password BY ${literal(password!)}${profile}`);
    }
    await command('GRANT SELECT ON default.* TO clickstudio_reader');
    for (const table of ['columns', 'tables', 'databases', 'processes', 'merges', 'mutations', 'view_refreshes'])
        await command(`GRANT SELECT ON system.${table} TO clickstudio_reader`);
    await command('GRANT CREATE TABLE, INSERT ON default.* TO clickstudio_writer');
    // Do not grant global query_log access: it can reveal other users’ SQL. That capability is opt-in.
    console.log('Local tables and reader/writer users configured. No administrator credentials are used by the app.');
}
catch {
    // ClickHouse errors may echo DDL containing a password. Do not print that error or query text.
    console.error('Local database setup failed. Check the server, administrator credentials, and mounted reader profile.');
    process.exitCode = 1;
}
finally {
    await client.close();
}
