import OpenAI from 'openai';
import { APIConnectionTimeoutError, APIError } from 'openai';
import { ASSISTANT_REQUEST_TIMEOUT_MS, ASSISTANT_TIMEOUT_MESSAGE, isAssistantTimeoutSignal, validateProposal, type AssistantDriver, type PreparedContext } from '../core/assistant.js';
import { AppError } from '../core/errors.js';
import type { AssistantSource } from '../shared/types.js';
const MAX_OUTPUT_TOKENS = 12_000;
const DEFAULT_MAX_INPUT_TOKENS = 48_000;
const strings = { type: 'array', items: { type: 'string' } };
const schema = { type: 'object', additionalProperties: false, required: ['sql', 'summary', 'assumptions', 'tables', 'caveats', 'clarification', 'findings'], properties: {
        sql: { type: ['string', 'null'] }, summary: { type: 'string' }, assumptions: strings, tables: strings, caveats: strings, clarification: { type: ['string', 'null'] },
        findings: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['severity', 'message', 'evidence'], properties: { severity: { type: 'string', enum: ['high', 'medium', 'low'] }, message: { type: 'string' }, evidence: { type: 'string' } } } },
    } };

function maxInputTokens(): number {
    const configured = Number(process.env.OPENAI_MAX_INPUT_TOKENS);
    return Number.isSafeInteger(configured) && configured > 0 ? configured : DEFAULT_MAX_INPUT_TOKENS;
}

function isContextLengthError(error: unknown): error is APIError {
    if (!(error instanceof APIError)) return false;
    const identifiers = `${error.code ?? ''} ${error.type ?? ''}`;
    return /context[_ -](?:length|window)|too[_ -]many[_ -]tokens/i.test(identifiers) || /context (?:length|window)|maximum.{0,24}tokens/i.test(error.message);
}

function logProviderFailure(stage: string, error: unknown, inputTokens?: number) {
    const errorType = error instanceof APIConnectionTimeoutError ? 'APIConnectionTimeoutError' : error instanceof Error ? error.name : 'unknown';
    const details = error instanceof APIError
        ? { errorType, status: error.status, code: error.code, type: error.type, requestId: error.requestID }
        : { errorType };
    console.error('ClickStudio assistant request failed', { stage, ...details, ...(inputTokens === undefined ? {} : { inputTokens }) });
}

function dropOldestConversationTurn(messages: OpenAI.Responses.ResponseInput): OpenAI.Responses.ResponseInput {
    if (!Array.isArray(messages) || !messages.length) return messages;
    let remove = 1;
    const firstRole = (messages[0] as { role?: string } | undefined)?.role;
    const secondRole = (messages[1] as { role?: string } | undefined)?.role;
    if (firstRole === 'user' && secondRole === 'assistant')
        remove = 2;
    return messages.slice(remove);
}

export class OpenAIDriver implements AssistantDriver {
    readonly available: boolean;
    readonly model: string;
    private readonly maxInputTokens = maxInputTokens();
    private readonly client?: OpenAI;
    constructor(key?: string, model?: string) { this.available = Boolean(key && model); this.model = model ?? 'unconfigured'; if (this.available)
        this.client = new OpenAI({ apiKey: key, maxRetries: 0, timeout: ASSISTANT_REQUEST_TIMEOUT_MS }); }
    async propose(context: PreparedContext, signal: AbortSignal) {
        if (!this.client)
            throw new AppError(503, 'AI_UNAVAILABLE', 'Set OPENAI_API_KEY on the server');
        const content: OpenAI.Responses.ResponseInputContent[] = [{ type: 'input_text', text: JSON.stringify({ question: context.payload.question, context: JSON.parse(context.payload.context) }) }];
        if (context.payload.image)
            content.push({ type: 'input_image', image_url: context.payload.image, detail: 'auto' });
        const tools = [{ type: 'web_search' as const }];
        const text = { format: { type: 'json_schema' as const, name: 'clickhouse_proposal', strict: true, schema } };
        let conversation: OpenAI.Responses.ResponseInput = (context.payload.conversation ?? []).map(message => ({ role: message.role, content: message.content }));
        const currentMessage: OpenAI.Responses.ResponseInput = [{ role: 'user', content }];
        const requestInput = (): OpenAI.Responses.ResponseInput => [...conversation, ...currentMessage];
        const countRequestTokens = async () => (await this.client!.responses.inputTokens.count({
            model: this.model,
            instructions: context.payload.instructions,
            input: requestInput(),
            tools,
            tool_choice: 'auto',
            text,
        }, { signal })).input_tokens;
        let inputTokens: number | undefined;
        const fitConversationToBudget = async () => {
            while (true) {
                try {
                    inputTokens = await countRequestTokens();
                } catch (error) {
                    if (signal.aborted || error instanceof APIConnectionTimeoutError) throw error;
                    if (isContextLengthError(error)) {
                        logProviderFailure('input_tokens', error, inputTokens);
                        const reduced = dropOldestConversationTurn(conversation);
                        if (reduced.length === conversation.length)
                            throw new AppError(413, 'AI_CONTEXT_TOO_LARGE', 'This request exceeds the model context limit. Shorten the SQL or use a smaller result.');
                        conversation = reduced;
                        continue;
                    }
                    logProviderFailure('input_tokens', error, inputTokens);
                    inputTokens = undefined;
                    return;
                }
                if (inputTokens <= this.maxInputTokens) return;
                const reduced = dropOldestConversationTurn(conversation);
                if (reduced.length === conversation.length) {
                    console.warn('ClickStudio assistant input exceeds its configured token budget', { inputTokens, maxInputTokens: this.maxInputTokens });
                    throw new AppError(413, 'AI_CONTEXT_TOO_LARGE', `This request exceeds the ${this.maxInputTokens.toLocaleString()} input-token limit. Shorten the SQL or use a smaller result.`);
                }
                conversation = reduced;
            }
        };
        let response: OpenAI.Responses.Response;
        try {
            await fitConversationToBudget();
            while (true) {
                try {
                    response = await this.client.responses.create({ model: this.model, store: false, instructions: context.payload.instructions, input: requestInput(),
                        tools, tool_choice: 'auto', max_output_tokens: MAX_OUTPUT_TOKENS, text }, { signal });
                    break;
                } catch (error) {
                    if (signal.aborted) throw error;
                    if (!isContextLengthError(error)) throw error;
                    logProviderFailure('responses', error, inputTokens);
                    const reduced = dropOldestConversationTurn(conversation);
                    if (reduced.length === conversation.length)
                        throw new AppError(413, 'AI_CONTEXT_TOO_LARGE', 'This request exceeds the model context limit. Shorten the SQL or use a smaller result.');
                    conversation = reduced;
                    await fitConversationToBudget();
                }
            }
            if (response.status !== 'completed' || !response.output_text) {
                const reason = response.incomplete_details?.reason;
                const message = reason === 'max_output_tokens'
                    ? 'The assistant response reached its length limit. Try asking for a smaller part at a time. No draft was changed.'
                    : reason === 'content_filter'
                        ? 'The response was stopped by the content filter. No draft was changed.'
                        : 'The assistant stopped before completing a response. No draft was changed.';
                throw new AppError(502, 'AI_INCOMPLETE', message);
            }
            const sourceMap = new Map<string, AssistantSource>();
            for (const item of response.output) {
                if (item.type !== 'message') continue;
                for (const part of item.content) {
                    if (part.type !== 'output_text') continue;
                    for (const annotation of part.annotations) {
                        if (annotation.type === 'url_citation' && !sourceMap.has(annotation.url) && sourceMap.size < 20)
                            sourceMap.set(annotation.url, { title: annotation.title, url: annotation.url });
                    }
                }
            }
            const sources = [...sourceMap.values()];
            return { content: validateProposal({ ...JSON.parse(response.output_text), ...(sources.length ? { sources } : {}) }), responseId: response.id };
        }
        catch (error) {
            if (error instanceof AppError)
                throw error;
            if (error instanceof APIConnectionTimeoutError || isAssistantTimeoutSignal(signal)) {
                logProviderFailure('timeout', error, inputTokens);
                throw new AppError(504, 'AI_TIMEOUT', ASSISTANT_TIMEOUT_MESSAGE);
            }
            if (signal.aborted)
                throw error;
            logProviderFailure('responses', error, inputTokens);
            throw new AppError(502, 'AI_PROVIDER_ERROR', 'The OpenAI request failed or returned invalid structured output. No SQL was applied or executed.');
        }
    }
}
