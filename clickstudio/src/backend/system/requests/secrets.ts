import { requireThat } from './errors.js';
import { configuredSecrets, type Config } from '../settings/config.js';

export function createSecretGuards(config: Config) {
    const secretFree = (value: unknown) =>
        !configuredSecrets(config).some(secret => JSON.stringify(value).includes(secret));
    const safeExport = (value: unknown) =>
        requireThat(
            secretFree(value),
            400,
            'SECRET_IN_EXPORT',
            'This data contains a configured secret and cannot be exported or shared',
        );
    return { secretFree, safeExport };
}
