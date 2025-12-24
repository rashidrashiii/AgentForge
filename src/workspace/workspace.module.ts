import { Module } from '@nestjs/common';
import { WorkspaceService } from './workspace.service';
import { WorkspaceController } from './workspace.controller';

@Module({
    providers: [WorkspaceService],
    controllers: [WorkspaceController],
    exports: [WorkspaceService],
})
export class WorkspaceModule { }
