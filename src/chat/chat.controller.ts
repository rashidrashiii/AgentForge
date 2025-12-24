import { Controller, Post, Body, BadRequestException, Sse, MessageEvent, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiBody } from '@nestjs/swagger';
import { AgentService } from '../agent/agent.service';
import { WorkspaceService } from '../workspace/workspace.service';
import { GenerateRequestDto } from './dto/generate.dto';
import { Observable } from 'rxjs';

@Controller('chat')
@ApiTags('chat')
export class ChatController {
    constructor(
        private readonly agentService: AgentService,
        private readonly workspaceService: WorkspaceService,
    ) { }

    @Post('generate')
    @ApiOperation({
        summary: 'Generate UI based on user prompt with framework selection',
        description: 'Creates or updates UI components based on natural language prompts. Supports both React (Vite) and Next.js scaffolds with shadcn/ui components.'
    })
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                sessionId: {
                    type: 'string',
                    example: 'my-project-123',
                    description: 'Unique identifier for the project session'
                },
                prompt: {
                    type: 'string',
                    example: 'Create a landing page with hero section and features grid',
                    description: 'Natural language description of the UI to generate'
                },
                framework: {
                    type: 'string',
                    enum: ['react', 'nextjs'],
                    example: 'nextjs',
                    description: 'Framework to use for code generation. Defaults to "nextjs" if not specified. React uses Vite, Next.js uses App Router.'
                }
            },
            required: ['sessionId', 'prompt']
        }
    })
    @ApiResponse({
        status: 200,
        description: 'UI generated successfully',
        schema: {
            type: 'object',
            properties: {
                sessionId: { type: 'string', example: 'my-project-123' },
                framework: { type: 'string', example: 'nextjs' },
                response: { type: 'string', example: 'Successfully created Hero component and updated page.tsx' }
            }
        }
    })
    @ApiResponse({
        status: 400,
        description: 'Bad request - invalid session ID, prompt, or framework'
    })
    async generate(@Body() body: GenerateRequestDto) {
        const framework = body.framework || 'nextjs';
        try {
            try {
                await this.workspaceService.listFiles(body.sessionId);
            } catch {
                await this.workspaceService.initializeProject(body.sessionId, framework);
            }

            const response = await this.agentService.runAgent(body.sessionId, body.prompt, framework);
            return {
                sessionId: body.sessionId,
                framework,
                response
            };
        } catch (error) {
            throw new BadRequestException(error.message);
        }
    }


    @Post('plan')
    @ApiOperation({
        summary: 'Create a plan for UI generation (Phase 1)',
        description: 'Creates a detailed implementation plan based on the user prompt. The plan includes components to create, files to modify, and implementation steps. User must review and approve before coding begins.'
    })
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                sessionId: { type: 'string', example: 'my-project-123' },
                prompt: { type: 'string', example: 'Create a landing page with hero section and features' },
                framework: { type: 'string', enum: ['react', 'nextjs'], example: 'react' }
            },
            required: ['sessionId', 'prompt']
        }
    })
    @ApiResponse({
        status: 200,
        description: 'Plan created, awaiting approval',
        schema: {
            type: 'object',
            properties: {
                sessionId: { type: 'string' },
                framework: { type: 'string' },
                phase: { type: 'string', example: 'awaiting_approval' },
                plan: { type: 'string', description: 'Detailed implementation plan in markdown' },
                message: { type: 'string' }
            }
        }
    })
    async plan(@Body() body: GenerateRequestDto) {
        const framework = body.framework || 'nextjs';
        try {
            try {
                await this.workspaceService.listFiles(body.sessionId);
            } catch {
                await this.workspaceService.initializeProject(body.sessionId, framework);
            }

            const result = await this.agentService.runPlanningPhase(body.sessionId, body.prompt, framework);
            return {
                sessionId: body.sessionId,
                framework,
                phase: result.phase,
                plan: result.plan,
                message: 'Review the plan and call /chat/plan/approve or /chat/plan/stream to proceed'
            };
        } catch (error) {
            throw new BadRequestException(error.message);
        }
    }

    @Post('plan/approve')
    @ApiOperation({
        summary: 'Approve plan and execute coding + verification (Phase 2 & 3)',
        description: 'Approves the previously created plan, executes the coding phase, and automatically runs verification to ensure everything was implemented correctly.'
    })
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                sessionId: { type: 'string', example: 'my-project-123' }
            },
            required: ['sessionId']
        }
    })
    @ApiResponse({
        status: 200,
        description: 'Coding and verification complete',
        schema: {
            type: 'object',
            properties: {
                sessionId: { type: 'string' },
                phase: { type: 'string', example: 'complete' },
                result: { type: 'string', description: 'Coding result with verification status' }
            }
        }
    })
    async approvePlan(@Body() body: { sessionId: string }) {
        try {
            const result = await this.agentService.runCodingPhase(body.sessionId);
            return {
                sessionId: body.sessionId,
                phase: 'complete',
                result
            };
        } catch (error) {
            throw new BadRequestException(error.message);
        }
    }

    @Sse('plan/stream')
    @ApiOperation({
        summary: 'Stream planning phase with real-time updates',
        description: 'Creates a plan with Server-Sent Events for real-time progress updates. Shows AI thinking and progress.'
    })
    @ApiQuery({ name: 'sessionId', required: true, type: String })
    @ApiQuery({ name: 'prompt', required: true, type: String })
    @ApiQuery({ name: 'framework', required: false, enum: ['react', 'nextjs'] })
    planStream(
        @Query('sessionId') sessionId: string,
        @Query('prompt') prompt: string,
        @Query('framework') framework?: 'react' | 'nextjs'
    ): Observable<MessageEvent> {
        if (!sessionId || !prompt) {
            throw new BadRequestException('sessionId and prompt are required');
        }
        const selectedFramework = framework || 'nextjs';

        return new Observable((observer) => {
            this.agentService.runPlanningPhaseStream(sessionId, prompt, selectedFramework, (event) => {
                observer.next({ data: event } as MessageEvent);
            }).then(() => {
                observer.next({ data: { type: 'done' } } as MessageEvent);
                observer.complete();
            }).catch(error => {
                observer.next({ data: { type: 'error', message: error.message } } as MessageEvent);
                observer.complete();
            });
        });
    }

    @Sse('plan/approve/stream')
    @ApiOperation({
        summary: 'Stream coding and verification with real-time updates',
        description: 'Approves plan and streams coding + verification progress with Server-Sent Events.'
    })
    @ApiQuery({ name: 'sessionId', required: true, type: String })
    approveStream(
        @Query('sessionId') sessionId: string
    ): Observable<MessageEvent> {
        if (!sessionId) {
            throw new BadRequestException('sessionId is required');
        }

        return new Observable((observer) => {
            this.agentService.runCodingPhaseStream(sessionId, (event) => {
                observer.next({ data: event } as MessageEvent);
            }).then(() => {
                observer.next({ data: { type: 'done' } } as MessageEvent);
                observer.complete();
            }).catch(error => {
                observer.next({ data: { type: 'error', message: error.message } } as MessageEvent);
                observer.complete();
            });
        });
    }

    @Sse('generate/stream')
    @ApiOperation({
        summary: 'Generate UI with real-time streaming updates',
        description: 'Stream AI generation progress in real-time using Server-Sent Events (SSE). Events include status updates, content chunks, completion, and errors.'
    })
    @ApiQuery({
        name: 'sessionId',
        required: true,
        type: String,
        example: 'my-project-123',
        description: 'Unique identifier for the project session'
    })
    @ApiQuery({
        name: 'prompt',
        required: true,
        type: String,
        example: 'Create a Netflix homepage with hero section',
        description: 'Natural language description of the UI to generate'
    })
    @ApiQuery({
        name: 'framework',
        required: false,
        type: String,
        enum: ['react', 'nextjs'],
        example: 'nextjs',
        description: 'Framework to use (defaults to nextjs)'
    })
    @ApiResponse({
        status: 200,
        description: 'Server-Sent Event stream with generation updates',
        content: {
            'text/event-stream': {
                schema: {
                    type: 'object',
                    properties: {
                        type: {
                            type: 'string',
                            enum: ['status', 'chunk', 'complete', 'done', 'error'],
                            description: 'Event type'
                        },
                        message: { type: 'string', description: 'Status message' },
                        content: { type: 'string', description: 'Content chunk' }
                    }
                },
                examples: {
                    status: {
                        value: { type: 'status', message: 'AI is thinking...' }
                    },
                    chunk: {
                        value: { type: 'chunk', content: 'Creating Hero component...' }
                    },
                    done: {
                        value: { type: 'done' }
                    }
                }
            }
        }
    })
    generateStream(
        @Query('sessionId') sessionId: string,
        @Query('prompt') prompt: string,
        @Query('framework') framework?: 'react' | 'nextjs'
    ): Observable<MessageEvent> {
        if (!sessionId || !prompt) {
            throw new BadRequestException('sessionId and prompt query parameters are required');
        }

        const selectedFramework = framework || 'nextjs';

        return new Observable((observer) => {
            this.agentService.runAgentStream(sessionId, prompt, selectedFramework, (event) => {
                observer.next({ data: event } as MessageEvent);
            }).then(() => {
                observer.complete();
            }).catch(error => {
                observer.error(error);
            });
        });
    }

    @Sse('fast-mode/stream')
    @ApiOperation({
        summary: 'Fast mode code generation with auto error-fixing',
        description: 'Executes code changes directly without planning phase. Automatically builds, detects errors, and fixes them. Streams status updates for building, error detection, and fixing.'
    })
    @ApiQuery({ name: 'sessionId', required: true, description: 'Project session ID' })
    @ApiQuery({ name: 'message', required: true, description: 'User message/request' })
    @ApiQuery({ name: 'framework', required: false, enum: ['react', 'nextjs'], description: 'Project framework' })
    async fastModeStream(
        @Query('sessionId') sessionId: string,
        @Query('message') message: string,
        @Query('framework') framework?: 'react' | 'nextjs'
    ): Promise<Observable<MessageEvent>> {
        if (!sessionId || !message) {
            throw new BadRequestException('sessionId and message query parameters are required');
        }

        const selectedFramework = framework || 'react';

        return new Observable((observer) => {
            (async () => {
                try {
                    for await (const event of this.agentService.runFastModeStream(sessionId, message, selectedFramework)) {
                        observer.next({ data: event } as MessageEvent);
                    }
                    observer.complete();
                } catch (error) {
                    observer.error(error);
                }
            })();
        });
    }
    @Sse('repair/stream')
    @ApiOperation({
        summary: 'Stream dedicated repair mode',
        description: 'Runs a full build, analyzes errors, and attempts to fix them automatically. Streams progress.'
    })
    @ApiQuery({ name: 'sessionId', required: true })
    @ApiQuery({ name: 'framework', required: false, enum: ['react', 'nextjs'] })
    async repairStream(
        @Query('sessionId') sessionId: string,
        @Query('framework') framework?: 'react' | 'nextjs'
    ): Promise<Observable<MessageEvent>> {
        if (!sessionId) {
            throw new BadRequestException('sessionId is required');
        }

        const selectedFramework = framework || 'react';

        return new Observable((observer) => {
            (async () => {
                try {
                    for await (const event of this.agentService.runRepairPhaseStream(sessionId, selectedFramework)) {
                        observer.next({ data: event } as MessageEvent);
                    }
                    observer.complete();
                } catch (error) {
                    observer.error(error);
                }
            })();
        });
    }
}
