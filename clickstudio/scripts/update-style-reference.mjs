import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
    const stylesheet = fileURLToPath(
        new URL('../src/frontend/common/styles/main.css', import.meta.url),
    );
    const transformed = await server.transformRequest(`/@fs${stylesheet}`);
    const match = transformed?.code.match(/const __vite__css = ("(?:[^"\\]|\\.)*")/);
    if (!match) throw new Error('Vite did not return the application stylesheet.');
    const css = JSON.parse(match[1]).replace(/\/\*# sourceMappingURL=[\s\S]*?\*\//g, '');
    writeFileSync(
        new URL('../tests/fixtures/styles/reference.css.gz', import.meta.url),
        gzipSync(css, { level: 9 }),
    );
    console.log(
        `Updated style reference (${css.length} bytes). Review the visual report before committing.`,
    );
} finally {
    await server.close();
}
