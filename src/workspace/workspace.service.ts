import { Injectable, BadRequestException } from '@nestjs/common';
import * as fs from 'fs-extra';
import * as path from 'path';

@Injectable()
export class WorkspaceService {
    private readonly projectsDir = path.resolve(process.cwd(), 'projects');
    private readonly templatesDir = path.resolve(process.cwd(), 'templates');

    async initializeProject(sessionId: string, framework: 'react' | 'nextjs' = 'nextjs') {
        const projectPath = this.getProjectPath(sessionId);
        const templatePath = path.join(this.templatesDir, `${framework}-scaffold`);

        if (await fs.pathExists(projectPath)) {
            throw new BadRequestException('Project already exists for this session');
        }

        // Verify template exists
        if (!await fs.pathExists(templatePath)) {
            throw new BadRequestException(`Template for framework '${framework}' not found`);
        }

        try {
            // Copy scaffold but exclude build artifacts
            await fs.copy(templatePath, projectPath, {
                filter: (src) => {
                    // Exclude .next, node_modules, and other build artifacts
                    const relativePath = path.relative(templatePath, src);
                    return !relativePath.includes('.next') &&
                        !relativePath.includes('node_modules') &&
                        !relativePath.startsWith('.turbo') &&
                        !relativePath.includes('dist');
                }
            });
            return { message: 'Project initialized', path: projectPath, framework };
        } catch (error) {
            throw new Error(`Failed to initialize project: ${error.message}`);
        }
    }

    async listFiles(sessionId: string) {
        const projectPath = this.getProjectPath(sessionId);
        if (!(await fs.pathExists(projectPath))) {
            throw new BadRequestException('Project not found');
        }

        const files: string[] = [];

        const traverse = async (currentPath: string) => {
            const entries = await fs.readdir(currentPath, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(currentPath, entry.name);
                const relativePath = path.relative(projectPath, fullPath);

                if (entry.name === 'node_modules' || entry.name === '.git') continue;

                if (entry.isDirectory()) {
                    await traverse(fullPath);
                } else {
                    files.push(relativePath);
                }
            }
        };

        await traverse(projectPath);
        return files;
    }

    async readFile(sessionId: string, filePath: string) {
        const fullPath = this.getSecurePath(sessionId, filePath);
        if (!(await fs.pathExists(fullPath))) {
            throw new BadRequestException('File not found');
        }
        return fs.readFile(fullPath, 'utf8');
    }

    async writeFile(sessionId: string, filePath: string, content: string) {
        const fullPath = this.getSecurePath(sessionId, filePath);
        await fs.ensureDir(path.dirname(fullPath));
        await fs.writeFile(fullPath, content, 'utf8');
        return { message: 'File written successfully' };
    }


    async editFile(sessionId: string, filePath: string, searchString: string, replaceString: string) {
        const fullPath = this.getSecurePath(sessionId, filePath);
        if (!(await fs.pathExists(fullPath))) {
            throw new BadRequestException('File not found');
        }
        const content = await fs.readFile(fullPath, 'utf8');
        if (!content.includes(searchString)) {
            throw new BadRequestException('Search string not found in file');
        }
        const newContent = content.replace(searchString, replaceString);
        await fs.writeFile(fullPath, newContent, 'utf8');
        return { message: 'File edited successfully' };
    }

    async deleteFile(sessionId: string, filePath: string) {
        const fullPath = this.getSecurePath(sessionId, filePath);
        if (!(await fs.pathExists(fullPath))) {
            throw new BadRequestException('File not found');
        }
        await fs.remove(fullPath);
        return { message: 'File deleted successfully' };
    }

    public getProjectPath(sessionId: string): string {
        return path.join(this.projectsDir, sessionId);
    }

    private getSecurePath(sessionId: string, filePath: string): string {
        const projectPath = this.getProjectPath(sessionId);
        const fullPath = path.normalize(path.join(projectPath, filePath));

        if (!fullPath.startsWith(projectPath)) {
            throw new BadRequestException('Invalid file path: path traversal detected');
        }
        return fullPath;
    }

    async runCommand(sessionId: string, command: string) {
        const projectPath = this.getProjectPath(sessionId);
        if (!(await fs.pathExists(projectPath))) {
            throw new BadRequestException('Project not found');
        }

        // Basic security check - prevent widespread destruction
        // Real security would require a sandbox, but for this dev tool we just block dangerous root commands
        if (command.includes('rm -rf /') || command.includes('sudo')) {
            throw new BadRequestException('Command not allowed');
        }

        return new Promise((resolve, reject) => {
            import('child_process').then(({ exec }) => {
                exec(command, { cwd: projectPath, maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
                    if (error) {
                        resolve({
                            success: false,
                            stdout: stdout || '',
                            stderr: stderr || error.message,
                            error: error.message
                        });
                    } else {
                        resolve({
                            success: true,
                            stdout: stdout || '',
                            stderr: stderr || ''
                        });
                    }
                });
            });
        });
    }
}
