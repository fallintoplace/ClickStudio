import { createServer } from 'node:http';
import { loadConfig } from '../system/settings/config.js';
import { startTelemetry } from '../system/logging/telemetry.js';
const config = loadConfig();
const stopTelemetry = await startTelemetry(config.telemetryUrl);
// Reserve the port before recovering persistent runs. A second accidental launch on
// the same port must not mark the first process's active queries as interrupted.
const server = createServer((_req, res) => {
    res.statusCode = 503;
    res.end('Workspace is starting');
});
server.requestTimeout = 140000;
server.headersTimeout = 15000;
try {
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(config.port, config.host, resolve);
    });
    const { createApp } = await import('./app.js');
    const services = createApp(config);
    server.removeAllListeners('request');
    server.on('request', services.app);
    console.log(
        `ClickStudio ${config.demo ? 'FIXTURE MODE' : 'server'} listening on ${config.host}:${config.port}`,
    );
    const sweep = setInterval(() => {
        try {
            services.runs.sweep();
            services.artifacts.sweep();
            services.imports.sweep();
            services.ai.sweep();
        } catch {
            console.error('Retention maintenance failed. Check disk permissions and capacity.');
        }
    }, 60000);
    const scheduler = setInterval(() => {
        void services.monitors.tick().catch(() => console.error('Monitor scheduling failed.'));
    }, 5000);
    let closing = false;
    async function close() {
        if (closing) return;
        closing = true;
        clearInterval(sweep);
        clearInterval(scheduler);
        server.close();
        await services.close();
        server.closeAllConnections();
        await stopTelemetry();
    }
    for (const signal of ['SIGINT', 'SIGTERM'] as const)
        process.once(signal, () => {
            void close().catch(() => {
                process.exitCode = 1;
            });
        });
} catch {
    server.close();
    await stopTelemetry();
    console.error(
        'Startup failed. Check the bind address, port, data directory and configuration.',
    );
    process.exitCode = 1;
}
