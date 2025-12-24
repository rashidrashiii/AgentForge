import { Injectable, Logger } from '@nestjs/common';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { ChildProcess } from 'child_process';

const execAsync = promisify(exec);

export interface BuildResult {
    success: boolean;
    errors: string[];
    output: string;
}

@Injectable()
export class BuildValidatorService {
    private readonly logger = new Logger(BuildValidatorService.name);

    /**
     * Run build and capture errors
     */
    async buildProject(sessionId: string): Promise<BuildResult> {
        const projectPath = path.join(process.cwd(), 'projects', sessionId);

        try {
            this.logger.log(`Building project ${sessionId}...`);

            const { stdout, stderr } = await execAsync('pnpm build', {
                cwd: projectPath,
                timeout: 60000, // 1 minute timeout
                env: { ...process.env, NODE_ENV: 'production' },
            });

            const output = stdout + stderr;
            const errors = this.parseBuildErrors(output);

            if (errors.length > 0) {
                this.logger.warn(`Build errors found in ${sessionId}`);
                return {
                    success: false,
                    errors,
                    output,
                };
            }

            this.logger.log(`Build successful for ${sessionId}`);
            return {
                success: true,
                errors: [],
                output,
            };
        } catch (error) {
            this.logger.error(`Build failed for ${sessionId}:`, error.message);

            const output = (error.stdout || '') + (error.stderr || '');
            const errors = this.parseBuildErrors(output);

            return {
                success: false,
                errors: errors.length > 0 ? errors : [error.message],
                output,
            };
        }
    }

    /**
     * Parse TypeScript/Vite build errors from output
     */
    private parseBuildErrors(output: string): string[] {
        const errors: string[] = [];
        const lines = output.split('\n');

        let currentError: string[] = [];
        let inErrorBlock = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // TypeScript error pattern: "src/App.tsx:10:5 - error TS2304:"
            // Vite error pattern: "[vite] error"
            // ESLint error pattern: "error  'foo' is not defined"
            const isErrorStart =
                /error TS\d+:/i.test(line) ||
                /\[vite\].*error/i.test(line) ||
                /^\s*error\s+/i.test(line) ||
                /✘ \[ERROR\]/i.test(line);

            if (isErrorStart) {
                // Save previous error if exists
                if (currentError.length > 0) {
                    errors.push(currentError.join('\n').trim());
                }

                // Start new error block
                currentError = [line];
                inErrorBlock = true;
            } else if (inErrorBlock) {
                // Continue collecting error lines
                const isBlankLine = line.trim() === '';
                const isNewSection = /^(Pages:|Routes:|Warning:)/i.test(line);

                if (isBlankLine && currentError.length > 3) {
                    // End of error block
                    errors.push(currentError.join('\n').trim());
                    currentError = [];
                    inErrorBlock = false;
                } else if (!isNewSection) {
                    currentError.push(line);
                }

                // Limit error block size
                if (currentError.length > 15) {
                    errors.push(currentError.join('\n').trim());
                    currentError = [];
                    inErrorBlock = false;
                }
            }
        }

        // Add last error if exists
        if (currentError.length > 0) {
            errors.push(currentError.join('\n').trim());
        }

        return errors;
    }

    /**
     * Monitor dev server console for runtime errors
     */
    async monitorRuntimeErrors(
        sessionId: string,
        devServerProcess: ChildProcess | null,
        durationMs: number = 5000
    ): Promise<string[]> {
        if (!devServerProcess) {
            return [];
        }

        const errors: string[] = [];

        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                resolve(errors);
            }, durationMs);

            const stderrHandler = (data: Buffer) => {
                const lines = data.toString().split('\n');

                for (const line of lines) {
                    // React errors
                    if (line.includes('Error:') ||
                        line.includes('TypeError:') ||
                        line.includes('ReferenceError:') ||
                        line.includes('SyntaxError:') ||
                        line.includes('Uncaught')) {
                        errors.push(line.trim());
                    }
                }
            };

            const stdoutHandler = (data: Buffer) => {
                const lines = data.toString().split('\n');

                for (const line of lines) {
                    // Console errors from the app
                    if (line.includes('console.error') ||
                        line.includes('[ERROR]') ||
                        line.toLowerCase().includes('failed to compile')) {
                        errors.push(line.trim());
                    }
                }
            };

            devServerProcess.stderr?.on('data', stderrHandler);
            devServerProcess.stdout?.on('data', stdoutHandler);

            // Cleanup listeners after timeout
            setTimeout(() => {
                devServerProcess.stderr?.off('data', stderrHandler);
                devServerProcess.stdout?.off('data', stdoutHandler);
            }, durationMs);
        });
    }
}
