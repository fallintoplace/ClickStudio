import test from 'node:test';
import assert from 'node:assert/strict';
import { createViteDevEnvironment } from '../../scripts/dev-env.mjs';

for (const inheritedValue of ['true', 'false', undefined]) {
    test(`local Vite startup disables preview mode when VITE_DEMO_MODE is ${inheritedValue ?? 'unset'}`, () => {
        const environment = createViteDevEnvironment({
            VITE_DEMO_MODE: inheritedValue,
            CLICKSTUDIO_WEB_PORT: '5173',
        });

        assert.equal(environment.VITE_DEMO_MODE, 'false');
        assert.equal(environment.CLICKSTUDIO_WEB_PORT, '5173');
    });
}

test('local Vite startup does not mutate the parent environment', () => {
    const parentEnvironment = { VITE_DEMO_MODE: 'true' };

    const viteEnvironment = createViteDevEnvironment(parentEnvironment);

    assert.equal(parentEnvironment.VITE_DEMO_MODE, 'true');
    assert.equal(viteEnvironment.VITE_DEMO_MODE, 'false');
});
