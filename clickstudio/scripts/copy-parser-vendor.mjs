import { cpSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const parserVendor = resolve(packageRoot, 'vendor/clickhouse-parser');

if (process.argv[2] === '--web-preview') {
    const assets = resolve(packageRoot, 'dist/frontend/assets');
    const license = resolve(packageRoot, 'dist/frontend/licenses/clickhouse-parser');
    mkdirSync(assets, { recursive: true });
    mkdirSync(license, { recursive: true });
    cpSync(resolve(parserVendor, 'parser.wasm'), resolve(assets, 'clickhouse-parser.wasm'));
    cpSync(resolve(parserVendor, 'LICENSE'), resolve(license, 'LICENSE'));
    cpSync(resolve(parserVendor, 'SOURCE.md'), resolve(license, 'SOURCE.md'));
} else {
    mkdirSync(resolve(packageRoot, 'dist/vendor'), { recursive: true });
    cpSync(parserVendor, resolve(packageRoot, 'dist/vendor/clickhouse-parser'), {
        recursive: true,
        force: true,
    });
}
