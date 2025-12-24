import { Module } from '@nestjs/common';
import { MastraService } from './mastra.service';
import { WorkspaceModule } from '../workspace/workspace.module';
import { ConfigModule } from '@nestjs/config';

@Module({
    imports: [WorkspaceModule, ConfigModule],
    providers: [MastraService],
    exports: [MastraService],
})
export class MastraModule { }
