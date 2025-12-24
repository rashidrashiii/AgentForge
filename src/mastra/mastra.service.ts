import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Agent } from '@mastra/core';
import { WorkspaceService } from '../workspace/workspace.service';
import { createMastraTools } from './tools';

@Injectable()
export class MastraService {
    private readonly logger = new Logger(MastraService.name);

    constructor(
        private configService: ConfigService,
        private workspaceService: WorkspaceService
    ) { }

    async generateResponse(sessionId: string, messages: any[], systemPrompt: string, options: { enableTools?: boolean } = {}) {
        const toolsMap = options.enableTools === false ? undefined : createMastraTools(this.workspaceService, sessionId);

        const provider = this.configService.get('provider') || 'openrouter';
        // Correct key is 'model' from configuration.ts, also fallback to env directly
        const modelName = this.configService.get('model') || process.env.DEFAULT_MODEL || 'gemini-2.0-flash-exp';

        const geminiKey = process.env.GEMINI_API_KEY || this.configService.get('geminiApiKey');
        const openRouterKey = process.env.OPENROUTER_API_KEY || this.configService.get('openRouterApiKey');

        let modelConfig: any;

        if (provider === 'gemini') {
            modelConfig = {
                id: `google/${modelName}`,
                apiKey: geminiKey
            };
        } else {
            // Mastra's OpenAI provider (used for OpenRouter) strictly expects OPENAI_API_KEY env var to be present
            // even if apiKey is passed in options in some versions/contexts.
            // We polyfill it here to ensure it works.
            if (openRouterKey && !process.env.OPENAI_API_KEY) {
                process.env.OPENAI_API_KEY = openRouterKey;
            }
            // If it's already set (e.g. to a real OpenAI key), we might overwrite it or respect it.
            // Given we are intending to use OpenRouter, we should force it if we have an OpenRouter key.
            if (openRouterKey) {
                process.env.OPENAI_API_KEY = openRouterKey;
            }

            const routerUrl = this.configService.get('baseUrl') || 'https://openrouter.ai/api/v1';
            process.env.OPENAI_BASE_URL = routerUrl;

            let openRouterModel = modelName;
            // Fix: OpenRouter requires vendor prefix (e.g. google/gemini-...). 
            // If missing and looks like a gemini model, prepend it.
            if (!openRouterModel.includes('/') && openRouterModel.startsWith('gemini')) {
                openRouterModel = `google/${openRouterModel}`;
            }

            // Fix: OpenRouter often requires :free for experimental models if not paying
            // and gemini-2.0-flash-exp usually has :free variant
            if (openRouterModel.includes('gemini-2.0-flash-exp') && !openRouterModel.includes(':')) {
                openRouterModel += ':free';
            }

            modelConfig = {
                id: `openai/${openRouterModel}`,
                apiKey: openRouterKey,
                baseURL: routerUrl,
            };
        }

        const agent = new Agent({
            name: 'UI Generator',
            instructions: systemPrompt,
            model: modelConfig,
            tools: toolsMap,
        });

        try {
            this.logger.log(`Generating with provider: ${provider}, model: ${modelConfig.id}`);
            const result = await agent.generate(messages, {
                providerOptions: {
                    google: {
                        safetySettings: [
                            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
                        ]
                    }
                }
            });
            this.logger.log('Mastra generation successful');
            return result.text;
        } catch (error) {
            this.logger.error('Mastra generation error', error);
            throw error;
        }
    }

    async *generateResponseStream(sessionId: string, messages: any[], systemPrompt: string, options: { enableTools?: boolean } = {}): AsyncGenerator<string> {
        const toolsMap = options.enableTools === false ? undefined : createMastraTools(this.workspaceService, sessionId);
        const provider = this.configService.get('provider') || 'openrouter';
        const modelName = this.configService.get('model') || process.env.DEFAULT_MODEL || 'gemini-2.0-flash-exp';
        const geminiKey = process.env.GEMINI_API_KEY || this.configService.get('geminiApiKey');
        const openRouterKey = process.env.OPENROUTER_API_KEY || this.configService.get('openRouterApiKey');

        let modelConfig: any;

        if (provider === 'gemini') {
            modelConfig = {
                id: `google/${modelName}`,
                apiKey: geminiKey
            };
        } else {
            if (openRouterKey && !process.env.OPENAI_API_KEY) {
                process.env.OPENAI_API_KEY = openRouterKey;
            }
            if (openRouterKey) {
                process.env.OPENAI_API_KEY = openRouterKey;
            }

            const routerUrl = this.configService.get('baseUrl') || 'https://openrouter.ai/api/v1';
            process.env.OPENAI_BASE_URL = routerUrl;

            let openRouterModel = modelName;
            if (!openRouterModel.includes('/') && openRouterModel.startsWith('gemini')) {
                openRouterModel = `google/${openRouterModel}`;
            }

            if (openRouterModel.includes('gemini-2.0-flash-exp') && !openRouterModel.includes(':')) {
                openRouterModel += ':free';
            }

            modelConfig = {
                id: `openai/${openRouterModel}`,
                apiKey: openRouterKey,
                baseURL: routerUrl,
            };
        }

        const agent = new Agent({
            name: 'UI Generator',
            instructions: systemPrompt,
            model: modelConfig,
            tools: toolsMap,
        });

        try {
            this.logger.log(`Streaming with provider: ${provider}, model: ${modelConfig.id}`);

            const result = await agent.stream(messages, {
                providerOptions: {
                    google: {
                        safetySettings: [
                            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
                        ]
                    }
                }
            });

            // Handle Vercel AI SDK style streaming
            if (result.textStream) {
                for await (const chunk of result.textStream) {
                    yield chunk;
                }
            } else {
                this.logger.warn('Unexpected stream result structure, falling back to non-streaming');
                // Cast to any to access properties safely
                const anyResult = result as any;
                yield anyResult.text || JSON.stringify(result);
            }

        } catch (error) {
            this.logger.error('Mastra streaming error', error);
            throw error;
        }
    }
}
