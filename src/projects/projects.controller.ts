import { Controller, Get, Post, Patch, Delete, Param, Body, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { SupabaseService, Project } from '../supabase/supabase.service';
import { WorkspaceService } from '../workspace/workspace.service';

class CreateProjectDto {
    name: string;
    description?: string;
    framework?: 'react' | 'nextjs';
}

class UpdateProjectDto {
    name?: string;
    description?: string;
}

@ApiTags('Projects')
@Controller('projects')
export class ProjectsController {
    private readonly logger = new Logger(ProjectsController.name);

    constructor(
        private supabaseService: SupabaseService,
        private workspaceService: WorkspaceService,
    ) { }

    @Get()
    @ApiOperation({ summary: 'List all projects' })
    @ApiResponse({ status: 200, description: 'List of projects' })
    async listProjects() {
        const projects = await this.supabaseService.listProjects();
        return { projects };
    }

    @Post()
    @ApiOperation({ summary: 'Create a new project' })
    @ApiBody({ type: CreateProjectDto })
    @ApiResponse({ status: 201, description: 'Project created' })
    async createProject(@Body() body: CreateProjectDto) {
        const sessionId = body.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)/g, '')
            + '-' + Date.now().toString(36);

        // Create project in database
        const project = await this.supabaseService.createProject({
            name: body.name,
            description: body.description,
            session_id: sessionId,
            framework: body.framework || 'react',
        });

        if (!project) {
            return { error: 'Failed to create project' };
        }

        // Initialize project folder
        try {
            await this.workspaceService.initializeProject(sessionId, project.framework);
        } catch (error) {
            this.logger.error('Failed to initialize project folder', error);
        }

        return { project };
    }

    @Get(':id')
    @ApiOperation({ summary: 'Get project details' })
    @ApiResponse({ status: 200, description: 'Project details with recent chat' })
    async getProject(@Param('id') id: string) {
        const project = await this.supabaseService.getProject(id);
        if (!project) {
            return { error: 'Project not found' };
        }

        const chatHistory = await this.supabaseService.getChatHistory(id);
        const pendingPlan = await this.supabaseService.getPendingPlan(id);

        return {
            project,
            chatHistory: chatHistory.slice(-50), // Last 50 messages
            pendingPlan,
        };
    }

    @Get('session/:sessionId')
    @ApiOperation({ summary: 'Get project by session ID' })
    async getProjectBySession(@Param('sessionId') sessionId: string) {
        const project = await this.supabaseService.getProjectBySessionId(sessionId);
        if (!project) {
            return { error: 'Project not found' };
        }

        const chatHistory = await this.supabaseService.getChatHistory(project.id);
        const pendingPlan = await this.supabaseService.getPendingPlan(project.id);

        return {
            project,
            chatHistory: chatHistory.slice(-50),
            pendingPlan,
        };
    }

    @Patch(':id')
    @ApiOperation({ summary: 'Update project' })
    @ApiBody({ type: UpdateProjectDto })
    async updateProject(@Param('id') id: string, @Body() body: UpdateProjectDto) {
        const project = await this.supabaseService.updateProject(id, {
            name: body.name,
            description: body.description,
        });

        if (!project) {
            return { error: 'Failed to update project' };
        }

        return { project };
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Delete project (soft delete)' })
    async deleteProject(@Param('id') id: string) {
        const success = await this.supabaseService.deleteProject(id);
        return { success };
    }

    @Get(':id/chat')
    @ApiOperation({ summary: 'Get full chat history' })
    async getChatHistory(@Param('id') id: string) {
        const messages = await this.supabaseService.getChatHistory(id);
        return { messages };
    }
}
