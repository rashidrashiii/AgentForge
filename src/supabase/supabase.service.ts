import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface Project {
    id: string;
    name: string;
    description: string | null;
    session_id: string;
    framework: 'react' | 'nextjs';
    status: 'active' | 'building' | 'error' | 'archived';
    current_phase: 'idle' | 'planning' | 'awaiting_approval' | 'coding' | 'verifying' | 'complete';
    metadata: Record<string, unknown>;
    created_at: string;
    updated_at: string;
    last_activity_at: string;
    deleted_at: string | null;
}

export interface ChatMessage {
    id: string;
    project_id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    phase: string | null;
    metadata: Record<string, unknown>;
    created_at: string;
}

export interface Plan {
    id: string;
    project_id: string;
    request: string;
    plan_text: string;
    components: string[];
    files: string[];
    steps: string[];
    status: 'pending' | 'approved' | 'rejected' | 'superseded';
    approved_at: string | null;
    created_at: string;
}

@Injectable()
export class SupabaseService implements OnModuleInit {
    private client: SupabaseClient;
    private readonly logger = new Logger(SupabaseService.name);

    constructor(private configService: ConfigService) { }

    onModuleInit() {
        const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
        const supabaseKey = this.configService.get<string>('SUPABASE_SERVICE_KEY');

        if (!supabaseUrl || !supabaseKey) {
            this.logger.warn('Supabase credentials not configured. Database features disabled.');
            return;
        }

        this.client = createClient(supabaseUrl, supabaseKey);
        this.logger.log('Supabase client initialized');
    }

    get isConfigured(): boolean {
        return !!this.client;
    }

    // ==================== PROJECTS ====================

    async listProjects(): Promise<Project[]> {
        if (!this.client) return [];

        const { data, error } = await this.client
            .from('projects')
            .select('*')
            .is('deleted_at', null)
            .order('updated_at', { ascending: false });

        if (error) {
            this.logger.error('Failed to list projects', error);
            return [];
        }
        return data || [];
    }

    async getProject(id: string): Promise<Project | null> {
        if (!this.client) return null;

        const { data, error } = await this.client
            .from('projects')
            .select('*')
            .eq('id', id)
            .is('deleted_at', null)
            .single();

        if (error) {
            this.logger.error(`Failed to get project ${id}`, error);
            return null;
        }
        return data;
    }

    async getProjectBySessionId(sessionId: string): Promise<Project | null> {
        if (!this.client) return null;

        const { data, error } = await this.client
            .from('projects')
            .select('*')
            .eq('session_id', sessionId)
            .is('deleted_at', null)
            .single();

        if (error && error.code !== 'PGRST116') { // Not found is ok
            this.logger.error(`Failed to get project by session ${sessionId}`, error);
        }
        return data || null;
    }

    async createProject(project: Partial<Project>): Promise<Project | null> {
        if (!this.client) return null;

        const { data, error } = await this.client
            .from('projects')
            .insert({
                name: project.name || 'Untitled Project',
                description: project.description || null,
                session_id: project.session_id,
                framework: project.framework || 'react',
                status: 'active',
                current_phase: 'idle',
                metadata: {},
            })
            .select()
            .single();

        if (error) {
            this.logger.error('Failed to create project', error);
            return null;
        }
        return data;
    }

    async updateProject(id: string, updates: Partial<Project>): Promise<Project | null> {
        if (!this.client) return null;

        const { data, error } = await this.client
            .from('projects')
            .update({
                ...updates,
                last_activity_at: new Date().toISOString(),
            })
            .eq('id', id)
            .select()
            .single();

        if (error) {
            this.logger.error(`Failed to update project ${id}`, error);
            return null;
        }
        return data;
    }

    async updateProjectPhase(sessionId: string, phase: Project['current_phase']): Promise<void> {
        if (!this.client) return;

        await this.client
            .from('projects')
            .update({
                current_phase: phase,
                last_activity_at: new Date().toISOString(),
            })
            .eq('session_id', sessionId);
    }

    async deleteProject(id: string): Promise<boolean> {
        if (!this.client) return false;

        const { error } = await this.client
            .from('projects')
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', id);

        if (error) {
            this.logger.error(`Failed to delete project ${id}`, error);
            return false;
        }
        return true;
    }

    // ==================== CHAT MESSAGES ====================

    async getChatHistory(projectId: string): Promise<ChatMessage[]> {
        if (!this.client) return [];

        const { data, error } = await this.client
            .from('chat_messages')
            .select('*')
            .eq('project_id', projectId)
            .order('created_at', { ascending: true });

        if (error) {
            this.logger.error(`Failed to get chat history for ${projectId}`, error);
            return [];
        }
        return data || [];
    }

    async addChatMessage(projectId: string, message: Partial<ChatMessage>): Promise<ChatMessage | null> {
        if (!this.client) return null;

        const { data, error } = await this.client
            .from('chat_messages')
            .insert({
                project_id: projectId,
                role: message.role,
                content: message.content,
                phase: message.phase || null,
                metadata: message.metadata || {},
            })
            .select()
            .single();

        if (error) {
            this.logger.error('Failed to add chat message', error);
            return null;
        }

        // Update project last activity
        await this.client
            .from('projects')
            .update({ last_activity_at: new Date().toISOString() })
            .eq('id', projectId);

        return data;
    }

    // ==================== PLANS ====================

    async getPendingPlan(projectId: string): Promise<Plan | null> {
        if (!this.client) return null;

        const { data, error } = await this.client
            .from('plans')
            .select('*')
            .eq('project_id', projectId)
            .eq('status', 'pending')
            .single();

        if (error && error.code !== 'PGRST116') {
            this.logger.error(`Failed to get pending plan for ${projectId}`, error);
        }
        return data || null;
    }

    async createPlan(projectId: string, plan: Partial<Plan>): Promise<Plan | null> {
        if (!this.client) return null;

        // Supersede any existing pending plans
        await this.client
            .from('plans')
            .update({ status: 'superseded' })
            .eq('project_id', projectId)
            .eq('status', 'pending');

        const { data, error } = await this.client
            .from('plans')
            .insert({
                project_id: projectId,
                request: plan.request,
                plan_text: plan.plan_text,
                components: plan.components || [],
                files: plan.files || [],
                steps: plan.steps || [],
                status: 'pending',
            })
            .select()
            .single();

        if (error) {
            this.logger.error('Failed to create plan', error);
            return null;
        }
        return data;
    }

    async approvePlan(planId: string): Promise<boolean> {
        if (!this.client) return false;

        const { error } = await this.client
            .from('plans')
            .update({
                status: 'approved',
                approved_at: new Date().toISOString(),
            })
            .eq('id', planId);

        if (error) {
            this.logger.error(`Failed to approve plan ${planId}`, error);
            return false;
        }
        return true;
    }

    // ==================== FILE CHANGES ====================

    async trackFileChange(
        projectId: string,
        filePath: string,
        changeType: 'created' | 'modified' | 'deleted',
        planId?: string
    ): Promise<void> {
        if (!this.client) return;

        await this.client
            .from('file_changes')
            .insert({
                project_id: projectId,
                plan_id: planId || null,
                file_path: filePath,
                change_type: changeType,
            });
    }
}
