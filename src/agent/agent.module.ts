import { Module } from '@nestjs/common';
import { AgentService } from './agent.service';
import { LlmModule } from '../llm/llm.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { PersistenceModule } from '../persistence/persistence.module';
import { MastraModule } from '../mastra/mastra.module';
import { BuildModule } from '../build/build.module';
import { PreviewModule } from '../preview/preview.module';

@Module({
    imports: [LlmModule, WorkspaceModule, PersistenceModule, MastraModule, BuildModule, PreviewModule],
    providers: [AgentService],
    exports: [AgentService],
})
export class AgentModule { }
