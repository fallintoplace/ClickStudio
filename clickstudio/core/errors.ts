import type { ApiError } from '../shared/types.js';
export class AppError extends Error {
    constructor(
        public readonly status: number,
        public readonly code: string,
        message: string,
        public readonly remediation?: string,
        public readonly position?: number,
    ) {
        super(message);
    }
    toJSON(): ApiError {
        return {
            code: this.code,
            message: this.message,
            remediation: this.remediation,
            position: this.position,
        };
    }
}
export function requireThat(
    condition: unknown,
    status: number,
    code: string,
    message: string,
    remediation?: string,
): asserts condition {
    if (!condition) throw new AppError(status, code, message, remediation);
}
export function asError(error: unknown): ApiError {
    if (error instanceof AppError) return error.toJSON();
    if (error instanceof Error)
        return { code: 'EXECUTION_FAILED', message: error.message.slice(0, 3000) };
    return { code: 'INTERNAL_ERROR', message: 'The operation failed.' };
}
