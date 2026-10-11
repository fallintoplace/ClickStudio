import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
const webPort = Number(process.env.CLICKSTUDIO_WEB_PORT ?? 5173);
const apiPort = Number(process.env.CLICKSTUDIO_API_PORT ?? 8080);
export default defineConfig({
    root: fileURLToPath(new URL('./src/frontend/app', import.meta.url)),
    publicDir: fileURLToPath(new URL('./src/frontend/common/assets/public', import.meta.url)),
    plugins: [react(), tailwindcss()],
    server: {
        port: webPort,
        strictPort: true,
        // Match HTTP API URLs without proxying frontend request modules.
        proxy: { '^/api(?:/|$)': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false } },
    },
    build: {
        outDir: fileURLToPath(new URL('./dist/frontend', import.meta.url)),
        emptyOutDir: true,
        target: 'es2022',
    },
});
