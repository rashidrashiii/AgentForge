import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ChildProcess, spawn, exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs-extra';
import * as net from 'net';

const execAsync = promisify(exec);

interface DevServer {
    sessionId: string;
    port: number;
    process: ChildProcess | null;
    status: 'idle' | 'installing' | 'starting' | 'running' | 'error';
    lastActivity: Date;
    errorMessage?: string;
    framework: 'react' | 'nextjs';
}

@Injectable()
export class DevServerService implements OnModuleDestroy {
    private readonly logger = new Logger(DevServerService.name);
    // Map of sessionId -> project root path
    private projectPaths: Map<string, string> = new Map();
    // Map of sessionId -> runtime logs
    private runtimeLogs: Map<string, string[]> = new Map();
    private readonly servers = new Map<string, DevServer>();
    private readonly basePort = 5173;
    private readonly maxServers = 5;
    private readonly idleTimeout = 30 * 60 * 1000; // 30 minutes
    private cleanupInterval: NodeJS.Timeout;

    constructor() {
        // Cleanup idle servers periodically
        this.cleanupInterval = setInterval(() => {
            this.cleanupIdleServers();
        }, 5 * 60 * 1000); // Every 5 minutes
    }

    onModuleDestroy() {
        // Stop all servers on shutdown
        clearInterval(this.cleanupInterval);
        for (const [sessionId] of this.servers) {
            this.stopDevServer(sessionId);
        }
    }

    /**
     * Get the status of a dev server
     */
    getStatus(sessionId: string): { status: string; port?: number; error?: string } {
        const server = this.servers.get(sessionId);
        if (!server) {
            return { status: 'idle' };
        }
        return {
            status: server.status,
            port: server.port,
            error: server.errorMessage,
        };
    }

    /**
     * Start a dev server for a project
     */
    async startDevServer(sessionId: string, framework: 'react' | 'nextjs' = 'react'): Promise<{ status: string; port?: number }> {
        // Check if already running
        const existing = this.servers.get(sessionId);
        if (existing) {
            if (existing.status === 'running') {
                existing.lastActivity = new Date();
                return { status: 'running', port: existing.port };
            }
            if (existing.status === 'installing' || existing.status === 'starting') {
                return { status: existing.status };
            }
        }

        // Check max servers limit
        const runningCount = Array.from(this.servers.values()).filter(
            s => s.status === 'running' || s.status === 'starting' || s.status === 'installing'
        ).length;

        if (runningCount >= this.maxServers) {
            // Stop oldest idle server
            await this.stopOldestServer();
        }

        // Find available port
        const port = await this.findAvailablePort();

        // Initialize server entry
        const server: DevServer = {
            sessionId,
            port,
            process: null,
            status: 'installing',
            lastActivity: new Date(),
            framework,
        };
        this.servers.set(sessionId, server);

        // Start async process
        this.runDevServerAsync(sessionId, port, framework);

        return { status: 'installing', port };
    }

    /**
     * Stop a dev server
     */
    stopDevServer(sessionId: string): void {
        const server = this.servers.get(sessionId);
        if (server?.process) {
            this.logger.log(`Stopping dev server for ${sessionId}`);
            server.process.kill('SIGTERM');
            // Force kill after 5 seconds
            setTimeout(() => {
                if (server.process && !server.process.killed) {
                    server.process.kill('SIGKILL');
                }
            }, 5000);
        }
        this.servers.delete(sessionId);
    }

    /**
     * Get dev server port if running
     */
    getDevServerPort(sessionId: string): number | undefined {
        return this.servers.get(sessionId)?.port;
    }

    getRuntimeLogs(sessionId: string): string[] {
        return this.runtimeLogs.get(sessionId) || [];
    }

    clearRuntimeLogs(sessionId: string): void {
        this.runtimeLogs.delete(sessionId);
    }

    logRuntimeError(sessionId: string, log: { type?: string; message: string; stack?: string }): void {
        const logs = this.runtimeLogs.get(sessionId) || [];
        const logEntry = `[${new Date().toISOString()}] ${log.type || 'Error'}: ${log.message}\nStack: ${log.stack || 'N/A'}`;

        // Dedup consistent errors
        if (!logs.includes(logEntry)) {
            logs.push(logEntry);
            if (logs.length > 50) logs.shift();
            this.runtimeLogs.set(sessionId, logs);
        }
    }

    /**
     * Reinstall dependencies for a project (run pnpm install)
     */
    async reinstallDependencies(sessionId: string): Promise<{ status: string; message: string }> {
        const projectPath = path.join(process.cwd(), 'projects', sessionId);

        try {
            if (!await fs.pathExists(projectPath)) {
                return { status: 'error', message: 'Project not found' };
            }

            this.logger.log(`Reinstalling dependencies for ${sessionId}...`);

            await execAsync('pnpm install', {
                cwd: projectPath,
                env: { ...process.env, NODE_ENV: 'development' },
                timeout: 120000,
            });

            this.logger.log(`Dependencies reinstalled for ${sessionId}`);
            return { status: 'success', message: 'Dependencies reinstalled successfully' };
        } catch (error) {
            this.logger.error(`Failed to reinstall dependencies for ${sessionId}:`, error);
            return { status: 'error', message: error.message };
        }
    }

    /**
     * Run npm/pnpm install and start dev server
     */
    private async runDevServerAsync(sessionId: string, port: number, framework: 'react' | 'nextjs'): Promise<void> {
        const projectPath = path.join(process.cwd(), 'projects', sessionId);
        const server = this.servers.get(sessionId);

        if (!server) return;

        try {
            // Check if project exists
            if (!await fs.pathExists(projectPath)) {
                throw new Error(`Project not found: ${projectPath}`);
            }

            // Check if node_modules exists
            const nodeModulesPath = path.join(projectPath, 'node_modules');
            const hasNodeModules = await fs.pathExists(nodeModulesPath);

            if (!hasNodeModules) {
                this.logger.log(`Installing dependencies for ${sessionId} (${framework})...`);
                server.status = 'installing';

                // Always use pnpm for all projects
                await execAsync('pnpm install', {
                    cwd: projectPath,
                    env: { ...process.env, NODE_ENV: 'development' },
                    timeout: 120000, // 2 minute timeout
                });

                this.logger.log(`Dependencies installed for ${sessionId}`);
            }

            // Start dev server
            server.status = 'starting';
            this.logger.log(`Starting dev server for ${sessionId} on port ${port}...`);

            // Determine dev command based on framework - always use pnpm
            const devCmd = framework === 'react'
                ? 'npx vite --port'
                : 'pnpm run dev -- --port';

            const devProcess = spawn('sh', ['-c', `${devCmd} ${port} --host 0.0.0.0`], {
                cwd: projectPath,
                env: { ...process.env, NODE_ENV: 'development', BROWSER: 'none' },
                stdio: ['ignore', 'pipe', 'pipe'],
            });

            server.process = devProcess;

            // Listen for ready signal
            let isReady = false;

            devProcess.stdout?.on('data', (data) => {
                const output = data.toString();
                this.logger.debug(`[${sessionId}] ${output}`);

                // Parse actual port from Vite output: "Local:   http://localhost:5175/"
                // This is the definitive signal that vite is ready
                const portMatch = output.match(/Local:\s+https?:\/\/localhost:(\d+)/);
                if (portMatch && !isReady) {
                    const actualPort = parseInt(portMatch[1], 10);
                    if (actualPort !== server.port) {
                        this.logger.log(`[${sessionId}] Vite using port ${actualPort} instead of ${server.port}`);
                        server.port = actualPort;
                    }
                    isReady = true;
                    server.status = 'running';
                    this.logger.log(`Dev server running for ${sessionId} on port ${server.port}`);
                }
            });

            devProcess.stderr?.on('data', (data) => {
                const error = data.toString();
                this.logger.warn(`[${sessionId}] stderr: ${error}`);
            });

            devProcess.on('error', (error) => {
                this.logger.error(`Dev server error for ${sessionId}:`, error);
                server.status = 'error';
                server.errorMessage = error.message;
            });

            devProcess.on('exit', (code) => {
                this.logger.log(`Dev server exited for ${sessionId} with code ${code}`);
                if (server.status !== 'error') {
                    server.status = 'idle';
                }
                server.process = null;
            });

            // Wait for server to be ready (max 30 seconds)
            await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    if (!isReady) {
                        // Still waiting - assume it's running anyway
                        server.status = 'running';
                        resolve();
                    }
                }, 30000);

                const checkInterval = setInterval(() => {
                    if (isReady) {
                        clearInterval(checkInterval);
                        clearTimeout(timeout);
                        resolve();
                    }
                    if (server.status === 'error') {
                        clearInterval(checkInterval);
                        clearTimeout(timeout);
                        reject(new Error(server.errorMessage));
                    }
                }, 500);
            });

        } catch (error) {
            this.logger.error(`Failed to start dev server for ${sessionId}:`, error);
            server.status = 'error';
            server.errorMessage = error.message;
        }
    }

    /**
     * Find an available port
     */
    private async findAvailablePort(): Promise<number> {
        const usedPorts = new Set(
            Array.from(this.servers.values()).map(s => s.port)
        );

        for (let port = this.basePort; port < this.basePort + 100; port++) {
            if (!usedPorts.has(port) && await this.isPortAvailable(port)) {
                return port;
            }
        }

        throw new Error('No available ports');
    }

    /**
     * Check if a port is available
     */
    private isPortAvailable(port: number): Promise<boolean> {
        return new Promise((resolve) => {
            const server = net.createServer();
            server.once('error', () => resolve(false));
            server.once('listening', () => {
                server.close();
                resolve(true);
            });
            server.listen(port);
        });
    }

    /**
     * Stop the oldest idle server
     */
    private async stopOldestServer(): Promise<void> {
        let oldestServer: DevServer | null = null;

        for (const server of this.servers.values()) {
            if (server.status === 'running') {
                if (!oldestServer || server.lastActivity < oldestServer.lastActivity) {
                    oldestServer = server;
                }
            }
        }

        if (oldestServer) {
            this.logger.log(`Stopping oldest server: ${oldestServer.sessionId}`);
            this.stopDevServer(oldestServer.sessionId);
        }
    }

    /**
     * Cleanup idle servers
     */
    private cleanupIdleServers(): void {
        const now = Date.now();

        for (const [sessionId, server] of this.servers.entries()) {
            if (server.status === 'running') {
                const idleTime = now - server.lastActivity.getTime();
                if (idleTime > this.idleTimeout) {
                    this.logger.log(`Cleaning up idle server: ${sessionId}`);
                    this.stopDevServer(sessionId);
                }
            }
        }
    }
}
