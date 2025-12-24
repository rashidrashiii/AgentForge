import { Injectable, Logger } from '@nestjs/common';
import { WorkspaceService } from '../workspace/workspace.service';
import { PersistenceService, SessionPlan } from '../persistence/persistence.service';
import { MastraService } from '../mastra/mastra.service';
import { SupabaseService } from '../supabase/supabase.service';
import { BuildValidatorService } from '../build/build-validator.service';
import { DevServerService } from '../preview/dev-server.service';
import { getCodingPrompt, getFastModePrompt, getPlanningPrompt, getVerificationPrompt, getStepCodingPrompt, getErrorFixPrompt } from './prompts';
import * as fs from 'fs-extra';
import * as path from 'path';

@Injectable()
export class AgentService {
    private readonly logger = new Logger(AgentService.name);

    constructor(
        private workspaceService: WorkspaceService,
        private persistenceService: PersistenceService,
        private mastraService: MastraService,
        private supabaseService: SupabaseService,
        private buildValidatorService: BuildValidatorService,
        private devServerService: DevServerService,
    ) { }

    // PHASE 1: PLANNING
    async runPlanningPhase(sessionId: string, userMessage: string, framework: 'react' | 'nextjs' = 'nextjs'): Promise<{ plan: string, phase: string }> {
        this.logger.log(`[PLANNING] Starting for session: ${sessionId}`);

        // Initialize project if needed
        await this.ensureProjectExists(sessionId, framework);

        // Set session state
        await this.persistenceService.setFramework(sessionId, framework);
        await this.persistenceService.setPhase(sessionId, 'planning');
        await this.persistenceService.clearChangedFiles(sessionId);

        // Generate plan
        const planningPrompt = getPlanningPrompt();
        const history = [
            { role: 'system', content: planningPrompt },
            { role: 'user', content: userMessage }
        ];

        const planText = await this.mastraService.generateResponse(sessionId, history, planningPrompt);

        // Parse and store plan
        const plan: SessionPlan = {
            request: userMessage,
            components: this.extractComponents(planText),
            files: this.extractFiles(planText),
            steps: this.extractSteps(planText),
            approved: false
        };

        await this.persistenceService.setPlan(sessionId, plan);
        await this.persistenceService.addMessage(sessionId, { role: 'user', content: userMessage });
        await this.persistenceService.addMessage(sessionId, { role: 'assistant', content: planText });

        // Persistence service now handles DB storage

        this.logger.log(`[PLANNING] Complete. Components: ${plan.components.length}, Steps: ${plan.steps.length}`);

        return { plan: planText, phase: 'awaiting_approval' };
    }

    // PHASE 2: CODING (after plan approval)
    async runCodingPhase(sessionId: string): Promise<string> {
        this.logger.log(`[CODING] Starting for session: ${sessionId}`);

        const plan = await this.persistenceService.getPlan(sessionId);
        if (!plan) {
            throw new Error('No plan found. Run planning phase first.');
        }

        await this.persistenceService.approvePlan(sessionId);
        await this.persistenceService.setPhase(sessionId, 'coding');

        const framework = await this.persistenceService.getFramework(sessionId);
        const planText = this.formatPlan(plan);
        const codingPrompt = getCodingPrompt(framework, planText);

        const history = await this.persistenceService.getHistory(sessionId);
        history.push({ role: 'user', content: 'Proceed with the plan. Implement everything now.' });

        const codeResult = await this.mastraService.generateResponse(sessionId, history, codingPrompt);

        // Track files from AI response
        await this.trackFilesFromResponse(sessionId, codeResult);

        await this.persistenceService.addMessage(sessionId, { role: 'assistant', content: codeResult });

        this.logger.log(`[CODING] Complete`);

        // Automatically run verification
        const verificationResult = await this.runVerificationPhase(sessionId);

        return `${codeResult}\n\n---\n**Verification:** ${verificationResult}`;
    }

    // PHASE 3: VERIFICATION
    async runVerificationPhase(sessionId: string): Promise<string> {
        this.logger.log(`[VERIFICATION] Starting for session: ${sessionId}`);

        await this.persistenceService.setPhase(sessionId, 'verifying');

        const plan = await this.persistenceService.getPlan(sessionId);
        const framework = await this.persistenceService.getFramework(sessionId);
        const { created, modified } = await this.persistenceService.getChangedFiles(sessionId);
        const changedFiles = [...created, ...modified];

        if (!plan) {
            return 'No plan to verify against';
        }

        // Only read changed files (COST OPTIMIZATION!)
        const fileContents: string[] = [];
        for (const file of changedFiles.slice(0, 5)) { // Max 5 files
            try {
                const content = await this.workspaceService.readFile(sessionId, file);
                fileContents.push(`${file}:\n${content.substring(0, 500)}...`);
            } catch { }
        }

        const verificationPrompt = getVerificationPrompt(
            framework,
            this.formatPlan(plan),
            changedFiles
        );

        const verificationContext = `${verificationPrompt}

FILES CONTENT (truncated):
${fileContents.join('\n\n')}`;

        const result = await this.mastraService.generateResponse(
            sessionId,
            [{ role: 'user', content: verificationContext }],
            'Verify and fix'
        );

        await this.persistenceService.setPhase(sessionId, 'complete');
        this.logger.log(`[VERIFICATION] Complete: ${result.substring(0, 100)}...`);

        return result;
    }

    // Legacy method - now runs all three phases
    async runAgent(sessionId: string, userMessage: string, framework: 'react' | 'nextjs' = 'nextjs'): Promise<string> {
        const phase = await this.persistenceService.getPhase(sessionId);

        // If awaiting approval, this means user wants to proceed
        if (phase === 'awaiting_approval') {
            return await this.runCodingPhase(sessionId);
        }

        // For new requests, run planning + coding + verification
        const planResult = await this.runPlanningPhase(sessionId, userMessage, framework);

        // Auto-approve and continue (for backward compatibility)
        return await this.runCodingPhase(sessionId);
    }

    // Helper methods
    private async ensureProjectExists(sessionId: string, framework: 'react' | 'nextjs') {
        const projectPath = this.workspaceService.getProjectPath(sessionId);
        if (!await fs.pathExists(projectPath)) {
            await this.workspaceService.initializeProject(sessionId, framework);
        }
    }

    private extractComponents(planText: string): string[] {
        const match = planText.match(/## Components to Create\n([\s\S]*?)(?=\n## |$)/);
        if (!match) return [];
        return match[1].split('\n').filter(l => l.startsWith('-')).map(l => l.replace(/^- /, '').split(':')[0].trim());
    }

    private extractFiles(planText: string): string[] {
        const match = planText.match(/## Files to Modify\n([\s\S]*?)(?=\n## |$)/);
        if (!match) return [];
        return match[1].split('\n').filter(l => l.startsWith('-')).map(l => l.replace(/^- /, '').split(':')[0].trim());
    }

    private extractSteps(planText: string): string[] {
        const match = planText.match(/## Implementation Steps\n([\s\S]*?)(?=\n## |$)/);
        if (!match) return [];
        return match[1].split('\n').filter(l => /^\d+\./.test(l)).map(l => l.replace(/^\d+\.\s*/, '').trim());
    }

    private formatPlan(plan: SessionPlan): string {
        return `Request: ${plan.request}
Components: ${plan.components.join(', ')}
Files: ${plan.files.join(', ')}
Steps: ${plan.steps.join('; ')}`;
    }

    private async trackFilesFromResponse(sessionId: string, response: string) {
        // Extract file paths mentioned in writeFile/editFile calls
        const writeMatches = response.matchAll(/writeFile\s*\(\s*["']([^"']+)["']/g);
        const editMatches = response.matchAll(/editFile\s*\(\s*["']([^"']+)["']/g);

        for (const match of writeMatches) {
            await this.persistenceService.trackFileCreated(sessionId, match[1]);
        }
        for (const match of editMatches) {
            await this.persistenceService.trackFileModified(sessionId, match[1]);
        }

        // Also track common patterns
        if (response.includes('Hero.tsx')) await this.persistenceService.trackFileCreated(sessionId, 'src/components/Hero.tsx');
        if (response.includes('Index.tsx') && response.includes('updated')) {
            await this.persistenceService.trackFileModified(sessionId, 'src/pages/Index.tsx');
        }
        if (response.includes('page.tsx') && response.includes('updated')) {
            await this.persistenceService.trackFileModified(sessionId, 'app/page.tsx');
        }
    }

    // Streaming support for planning phase
    async runPlanningPhaseStream(
        sessionId: string,
        userMessage: string,
        framework: 'react' | 'nextjs' = 'nextjs',
        onEvent: (event: any) => void
    ): Promise<void> {
        onEvent({ type: 'status', message: 'Initializing project...' });
        await this.ensureProjectExists(sessionId, framework);

        await this.persistenceService.setFramework(sessionId, framework);
        await this.persistenceService.setPhase(sessionId, 'planning');
        await this.persistenceService.clearChangedFiles(sessionId);

        onEvent({ type: 'status', message: 'AI is creating a plan...' });

        // Generate plan (using streaming)
        const planningPrompt = getPlanningPrompt();

        // Get existing history from persistence
        const existingHistory = await this.persistenceService.getHistory(sessionId);

        const history = [
            { role: 'system', content: planningPrompt },
            ...existingHistory, // usage of existing history
            { role: 'user', content: userMessage }
        ];

        let planText = '';

        // Use generator to stream chunks
        for await (const chunk of this.mastraService.generateResponseStream(sessionId, history, planningPrompt, { enableTools: false })) {
            planText += chunk;
            onEvent({ type: 'chunk', content: chunk });
        }

        const plan: SessionPlan = {
            request: userMessage,
            components: this.extractComponents(planText),
            files: this.extractFiles(planText),
            steps: this.extractSteps(planText),
            approved: false
        };

        await this.persistenceService.setPlan(sessionId, plan);
        // Add only the new interaction to persistence
        await this.persistenceService.addMessage(sessionId, { role: 'user', content: userMessage });
        await this.persistenceService.addMessage(sessionId, { role: 'assistant', content: planText });

        onEvent({ type: 'status', message: 'Plan ready for approval' });
        onEvent({ type: 'complete', phase: 'awaiting_approval', plan: planText });
    }

    // Streaming support for coding + verification phase
    async runCodingPhaseStream(
        sessionId: string,
        onEvent: (event: any) => void
    ): Promise<void> {
        const plan = await this.persistenceService.getPlan(sessionId);
        if (!plan) {
            throw new Error('No plan found. Run planning phase first.');
        }

        onEvent({ type: 'status', message: 'Plan approved, starting coding...' });

        await this.persistenceService.approvePlan(sessionId);
        await this.persistenceService.setPhase(sessionId, 'coding');

        const framework = await this.persistenceService.getFramework(sessionId);
        const planText = this.formatPlan(plan);
        // Removed single coding prompt

        onEvent({ type: 'status', message: 'Starting iterative implementation...' });

        const history = await this.persistenceService.getHistory(sessionId);

        // Execute plan step-by-step
        for (let i = 0; i < plan.steps.length; i++) {
            const step = plan.steps[i];
            const stepNumber = i + 1;
            const totalSteps = plan.steps.length;

            onEvent({ type: 'status', message: `Implementing step ${stepNumber}/${totalSteps}: ${step}` });

            const stepPrompt = getStepCodingPrompt(step, planText, framework);

            // Add step instruction to history
            history.push({ role: 'user', content: `Implement Step ${stepNumber}: ${step}` });

            try {
                let currentStepResult = '';
                for await (const chunk of this.mastraService.generateResponseStream(sessionId, history, stepPrompt)) {
                    currentStepResult += chunk;
                    onEvent({ type: 'chunk', content: chunk });
                }

                // Track files from AI response
                await this.trackFilesFromResponse(sessionId, currentStepResult);

                // Add response to history for next step context
                history.push({ role: 'assistant', content: currentStepResult });
                await this.persistenceService.addMessage(sessionId, { role: 'assistant', content: currentStepResult });

                onEvent({ type: 'chunk', content: `\n\n**Step ${stepNumber} Complete:**\n${currentStepResult}\n` });

            } catch (error) {
                this.logger.error(`Failed to execute step ${stepNumber}:`, error);
                onEvent({ type: 'chunk', content: `\n\n⚠️ Error in step ${stepNumber}: ${error.message}\n` });
                // We continue to next step even if one fails
            }
        }

        onEvent({ type: 'status', message: 'Implementation steps complete, verifying...' });

        try {


            // FINISHED - Non-blocking verification
            onEvent({ type: 'status', message: '✅ Generation complete. Running background checks...' });

            // Trigger background verification (fire and forget)
            this.runBackgroundVerifyAndFix(sessionId, framework).catch(e =>
                this.logger.error('Background verification failed', e)
            );

            // Immediately yield completion to unblock UI
            onEvent({ type: 'complete', message: 'Code generated. Verifying in background...' });

            // Phase 4: Auto-start dev server (already running likely, but ensure)
            // await this.devServerService.startDevServer(sessionId, framework);
            // await this.supabaseService.updateProjectPhase(sessionId, 'complete');

            // PHASE 4: AUTO-START DEV SERVER (Non-blocking)
            // Just start the server so the user can see the preview immediately
            onEvent({ type: 'status', message: '🚀 Starting dev server...' });
            await this.devServerService.startDevServer(sessionId, framework);

            // Update phase to complete
            await this.supabaseService.updateProjectPhase(sessionId, 'complete');


        } catch (error) {
            this.logger.error(`Coding phase failed: ${error.message}`);
            throw error;
        }
    }

    // FAST MODE: Direct execution with auto error-fixing
    async *runFastModeStream(sessionId: string, userMessage: string, framework: 'react' | 'nextjs') {
        this.logger.log(`[FAST MODE] Starting for session: ${sessionId}`);
        yield { type: 'status', message: '⚡ Generating code...' };

        // Ensure project exists
        await this.ensureProjectExists(sessionId, framework);

        // Execute code directly (no planning)
        const fastPrompt = getFastModePrompt(userMessage, framework);

        // Get existing history from persistence
        const existingHistory = await this.persistenceService.getHistory(sessionId);

        // Create a temporary history for this run
        const history = [
            ...existingHistory,
            // { role: 'system', content: fastPrompt }, // System prompt is now handled in getFastModePrompt
            { role: 'system', content: fastPrompt },
            { role: 'user', content: userMessage }
        ];

        // Store user message in persistence first - handled by chat controller? 
        // No, we should store it here to be safe and consistent
        await this.persistenceService.addMessage(sessionId, { role: 'user', content: userMessage });


        let response = '';

        try {
            for await (const chunk of this.mastraService.generateResponseStream(sessionId, history, fastPrompt)) {
                response += chunk;
                yield { type: 'chunk', content: chunk };
            }
        } catch (error) {
            yield { type: 'error', message: error.message };
            return;
        }

        // Store response in persistence
        await this.persistenceService.addMessage(sessionId, { role: 'assistant', content: response });

        yield { type: 'changes', message: 'Code updated' };

        // Start dev server immediately
        yield { type: 'status', message: '🚀 Starting dev server...' };
        await this.devServerService.startDevServer(sessionId, framework);

        yield { type: 'complete', message: '✅ Done!' };
    }

    // ON-DEMAND REPAIR MODE: Fix build errors explicitly
    async *runRepairPhaseStream(sessionId: string, framework: 'react' | 'nextjs') {
        this.logger.log(`[REPAIR MODE] Starting for session: ${sessionId}`);

        yield { type: 'status', message: '🔍 Analyzing project...' };
        yield { type: 'chunk', content: '**Repair Agent:** Analyzing project state...\n' };

        // 1. Build validation
        yield { type: 'status', message: '🔨 Running build...' };
        const buildResult = await this.buildValidatorService.buildProject(sessionId);

        let combinedErrors: string[] = [];

        if (buildResult.success) {
            yield { type: 'chunk', content: '✅ Build passed successfully. Checking runtime logs...\n' };
            const runtimeLogs = this.devServerService.getRuntimeLogs(sessionId);

            if (runtimeLogs.length > 0) {
                yield { type: 'status', message: '⚠️ Runtime errors found...' };
                yield { type: 'chunk', content: `⚠️ **Found ${runtimeLogs.length} runtime errors**\n` };
                combinedErrors = runtimeLogs;
            }

        } else {
            yield { type: 'status', message: '⚠️ Build errors found...' };
            yield { type: 'chunk', content: `⚠️ **Found ${buildResult.errors.length} build errors**\n` };
            // Also add runtime logs if any
            const runtimeLogs = this.devServerService.getRuntimeLogs(sessionId);
            combinedErrors = [...buildResult.errors, ...runtimeLogs];
        }

        if (combinedErrors.length === 0) {
            yield { type: 'chunk', content: '✅ No errors found! Project is healthy.\n' };
            yield { type: 'status', message: 'Ready' };
            return;
        }

        yield { type: 'error', errors: combinedErrors };

        // 2. Fix Loop
        yield { type: 'status', message: '🔧 Applying fixes...' };

        // Use our existing auto-fix logic but wrapped in the repair agent persona
        const fixResult = await this.autoFixErrors(sessionId, combinedErrors, 'build', framework);

        if (fixResult.success) {
            yield { type: 'chunk', content: '✅ Fixes applied. Verifying build...\n' };
            yield { type: 'status', message: '🔨 Verifying fix...' };

            const rebuildResult = await this.buildValidatorService.buildProject(sessionId);
            if (rebuildResult.success) {
                yield { type: 'chunk', content: '🎉 **Build Fixed!** Project is healthy.\n' };
                yield { type: 'status', message: '✅ Fixed' };
            } else {
                yield { type: 'chunk', content: '❌ Fix attempt failed. Some errors remain.\n' };
                yield { type: 'error', errors: rebuildResult.errors };
            }
        } else {
            yield { type: 'chunk', content: '❌ Could not automatically fix errors.\n' };
        }


        // Ensure dev server is running at the end
        await this.devServerService.startDevServer(sessionId, framework);
        yield { type: 'complete', message: 'done' };
    }

    // Auto-fix build or runtime errors using AI with FULL CONTEXT
    private async autoFixErrors(
        sessionId: string,
        errors: string[],
        errorType: 'build' | 'runtime' | 'background',
        framework: 'react' | 'nextjs'
    ): Promise<{ success: boolean }> {
        try {
            // 1. Gather Context
            // Always get package.json
            let packageJson = '';
            try {
                packageJson = await this.workspaceService.readFile(sessionId, 'package.json');
            } catch (e) {
                this.logger.warn('Could not read package.json for auto-fix context');
            }

            // Extract relevant files from errors
            const filesToRead = new Set<string>();

            // 1. Match relative src paths
            const relativeMatches = errors.join('\n').matchAll(/(src\/[a-zA-Z0-9_\-\/]+\.(tsx|ts|js|jsx|css))/g);
            for (const match of relativeMatches) {
                filesToRead.add(match[1]);
            }

            // 2. Match absolute paths (common in build tools)
            // Look for paths starting with /Users, /home, /opt, or just / and having an extension
            const absoluteMatches = errors.join('\n').matchAll(/((?:\/[a-zA-Z0-9_\-\.]+)+\.(tsx|ts|js|jsx|css))/g);
            for (const match of absoluteMatches) {
                // Check if path belongs to project? For now just try to read it.
                // WorkspaceService might handle absolute paths if they are valid.
                filesToRead.add(match[1]);
            }

            // Read content of relevant files
            const filesContext: Record<string, string> = {};
            for (const filePath of filesToRead) {
                try {
                    const content = await this.workspaceService.readFile(sessionId, filePath);
                    filesContext[filePath] = content;
                } catch (e) {
                    // Ignore missing files
                }
            }

            // 2. Construct Prompt
            let contextStr = `Current package.json:\n\`\`\`json\n${packageJson}\n\`\`\`\n\n`;

            if (Object.keys(filesContext).length > 0) {
                contextStr += `Relevant File Contents:\n`;
                for (const [path, content] of Object.entries(filesContext)) {
                    contextStr += `File: ${path}\n\`\`\`\n${content}\n\`\`\`\n\n`;
                }
            }

            const fixPrompt = getErrorFixPrompt(errors);
            const history = [
                { role: 'system', content: fixPrompt },
                {
                    role: 'user',
                    content: `CONTEXT:\n${contextStr}\n\nERRORS:\n${errors.join('\n\n')}\n\nTask: Fix these ${errorType} errors. Use run_command if you need to install dependencies.`
                }
            ];

            await this.mastraService.generateResponse(sessionId, history, fixPrompt);
            return { success: true };
        } catch (error) {
            this.logger.error(`Failed to auto-fix ${errorType} errors:`, error);
            return { success: false };
        }
    }

    // Background Verification & Fix (Non-Blocking)
    private async runBackgroundVerifyAndFix(sessionId: string, framework: 'react' | 'nextjs') {
        this.logger.log(`[BACKGROUND] Starting verification for ${sessionId}`);

        // Wait a moment for dev server to catch up
        await new Promise(r => setTimeout(r, 2000));

        const buildResult = await this.buildValidatorService.buildProject(sessionId);
        const runtimeLogs = this.devServerService.getRuntimeLogs(sessionId);
        const combinedErrors = [...(buildResult.success ? [] : buildResult.errors), ...runtimeLogs];

        if (combinedErrors.length > 0) {
            this.logger.log(`[BACKGROUND] Found ${combinedErrors.length} errors. Attempting auto-fix...`);
            // Attempt fix
            await this.autoFixErrors(sessionId, combinedErrors, 'background', framework);
            // Re-check?
        } else {
            this.logger.log(`[BACKGROUND] Project clean.`);
        }
    }

    // Helper: Save chat message to Supabase
    private async saveChatToSupabase(sessionId: string, role: 'user' | 'assistant' | 'system', content: string, phase?: string): Promise<void> {
        try {
            const project = await this.supabaseService.getProjectBySessionId(sessionId);
            if (project) {
                await this.supabaseService.addChatMessage(project.id, { role, content, phase });
            }
        } catch (error) {
            this.logger.warn('Failed to save chat to Supabase:', error);
        }
    }

    // Legacy streaming (runs all phases)
    async runAgentStream(sessionId: string, userMessage: string, framework: 'react' | 'nextjs' = 'nextjs', onEvent: (event: any) => void): Promise<void> {
        await this.runPlanningPhaseStream(sessionId, userMessage, framework, onEvent);
        await this.runCodingPhaseStream(sessionId, onEvent);
    }
}

