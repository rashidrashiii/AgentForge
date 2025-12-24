import { createTool } from '@mastra/core';
import { z } from 'zod';
import { WorkspaceService } from '../workspace/workspace.service';

export const createMastraTools = (workspaceService: WorkspaceService, sessionId: string) => {
    const listFiles = createTool({
        id: 'list_files',
        description: 'Recursively list all files in the project',
        inputSchema: z.object({}),
        outputSchema: z.any(),
        execute: async () => {
            return await workspaceService.listFiles(sessionId);
        },
    });

    const readFile = createTool({
        id: 'read_file',
        description: 'Read the content of a file',
        inputSchema: z.object({
            filePath: z.string().describe('The path to the file to read'),
        }),
        outputSchema: z.any(),
        execute: async ({ context }) => {
            return await workspaceService.readFile(sessionId, context.filePath);
        }
    });

    const writeFile = createTool({
        id: 'write_file',
        description: 'Create or overwrite a file with content',
        inputSchema: z.object({
            filePath: z.string().describe('The path to the file to write'),
            content: z.string().describe('The content to write'),
        }),
        outputSchema: z.any(),
        execute: async ({ context }) => {
            return await workspaceService.writeFile(sessionId, context.filePath, context.content);
        }
    });

    const deleteFile = createTool({
        id: 'delete_file',
        description: 'Delete a file',
        inputSchema: z.object({
            filePath: z.string().describe('The path to the file to delete'),
        }),
        outputSchema: z.any(),
        execute: async ({ context }) => {
            return await workspaceService.deleteFile(sessionId, context.filePath);
        }
    });

    const editFile = createTool({
        id: 'edit_file',
        description: 'Edit a file by replacing a search string with a replacement string',
        inputSchema: z.object({
            filePath: z.string().describe('The path to the file to edit'),
            searchString: z.string().describe('The exact string to search for'),
            replaceString: z.string().describe('The string to replace it with'),
        }),
        outputSchema: z.any(),
        execute: async ({ context }) => {
            return await workspaceService.editFile(sessionId, context.filePath, context.searchString, context.replaceString);
        }
    });

    const runCommand = createTool({
        id: 'run_command',
        description: 'Run a shell command in the project directory (e.g. npm install, pnpm add)',
        inputSchema: z.object({
            command: z.string().describe('The command to execute'),
        }),
        outputSchema: z.any(),
        execute: async ({ context }) => {
            return await workspaceService.runCommand(sessionId, context.command);
        }
    });

    return { listFiles, readFile, writeFile, deleteFile, editFile, runCommand };
};
