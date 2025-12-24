import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { LlmModule } from './llm/llm.module';
import { AgentModule } from './agent/agent.module';
import { WorkspaceModule } from './workspace/workspace.module';
import { PersistenceModule } from './persistence/persistence.module';
import { ChatModule } from './chat/chat.module';
import { PreviewModule } from './preview/preview.module';
import { MastraModule } from './mastra/mastra.module';
import { SupabaseModule } from './supabase/supabase.module';
import { ProjectsModule } from './projects/projects.module';
import { BuildModule } from './build/build.module';
import configuration from './config/configuration';

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [configuration],
      isGlobal: true,
    }),
    SupabaseModule,
    BuildModule,
    LlmModule,
    WorkspaceModule,
    AgentModule,
    PersistenceModule,
    ChatModule,
    PreviewModule,
    MastraModule,
    ProjectsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
