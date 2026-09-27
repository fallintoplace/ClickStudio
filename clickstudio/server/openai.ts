import OpenAI from 'openai';
import type { AssistantDriver, PreparedContext } from '../core/assistant.js';
import { AppError } from '../core/errors.js';
import { validateProposal } from '../core/assistant.js';
const strings = { type: 'array', items: { type: 'string' } };
const schema = { type: 'object', additionalProperties: false, required: ['sql', 'summary', 'assumptions', 'tables', 'caveats', 'clarification', 'findings'], properties: {
        sql: { type: ['string', 'null'] }, summary: { type: 'string' }, assumptions: strings, tables: strings, caveats: strings, clarification: { type: ['string', 'null'] },
        findings: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['severity', 'message', 'evidence'], properties: { severity: { type: 'string', enum: ['high', 'medium', 'low'] }, message: { type: 'string' }, evidence: { type: 'string' } } } },
    } };
export class OpenAIDriver implements AssistantDriver {
    readonly available: boolean;
    readonly model: string;
    private readonly client?: OpenAI;
    constructor(key?: string, model?: string) { this.available = Boolean(key && model); this.model = model ?? 'unconfigured'; if (this.available)
        this.client = new OpenAI({ apiKey: key, maxRetries: 0, timeout: 45000 }); }
    async propose(context: PreparedContext, signal: AbortSignal) {
        if (!this.client)
            throw new AppError(503, 'AI_UNAVAILABLE', 'Set OPENAI_API_KEY on the server');
        const content: OpenAI.Responses.ResponseInputContent[] = [{ type: 'input_text', text: JSON.stringify({ question: context.payload.question, context: JSON.parse(context.payload.context) }) }];
        if (context.payload.image)
            content.push({ type: 'input_image', image_url: context.payload.image, detail: 'auto' });
        try {
            const response = await this.client.responses.create({ model: this.model, store: false, instructions: context.payload.instructions, input: [{ role: 'user', content }],
                max_output_tokens: 3000, text: { format: { type: 'json_schema', name: 'clickhouse_proposal', strict: true, schema } } }, { signal });
            if (response.status !== 'completed' || !response.output_text)
                throw new AppError(502, 'AI_INCOMPLETE', 'The model did not return a complete proposal. No draft was changed.');
            return { content: validateProposal(JSON.parse(response.output_text)), responseId: response.id };
        }
        catch (error) {
            if (error instanceof AppError)
                throw error;
            throw new AppError(502, 'AI_PROVIDER_ERROR', 'The OpenAI request failed or returned invalid structured output. No SQL was applied or executed.');
        }
    }
}
