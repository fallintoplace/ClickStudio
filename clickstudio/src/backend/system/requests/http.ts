import {
    MAX_IMPORT_COLUMNS,
    MAX_IMPORT_COLUMN_NAME_CHARS,
} from '../../../shared/database/imports/limits.js';
import { type Request, type Response } from 'express';
import type { Principal } from '../../../shared/common/identity.js';
import { requireThat } from './errors.js';
import { identifier, record, text } from './validation.js';

export function mappingFields(value: unknown) {
    const fields = record(value, 'mapping');
    requireThat(
        Object.keys(fields).length <= MAX_IMPORT_COLUMNS,
        400,
        'IMPORT_MAPPING',
        'Too many mapping fields',
    );
    return Object.fromEntries(
        Object.entries(fields).map(([key, value]) => [
            text(key, 'source column', MAX_IMPORT_COLUMN_NAME_CHARS),
            text(value, 'destination column', MAX_IMPORT_COLUMN_NAME_CHARS),
        ]),
    );
}

export const body = (req: Request) => record(req.body),
    id = (req: Request, name = 'id') => identifier(req.params[name], name);

export function boolean(v: unknown, name: string) {
    requireThat(typeof v === 'boolean', 400, 'INVALID_REQUEST', `${name} must be a boolean`);
    return v;
}

export function principal(res: Response): Principal {
    return res.locals.principal as Principal;
}

export function number(v: unknown, fallback: number) {
    return v === undefined ? fallback : Number(v);
}
