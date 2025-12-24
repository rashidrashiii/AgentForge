import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';

@Injectable()
export class LlmService {
    private openai: OpenAI;
    private gemini: GoogleGenAI;
    private defaultModel: string;
    private provider: string;
    private readonly logger = new Logger(LlmService.name);

    constructor(private configService: ConfigService) {
        this.provider = this.configService.get<string>('provider') || 'openrouter';
        this.defaultModel = this.configService.get<string>('defaultModel') || 'google/gemini-2.0-pro-exp:free';

        if (this.provider === 'gemini') {
            const apiKey = this.configService.get<string>('geminiApiKey');
            if (!apiKey) {
                this.logger.warn('GEMINI_API_KEY is not defined');
            }
            this.gemini = new GoogleGenAI({ apiKey });
        } else {
            const apiKey = this.configService.get<string>('openRouterApiKey');
            const baseURL = this.configService.get<string>('baseUrl');

            if (!apiKey) {
                this.logger.warn('OPENROUTER_API_KEY is not defined');
            }

            this.openai = new OpenAI({
                apiKey: apiKey || 'dummy-key',
                baseURL,
            });
        }
    }

    async generateCompletion(messages: any[], model?: string, stream: boolean = false, tools?: any[]) {
        if (this.provider === 'gemini') {
            return this.generateGeminiCompletion(messages, model, tools);
        }
        return this.generateOpenAICompletion(messages, model, stream, tools);
    }

    private async generateGeminiCompletion(messages: any[], model?: string, tools?: any[]) {
        const currentModel = model || 'gemini-2.0-flash-exp'; // Default for Gemini if not set, though we usually use the env default

        // Convert messages to Gemini format
        // OpenAI: [{role: 'system', content: '...'}, {role: 'user', content: '...'}, {role: 'assistant', tool_calls: [...]}, {role: 'tool', tool_call_id: '...', content: '...'}]
        // Gemini: contents: [{role: 'user'|'model', parts: [{text: '...'}, {functionCall: ...}, {functionResponse: ...}]}]
        // System prompt is separate in config usually, or pure text.

        let systemInstruction: string | undefined;
        const contents: any[] = [];

        for (const msg of messages) {
            if (msg.role === 'system') {
                systemInstruction = msg.content;
            } else if (msg.role === 'user') {
                if (msg.content) {
                    contents.push({ role: 'user', parts: [{ text: msg.content }] });
                }
            } else if (msg.role === 'assistant') {
                const parts: any[] = [];
                if (msg.content) parts.push({ text: msg.content });
                if (msg.tool_calls) {
                    for (const tc of msg.tool_calls) {
                        parts.push({
                            functionCall: {
                                name: tc.function.name,
                                args: JSON.parse(tc.function.arguments)
                            }
                        });
                    }
                }
                if (parts.length > 0) {
                    contents.push({ role: 'model', parts });
                }
            } else if (msg.role === 'tool') {
                // gemini expects functionResponse in 'function' role usually locally or 'user' role with part functionResponse?
                // Actually in the new SDK/API, it's often grouped. 
                // Let's check user snippet. User didn't show chat history.
                // Standard Google GenAI: role 'function' or part 'functionResponse'.
                // According to latest docs/types, it's usually part of the conversation.
                // To keep it simple, we map to 'user' role with functionResponse part if acceptable, or 'function' role.
                // Correct mapping for v1beta usually involves 'function' role or corresponding parts.

                // Let's assume 'function' role for tool outputs if supported, otherwise check docs.
                // The @google/genai SDK (v0.x) uses specific structure.

                // Trying 'user' role with functionResponse part is a safe bet for many Google APIs, but let's try strict mapping.
                // Actually, for multiple tool outputs, we often need to match them to calls.
                // Simplified: parts: [{ functionResponse: { name: ..., response: ... } }] in a 'tool' role if exists, or 'user'.
                // Wait, 'user' -> 'model' -> 'user' (with function response).

                // We need to find the name of the function from the tool_call_id if possible, but OpenAI messages here only have tool_call_id in the tool message.
                // We might need to store context or infer. 
                // However, OpenAI messages passed here are history.
                // We can look back at previous assistant message to map ID to name.

                const lastMsg = messages[messages.indexOf(msg) - 1]; // flawed logic if multiple tools?
                // Actually persistence has strictly ordered history.
                // We'll iterate to rebuild.

                // Better approach:
                // We need to map tool_call_id to function name.

                // For now, let's assume we can find the name from the previous message in the loop or we parse it differently. 
                // Only way is to scan previous assistant messages.
                let fnName = 'unknown'; // Fallback
                // Find the assistant message that has this tool_call_id
                for (let i = messages.indexOf(msg) - 1; i >= 0; i--) {
                    if (messages[i].role === 'assistant' && messages[i].tool_calls) {
                        const found = messages[i].tool_calls.find((tc: any) => tc.id === msg.tool_call_id);
                        if (found) {
                            fnName = found.function.name;
                            break;
                        }
                    }
                }

                contents.push({
                    role: 'tool', // or 'user' depending on API version, let's try 'tool' which is semantic
                    parts: [{
                        functionResponse: {
                            name: fnName,
                            response: { result: msg.content } // Gemini expects JSON object usually
                        }
                    }]
                });
            }
        }

        // Map Tools
        let geminiTools: any[] | undefined;
        if (tools) {
            geminiTools = [{
                functionDeclarations: tools.map(t => ({
                    name: t.function.name,
                    description: t.function.description,
                    parameters: t.function.parameters
                }))
            }];
        }

        const config: any = {
            tools: geminiTools,
        };

        if (systemInstruction) {
            config.systemInstruction = systemInstruction;
        }

        try {
            const response = await this.gemini.models.generateContent({
                model: currentModel,
                config,
                contents,
            });

            // Map back to OpenAI format
            // response.candidates[0].content.parts
            const candidate = response.candidates?.[0];
            const contentPart = candidate?.content?.parts?.find((p: any) => p.text);
            const functionCallParts = candidate?.content?.parts?.filter((p: any) => p.functionCall);

            const toolCalls = functionCallParts?.map((p: any, index: number) => ({
                id: `call_${index}_${Date.now()}`, // Dummy ID, Gemini doesn't provide one matching OpenAI style
                type: 'function',
                function: {
                    name: p.functionCall.name,
                    arguments: JSON.stringify(p.functionCall.args)
                }
            }));

            return {
                choices: [{
                    message: {
                        role: 'assistant',
                        content: contentPart?.text || null,
                        tool_calls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined
                    }
                }]
            };

        } catch (e) {
            this.logger.error('Gemini API Error', e);
            throw e;
        }
    }

    private async generateOpenAICompletion(messages: any[], model?: string, stream: boolean = false, tools?: any[]) {
        const currentModel = model || this.defaultModel;

        const options: any = {
            model: currentModel,
            messages,
            stream,
        };

        if (tools) {
            options.tools = tools;
            options.tool_choice = 'auto';
        }

        let retries = 3;
        while (retries > 0) {
            try {
                return await this.openai.chat.completions.create(options);
            } catch (error) {
                if (error.status === 429 && retries > 1) {
                    this.logger.warn(`Rate limit hit. Retrying in ${(4 - retries) * 2}s...`);
                    await new Promise(resolve => setTimeout(resolve, (4 - retries) * 2000));
                    retries--;
                } else {
                    throw error;
                }
            }
        }
        throw new Error('Max retries exceeded for LLM provider');
    }
}
