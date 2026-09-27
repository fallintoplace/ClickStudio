import { randomUUID } from 'node:crypto';
import type { Json, Proposal, Result, Schema, SchemaColumn, SchemaTable } from '../../shared/types.js';
import { buildContext, PROMPT_VERSION, validateProposal, type PreparedContext } from '../../core/assistant.js';
import { evaluateProposal } from '../../core/assistant-evaluation.js';
import { AppError } from '../../core/errors.js';
import { guardSql } from '../../core/guards.js';
import { OpenAIDriver } from '../../server/openai.js';
import { selectAssistantReferenceDocs } from '../../shared/reference-data.js';

const MAX_BODY_BYTES = 300_000;
const MAX_REQUESTS_PER_DAY = 20;
const MODEL = process.env.OPENAI_MODEL?.trim() || 'gpt-6-luna';
const requestsByIp = new Map<string, { day: string; count: number }>();

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function json(body: unknown, status = 200): Response {
    return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function fail(code: string, message: string, status = 400): Response {
    return json({ error: { code, message } }, status);
}

function field(value: unknown, name: string, max: number, allowEmpty = false): string {
    if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim()))
        throw new AppError(400, 'INVALID_REQUEST', `${name} must be a string under ${max.toLocaleString()} characters.`);
    return value;
}

function schemaFrom(value: unknown, connectionId: string): Schema {
    if (!isRecord(value) || !Array.isArray(value.tables) || !Array.isArray(value.columns) ||
        value.tables.length > 500 || value.columns.length > 2_000)
        throw new AppError(400, 'INVALID_SCHEMA', 'Refresh the ClickHouse schema and try again.');

    const tables: SchemaTable[] = value.tables.map(raw => {
        if (!isRecord(raw)) throw new AppError(400, 'INVALID_SCHEMA', 'Refresh the ClickHouse schema and try again.');
        return {
            database: field(raw.database, 'Schema database', 128),
            name: field(raw.name, 'Schema table', 256),
            engine: field(raw.engine ?? '', 'Schema engine', 128, true),
        };
    });
    const columns: SchemaColumn[] = value.columns.map(raw => {
        if (!isRecord(raw)) throw new AppError(400, 'INVALID_SCHEMA', 'Refresh the ClickHouse schema and try again.');
        return {
            database: field(raw.database, 'Schema database', 128),
            table: field(raw.table, 'Schema table', 256),
            name: field(raw.name, 'Schema column', 256),
            type: field(raw.type, 'Schema type', 2_048),
            defaultKind: '',
            comment: '',
        };
    });
    return {
        connectionId,
        fetchedAt: typeof value.fetchedAt === 'string' && value.fetchedAt.length <= 128 ? value.fetchedAt : new Date().toISOString(),
        tables,
        columns,
        warnings: [],
        truncated: value.truncated === true,
    };
}

function resultFrom(value: unknown): Result | undefined {
    if (value === undefined) return undefined;
    if (!isRecord(value) || !Array.isArray(value.columns) || !Array.isArray(value.rows) ||
        value.columns.length > 100 || value.rows.length > 100 ||
        (value.completeness !== 'complete' && value.completeness !== 'truncated'))
        throw new AppError(400, 'INVALID_RESULT', 'Select a valid retained result and try again.');
    const columns = value.columns.map(column => {
        if (!isRecord(column)) throw new AppError(400, 'INVALID_RESULT', 'Select a valid retained result and try again.');
        return { name: field(column.name, 'Result column name', 256), type: field(column.type, 'Result column type', 2_048) };
    });
    const rows = value.rows.map(row => {
        if (!Array.isArray(row) || row.length !== columns.length)
            throw new AppError(400, 'INVALID_RESULT', 'Select a valid retained result and try again.');
        return row as Json[];
    });
    return {
        runId: field(value.runId, 'Result run ID', 200), queryId: field(value.queryId, 'Result query ID', 200),
        columns, rows, completeness: value.completeness,
        createdAt: field(value.createdAt, 'Result creation time', 128), expiresAt: field(value.expiresAt, 'Result expiry time', 128),
    };
}

function allowRequest(ip: string): boolean {
    const day = new Date().toISOString().slice(0, 10);
    if (!requestsByIp.has(ip) && requestsByIp.size >= 2_000) {
        for (const [key, value] of requestsByIp)
            if (value.day !== day) requestsByIp.delete(key);
        if (requestsByIp.size >= 2_000) return false;
    }
    const current = requestsByIp.get(ip);
    if (current?.day === day && current.count >= MAX_REQUESTS_PER_DAY) return false;
    requestsByIp.set(ip, { day, count: current?.day === day ? current.count + 1 : 1 });
    return true;
}

async function post(request: Request): Promise<Response> {
    if (request.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 'Use POST to ask the ClickHouse assistant.', 405);
    if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json')
        return fail('CONTENT_TYPE', 'Send the assistant request as JSON.', 415);
    const origin = request.headers.get('origin');
    if (!origin || origin !== new URL(request.url).origin || request.headers.get('x-clickstudio-intent') !== '1')
        return fail('ORIGIN', 'This endpoint accepts requests from the ClickStudio site only.', 403);
    const length = Number(request.headers.get('content-length'));
    if (Number.isFinite(length) && length > MAX_BODY_BYTES) return fail('REQUEST_SIZE', 'The assistant request is too large.', 413);
    if (!process.env.OPENAI_API_KEY?.trim())
        return fail('AI_UNAVAILABLE', 'Add OPENAI_API_KEY to the Vercel project environment to enable the assistant.', 503);

    let raw: string;
    try {
        raw = await request.text();
    } catch {
        return fail('REQUEST_BODY', 'Could not read the request body.');
    }
    if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return fail('REQUEST_SIZE', 'The assistant request is too large.', 413);

    let body: unknown;
    try {
        body = JSON.parse(raw) as unknown;
    } catch {
        return fail('REQUEST_BODY', 'The request body is not valid JSON.');
    }
    if (!isRecord(body)) return fail('REQUEST_BODY', 'The request body must be a JSON object.');

    try {
        const connectionId = field(body.connectionId, 'Connection ID', 128);
        const question = field(body.question, 'Question', 4_000);
        const sql = field(body.sql, 'SQL', 200_000, true);
        const database = body.database === undefined ? undefined : field(body.database, 'Database', 128);
        const schema = schemaFrom(body.schema, connectionId);
        const includeRun = body.includeRun === true;
        if (includeRun) field(body.runId, 'Run ID', 200);
        const result = includeRun && body.result !== undefined ? resultFrom(body.result) : undefined;
        const evidenceSql = includeRun && body.evidenceSql !== undefined
            ? field(body.evidenceSql, 'Selected run SQL', 200_000, true)
            : undefined;
        const error = includeRun && body.error !== undefined
            ? field(body.error, 'Selected run error', 3_000, true)
            : undefined;
        const serverVersion = typeof body.serverVersion === 'string' ? body.serverVersion.slice(0, 128) : undefined;
        const documentation = selectAssistantReferenceDocs(question, sql, { schema, database, evidenceSql });
        const built = buildContext({ connectionId, database, action: 'ask', question, sql, schema, result, evidenceSql, error, serverVersion,
            documentation,
            sensitiveColumns: (process.env.AI_SENSITIVE_COLUMNS ?? 'password,token,secret,api_key').split(',').map(name => name.trim()) });
        const ip = request.headers.get('x-real-ip')?.trim() || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
        if (!allowRequest(ip)) return fail('AI_RATE_LIMIT', 'This network has reached the temporary assistant request limit. Try again later.', 429);
        const context: PreparedContext = {
            id: randomUUID(), owner: 'vercel-session', connectionId, action: 'ask', createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 60_000).toISOString(), baseSql: sql, ...built,
            evaluationSchema: { tables: schema.tables, truncated: schema.truncated }, state: 'running',
        };
        const driver = new OpenAIDriver(process.env.OPENAI_API_KEY, MODEL);
        const response = await driver.propose(context, AbortSignal.timeout(45_000));
        const content = validateProposal(response.content);
        if (content.sql !== null) guardSql(content.sql);
        const proposal: Proposal = {
            ...content,
            id: randomUUID(), owner: 'vercel-session', connectionId, action: 'ask', createdAt: new Date().toISOString(),
            baseSql: sql, responseId: response.responseId, model: driver.model, promptVersion: PROMPT_VERSION,
            contextSummary: built.summary, decision: 'pending',
            quality: evaluateProposal(content, 'ask', { schema: { tables: schema.tables, truncated: schema.truncated } }),
        };
        return json(proposal, 201);
    } catch (error) {
        if (error instanceof AppError) return fail(error.code, error.message, error.status);
        return fail('AI_PROVIDER_ERROR', 'The assistant request failed. No SQL was applied or run.', 502);
    }
}

export default {
    async fetch(request: Request): Promise<Response> {
        return await post(request);
    },
};
