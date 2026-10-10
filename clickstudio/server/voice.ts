import { createHash } from 'node:crypto';
import { AppError } from '../core/errors.js';

export interface VoiceSessionInput {
    sdp: string;
    context?: string;
    safetyIdentifier: string;
}

export interface VoiceSession {
    sdp: string;
    model: string;
}

export interface VoiceService {
    readonly available: boolean;
    readonly model: string;
    createSession(input: VoiceSessionInput): Promise<VoiceSession>;
}

const voiceInstructions = (context?: string) =>
    [
        'You are the concise voice copilot inside ClickStudio, a ClickHouse SQL workspace.',
        'Help the user understand the current SQL, results, ClickHouse concepts, and possible next steps.',
        'You may suggest SQL in speech, but you must never claim to execute SQL, edit the draft, or change data.',
        'Execution and applying edits are always explicit UI actions outside the voice session.',
        'Prefer short spoken answers. Say when you are unsure. Do not read long SQL or result sets aloud unless asked.',
        context ? `Current ClickStudio context:\n${context}` : '',
    ]
        .filter(Boolean)
        .join('\n\n');

export class OpenAIVoiceService implements VoiceService {
    readonly available: boolean;
    readonly model: string;

    constructor(
        private readonly apiKey?: string,
        model?: string,
    ) {
        this.available = Boolean(apiKey);
        this.model = model ?? 'gpt-realtime-2.1';
    }

    async createSession(input: VoiceSessionInput): Promise<VoiceSession> {
        if (!this.apiKey)
            throw new AppError(
                503,
                'AI_VOICE_UNAVAILABLE',
                'Set OPENAI_API_KEY on the server to use voice workflows',
            );
        const form = new FormData();
        form.set('sdp', input.sdp);
        form.set(
            'session',
            JSON.stringify({
                type: 'realtime',
                model: this.model,
                modalities: ['audio'],
                instructions: voiceInstructions(input.context),
                input_audio_transcription: { model: 'gpt-4o-mini-transcribe' },
                audio: { output: { voice: 'marin' } },
            }),
        );
        let response: Response;
        try {
            response = await fetch('https://api.openai.com/v1/realtime/calls', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    'OpenAI-Safety-Identifier': input.safetyIdentifier,
                },
                body: form,
                signal: AbortSignal.timeout(45000),
            });
        } catch {
            throw new AppError(
                502,
                'AI_VOICE_PROVIDER_ERROR',
                'The voice provider could not create a session',
            );
        }
        const sdp = await response.text();
        if (!response.ok || !sdp.trim())
            throw new AppError(
                502,
                'AI_VOICE_PROVIDER_ERROR',
                'The voice provider rejected the session',
            );
        return { sdp, model: this.model };
    }
}

export function safetyIdentifier(principalId: string) {
    return createHash('sha256').update(principalId).digest('hex');
}
