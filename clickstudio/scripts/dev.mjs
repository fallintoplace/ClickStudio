import { spawn } from 'node:child_process';
import { createViteDevEnvironment } from './dev-env.mjs';

const children = [
    spawn(process.execPath, ['--import', 'tsx', '--env-file-if-exists=.env', 'server/index.ts'], {
        stdio: 'inherit',
    }),
    spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1'], {
        stdio: 'inherit',
        env: createViteDevEnvironment(),
    }),
];
let closing = false;
function stop(code = 0) {
    if (closing) return;
    closing = true;
    process.exitCode = code;
    for (const child of children) child.kill('SIGTERM');
}
for (const c of children) {
    c.once('error', e => {
        console.error(e.message);
        stop(1);
    });
    c.once('exit', code => stop(code ?? 0));
}
process.once('SIGINT', () => stop());
process.once('SIGTERM', () => stop());
