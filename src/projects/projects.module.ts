import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { WorkspaceModule } from '../workspace/workspace.module';

@Module({
    imports: [WorkspaceModule],
    controllers: [ProjectsController],
})
export class ProjectsModule { }
