import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';

for (const mode of ['ask', 'repair', 'run'] as const) {
    test(`Assistant cancellation clears activity before ${mode} context reaches submission`, async ({
        page,
    }) => {
        let submissions = 0;
        await page.route('**/api/assistant/sql', async route => {
            submissions++;
            await route.fulfill({ json: {} });
        });
        await page.goto('/');
        await page.evaluate(() => {
            const container = document.createElement('div');
            container.id = 'assistant-harness';
            document.body.append(container);
        });
        const fixture = fileURLToPath(
            new URL('./fixtures/assistant-cancellation.tsx', import.meta.url),
        );
        await page.addScriptTag({ type: 'module', url: `/@fs${fixture}` });
        await page.waitForFunction(() => Boolean(window.assistantCancellationHarness));
        const state = await page.evaluate(
            mode => window.assistantCancellationHarness.cancelRequest(mode),
            mode,
        );
        expect(state).toEqual({ busy: false, phase: undefined, statuses: ['cancelled'] });
        expect(submissions).toBe(0);
    });
}
