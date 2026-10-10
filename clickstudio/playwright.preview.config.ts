import { defineConfig } from '@playwright/test';

const webPort = Number(process.env.CLICKSTUDIO_PREVIEW_WEB_PORT ?? 5178);
const baseURL = `http://127.0.0.1:${webPort}`;

export default defineConfig({
    testDir: './tests/e2e',
    testMatch: 'preview.spec.ts',
    fullyParallel: false,
    workers: 1,
    retries: 0,
    forbidOnly: Boolean(process.env.CI),
    timeout: 45000,
    reporter: [['line'], ['html', { open: 'never' }]],
    use: {
        baseURL,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        storageState: {
            cookies: [],
            origins: [
                {
                    origin: baseURL,
                    localStorage: [{ name: 'clickstudio:experience', value: 'expert' }],
                },
            ],
        },
    },
    webServer: {
        command: `npm run build:preview && npx vite preview --host 127.0.0.1 --port ${webPort} --strictPort`,
        url: baseURL,
        reuseExistingServer: false,
        timeout: 120000,
    },
});
