import { IsString, IsOptional, IsIn } from 'class-validator';

export class GenerateRequestDto {
    @IsString()
    sessionId: string;

    @IsString()
    prompt: string;

    @IsOptional()
    @IsIn(['react', 'nextjs'])
    framework?: 'react' | 'nextjs';
}
