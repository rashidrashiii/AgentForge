import { Controller, Get, Post, Param, Body, Res, Req, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { DevServerService } from './dev-server.service';
import { SupabaseService } from '../supabase/supabase.service';
import type { Response, Request } from 'express';
import { createProxyServer } from 'http-proxy';

const proxy = createProxyServer({});

@ApiTags('Preview')
@Controller('preview')
export class PreviewController {
    constructor(
        private readonly devServerService: DevServerService,
        private readonly supabaseService: SupabaseService,
    ) { }

    @Get(':sessionId/logs')
    @ApiOperation({ summary: 'Get runtime logs' })
    async getLogs(@Param('sessionId') sessionId: string) {
        return this.devServerService.getRuntimeLogs(sessionId);
    }

    @Get(':sessionId/clear-logs')
    @ApiOperation({ summary: 'Clear runtime logs' })
    async clearLogs(@Param('sessionId') sessionId: string) {
        this.devServerService.clearRuntimeLogs(sessionId);
        return { status: 'cleared' };
    }

    @Post(':sessionId/log')
    @ApiOperation({ summary: 'Receive runtime error log' })
    async logError(@Param('sessionId') sessionId: string, @Body() body: any) {
        this.devServerService.logRuntimeError(sessionId, body);
        return { status: 'logged' };
    }

    @Get(':sessionId/start')
    @ApiOperation({ summary: 'Start dev server for a project' })
    @ApiResponse({ status: 200, description: 'Server started/starting' })
    async startDevServer(@Param('sessionId') sessionId: string) {
        // Get framework from database
        const project = await this.supabaseService.getProjectBySessionId(sessionId);
        const framework = project?.framework || 'react';

        const result = await this.devServerService.startDevServer(sessionId, framework as 'react' | 'nextjs');
        return result;
    }

    @Get(':sessionId/status')
    @ApiOperation({ summary: 'Get dev server status' })
    @ApiResponse({ status: 200, description: 'Server status' })
    getDevServerStatus(@Param('sessionId') sessionId: string) {
        return this.devServerService.getStatus(sessionId);
    }

    @Get(':sessionId/stop')
    @ApiOperation({ summary: 'Stop dev server' })
    @ApiResponse({ status: 200, description: 'Server stopped' })
    stopDevServer(@Param('sessionId') sessionId: string) {
        this.devServerService.stopDevServer(sessionId);
        return { status: 'stopped' };
    }

    @Get(':sessionId/reinstall')
    @ApiOperation({ summary: 'Reinstall dependencies (pnpm install)' })
    @ApiResponse({ status: 200, description: 'Dependencies reinstalled' })
    async reinstallDependencies(@Param('sessionId') sessionId: string) {
        return await this.devServerService.reinstallDependencies(sessionId);
    }

    @Get(':sessionId')
    @ApiOperation({ summary: 'Proxy to dev server (index page)' })
    async proxyToDevServer(
        @Param('sessionId') sessionId: string,
        @Req() req: Request,
        @Res() res: Response,
    ) {
        return this.handleProxy(sessionId, '/', req, res);
    }

    @Get(':sessionId/*')
    @ApiOperation({ summary: 'Proxy to dev server' })
    async proxyPath(
        @Param('sessionId') sessionId: string,
        @Req() req: Request,
        @Res() res: Response,
    ) {
        // Extract the path after /preview/sessionId/
        const prefix = `/preview/${sessionId}/`;
        const fullPath = req.originalUrl.startsWith(prefix)
            ? req.originalUrl.slice(prefix.length - 1)  // Keep leading /
            : '/';
        return this.handleProxy(sessionId, fullPath, req, res);
    }

    private async handleProxy(sessionId: string, targetPath: string, req: Request, res: Response) {
        const port = this.devServerService.getDevServerPort(sessionId);

        if (!port) {
            // Dev server not running, return loading page
            const status = this.devServerService.getStatus(sessionId);

            if (status.status === 'idle') {
                // Auto-start the dev server
                const project = await this.supabaseService.getProjectBySessionId(sessionId);
                const framework = project?.framework || 'react';
                this.devServerService.startDevServer(sessionId, framework as 'react' | 'nextjs');
            }

            // Return loading page that polls for status
            return res.status(HttpStatus.OK).send(this.getLoadingPage(sessionId, status.status));
        }

        // For HTML requests (index), we need to modify the response to rewrite paths
        const isHtmlRequest = targetPath === '/' || targetPath === '/index.html';

        if (isHtmlRequest) {
            // Fetch from dev server and modify HTML
            try {
                const devServerUrl = `http://localhost:${port}${targetPath}`;
                const response = await fetch(devServerUrl);
                let html = await response.text();

                // Rewrite all absolute paths to include preview prefix
                const prefix = `/preview/${sessionId}`;

                // Rewrite src="/..." and href="/..." attributes
                html = html.replace(/(\s(?:src|href)=["'])\/(?!\/)/g, `$1${prefix}/`);

                // Rewrite import "/@..." in inline scripts
                html = html.replace(/from\s+["']\//g, `from "${prefix}/`);
                html = html.replace(/import\s+["']\//g, `import "${prefix}/`);

                // INJECT RUNTIME ERROR CAPTURE SCRIPT
                const errorScript = `
                <script>
                    (function() {
                        const sessionId = '${sessionId}';
                        function sendLog(type, message, stack) {
                            fetch('/preview/' + sessionId + '/log', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ type, message, stack })
                            }).catch(e => {}); // Ignore logging errors
                        }

                        window.onerror = function(msg, url, line, col, error) {
                            sendLog('Uncaught Exception', msg, error?.stack);
                        };

                        window.addEventListener('unhandledrejection', function(event) {
                            sendLog('Unhandled Rejection', event.reason?.message || event.reason, event.reason?.stack);
                        });

                        // Optional: Capture console.error
                        const originalConsoleError = console.error;
                        console.error = function(...args) {
                            sendLog('Console Error', args.map(a => String(a)).join(' '), new Error().stack);
                            originalConsoleError.apply(console, args);
                        };
                    })();
                </script>
                `;
                html = html.replace('</head>', `${errorScript}</head>`);

                res.setHeader('Content-Type', 'text/html');
                return res.send(html);
            } catch (error) {
                console.error('Error fetching from dev server:', error);
                return res.status(HttpStatus.BAD_GATEWAY).send('Dev server unavailable');
            }
        }

        // For non-HTML requests, proxy directly
        const target = `http://localhost:${port}`;
        req.url = targetPath;

        proxy.web(req, res, {
            target,
            changeOrigin: true,
            ws: true,
        }, (err) => {
            if (err) {
                console.error('Proxy error:', err);
                res.status(HttpStatus.BAD_GATEWAY).send('Dev server unavailable');
            }
        });
    }

    private getLoadingPage(sessionId: string, status: string): string {
        const statusMessage = {
            'idle': 'Starting dev server...',
            'installing': 'Installing dependencies...',
            'starting': 'Starting Vite...',
            'error': 'Error starting server',
            'running': 'Server is ready!',
        }[status] || 'Loading...';

        return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Loading Preview</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
        }
        .container {
            text-align: center;
            padding: 40px;
        }
        .spinner {
            width: 48px;
            height: 48px;
            border: 3px solid rgba(139, 92, 246, 0.3);
            border-top: 3px solid #8b5cf6;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 0 auto 24px;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        h1 {
            font-size: 1.5rem;
            margin-bottom: 8px;
            background: linear-gradient(to right, #8b5cf6, #06b6d4);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        p {
            color: #a1a1aa;
            font-size: 0.9rem;
        }
        .status {
            margin-top: 16px;
            padding: 8px 16px;
            background: rgba(139, 92, 246, 0.1);
            border: 1px solid rgba(139, 92, 246, 0.3);
            border-radius: 8px;
            font-size: 0.85rem;
            color: #c4b5fd;
        }
        .error { border-color: #ef4444; color: #fca5a5; background: rgba(239, 68, 68, 0.1); }
    </style>
</head>
<body>
    <div class="container">
        <div class="spinner"></div>
        <h1>Building Preview</h1>
        <p>Setting up your React app...</p>
        <div class="status ${status === 'error' ? 'error' : ''}" id="status">${statusMessage}</div>
    </div>
    <script>
        const sessionId = '${sessionId}';
        let attempts = 0;
        const maxAttempts = 120; // 2 minutes with 1s interval

        async function checkStatus() {
            try {
                const response = await fetch('/preview/' + sessionId + '/status');
                const data = await response.json();
                
                const statusEl = document.getElementById('status');
                const messages = {
                    'idle': 'Starting dev server...',
                    'installing': 'Installing dependencies...',
                    'starting': 'Starting Vite...',
                    'error': data.error || 'Error starting server',
                    'running': 'Ready! Redirecting...',
                };
                statusEl.textContent = messages[data.status] || 'Loading...';
                statusEl.className = 'status' + (data.status === 'error' ? ' error' : '');

                if (data.status === 'running') {
                    // Reload the page to get the actual app
                    setTimeout(() => window.location.reload(), 500);
                } else if (data.status === 'error') {
                    // Stop polling on error
                    console.error('Dev server error:', data.error);
                } else if (attempts < maxAttempts) {
                    attempts++;
                    setTimeout(checkStatus, 1000);
                }
            } catch (e) {
                console.error('Status check failed:', e);
                if (attempts < maxAttempts) {
                    attempts++;
                    setTimeout(checkStatus, 1000);
                }
            }
        }

        // Start polling
        setTimeout(checkStatus, 1000);
    </script>
</body>
</html>
        `.trim();
    }
}
