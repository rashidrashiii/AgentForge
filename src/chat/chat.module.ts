import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { AgentModule } from '../agent/agent.module';
import { WorkspaceModule } from '../workspace/workspace.module';

@Module({
    imports: [AgentModule, WorkspaceModule],
    controllers: [ChatController],
})
export class ChatModule { }
