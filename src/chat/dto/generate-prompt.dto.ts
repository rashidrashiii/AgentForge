import { ApiProperty } from '@nestjs/swagger';

export class GeneratePromptDto {
    @ApiProperty({ example: 'demo-session', description: 'The unique session ID for the user' })
    sessionId: string;

    @ApiProperty({ example: 'Create a login form', description: 'The instruction for the agent' })
    prompt: string;
}
