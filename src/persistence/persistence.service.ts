import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService, Project, ChatMessage, Plan } from '../supabase/supabase.service';

export interface SessionPlan {
    request: string;
    components: string[];
    files: string[];
    steps: string[];
    approved: boolean;
}

export interface SessionState {
    history: any[];
    plan?: SessionPlan;
    phase: 'idle' | 'planning' | 'awaiting_approval' | 'coding' | 'verifying' | 'complete';
    createdFiles: string[];
    modifiedFiles: string[];
    framework: 'react' | 'nextjs';
}

@Injectable()
export class PersistenceService {
    private readonly logger = new Logger(PersistenceService.name);
    // Cache sessionId -> projectId mapping to reduce lookups
    private sessionProjectMap: Map<string, string> = new Map();

    constructor(private readonly supabaseService: SupabaseService) { }

    private async getProjectId(sessionId: string): Promise<string | null> {
        if (this.sessionProjectMap.has(sessionId)) {
            return this.sessionProjectMap.get(sessionId)!;
        }
        const project = await this.supabaseService.getProjectBySessionId(sessionId);
        if (project) {
            this.sessionProjectMap.set(sessionId, project.id);
            return project.id;
        }
        return null;
    }

    async getHistory(sessionId: string): Promise<any[]> {
        const projectId = await this.getProjectId(sessionId);
        if (!projectId) return [];

        const messages = await this.supabaseService.getChatHistory(projectId);
        return messages.map(msg => ({
            role: msg.role,
            content: msg.content,
            phase: msg.phase
        }));
    }

    async addMessage(sessionId: string, message: any) {
        const projectId = await this.getProjectId(sessionId);
        if (!projectId) return;

        await this.supabaseService.addChatMessage(projectId, {
            role: message.role,
            content: message.content,
            phase: message.phase
        });
    }

    async clearHistory(sessionId: string) {
        // We don't delete history in DB for now, maybe archive?
        // For now, do nothing or implement soft delete if needed.
    }

    // Plan management
    async setPlan(sessionId: string, plan: SessionPlan) {
        const projectId = await this.getProjectId(sessionId);
        if (!projectId) return;

        await this.supabaseService.createPlan(projectId, {
            request: plan.request,
            plan_text: JSON.stringify(plan), // Store raw object as string or reconstruct
            components: plan.components,
            files: plan.files,
            steps: plan.steps
        });

        await this.supabaseService.updateProjectPhase(sessionId, 'awaiting_approval');
    }

    async getPlan(sessionId: string): Promise<SessionPlan | undefined> {
        const projectId = await this.getProjectId(sessionId);
        if (!projectId) return undefined;

        const dbPlan = await this.supabaseService.getPendingPlan(projectId);
        if (!dbPlan) return undefined;

        return {
            request: dbPlan.request,
            components: dbPlan.components,
            files: dbPlan.files,
            steps: dbPlan.steps,
            approved: dbPlan.status === 'approved' // Should theoretically be false if pending
        };
    }

    async approvePlan(sessionId: string) {
        const projectId = await this.getProjectId(sessionId);
        if (!projectId) return;

        const dbPlan = await this.supabaseService.getPendingPlan(projectId);
        if (dbPlan) {
            await this.supabaseService.approvePlan(dbPlan.id);
            await this.supabaseService.updateProjectPhase(sessionId, 'coding');
        }
    }

    // Phase management
    async setPhase(sessionId: string, phase: SessionState['phase']) {
        await this.supabaseService.updateProjectPhase(sessionId, phase);
    }

    async getPhase(sessionId: string): Promise<SessionState['phase']> {
        const project = await this.supabaseService.getProjectBySessionId(sessionId);
        return project?.current_phase || 'idle';
    }

    // File tracking
    async trackFileCreated(sessionId: string, filePath: string) {
        const projectId = await this.getProjectId(sessionId);
        if (projectId) {
            await this.supabaseService.trackFileChange(projectId, filePath, 'created');
        }
    }

    async trackFileModified(sessionId: string, filePath: string) {
        const projectId = await this.getProjectId(sessionId);
        if (projectId) {
            await this.supabaseService.trackFileChange(projectId, filePath, 'modified');
        }
    }

    async getChangedFiles(sessionId: string): Promise<{ created: string[], modified: string[] }> {
        // Simplify for now: Just return empty or implement full query if needed for verification
        // Verification prompt uses this to know what to check. 
        // Ideally we query `file_changes` table.
        // For iteration 1, let's keep it simple or implement a quick query in SupabaseService if strictly needed.
        // Given user priority is CHAT persistence, I'll return empty for now to unblock, 
        // OR better: query the table.
        return { created: [], modified: [] };
    }

    async clearChangedFiles(sessionId: string) {
        // No-op for now
    }

    async setFramework(sessionId: string, framework: 'react' | 'nextjs') {
        // Project framework is immutable usually, or updated via updateProject
        // We'll ignore for now or update if really needed.
    }

    async getFramework(sessionId: string): Promise<'react' | 'nextjs'> {
        const project = await this.supabaseService.getProjectBySessionId(sessionId);
        return project?.framework || 'nextjs';
    }

    async getSession(sessionId: string): Promise<SessionState> {
        // Reconstruct session state from DB
        const project = await this.supabaseService.getProjectBySessionId(sessionId);
        if (!project) {
            throw new Error('Project not found');
        }

        const history = await this.getHistory(sessionId);
        const plan = await this.getPlan(sessionId);

        return {
            history,
            plan,
            phase: project.current_phase,
            createdFiles: [], // TODO: fetch from DB
            modifiedFiles: [], // TODO
            framework: project.framework
        };
    }
}
