import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { WorkspaceService } from './workspace.service';

@ApiTags('Workspace')
@Controller('session')
export class WorkspaceController {
    constructor(private readonly workspaceService: WorkspaceService) { }

    @Get(':id/files')
    @ApiOperation({ summary: 'List all files in a project session' })
    @ApiResponse({ status: 200, description: 'List of file paths' })
    async listFiles(@Param('id') id: string) {
        try {
            return await this.workspaceService.listFiles(id);
        } catch (e) {
            return []; // Return empty if not initialized
        }
    }
}
