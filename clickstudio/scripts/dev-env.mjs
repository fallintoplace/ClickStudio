export function createViteDevEnvironment(environment = process.env) {
    return { ...environment, VITE_DEMO_MODE: 'false' };
}
