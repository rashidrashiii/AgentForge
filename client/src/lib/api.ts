const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export interface PlanResponse {
    sessionId: string;
    framework: string;
    phase: string;
    plan: string;
    message: string;
}

export interface ApproveResponse {
    sessionId: string;
    phase: string;
    result: string;
}

// Create a plan (Phase 1)
export async function createPlan(
    sessionId: string,
    prompt: string,
    framework: 'react' | 'nextjs' = 'nextjs'
): Promise<PlanResponse> {
    const response = await fetch(`${API_BASE}/chat/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, prompt, framework }),
    });
    if (!response.ok) throw new Error('Failed to create plan');
    return response.json();
}

// Approve plan and execute (Phase 2 & 3) - Streaming
export function approvePlanStream(
    sessionId: string,
    onEvent: (event: { type: string; message?: string; content?: string }) => void
): () => void {
    const eventSource = new EventSource(
        `${API_BASE}/chat/plan/approve/stream?sessionId=${encodeURIComponent(sessionId)}`
    );

    eventSource.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            onEvent(data);
            if (data.type === 'done' || data.type === 'complete') {
                eventSource.close();
            }
        } catch (e) {
            console.error('Error parsing SSE event:', e);
        }
    };

    eventSource.onerror = () => {
        eventSource.close();
        onEvent({ type: 'error', message: 'Connection lost' });
    };

    return () => eventSource.close();
}

// Plan with streaming
export function createPlanStream(
    sessionId: string,
    prompt: string,
    framework: 'react' | 'nextjs',
    onEvent: (event: { type: string; message?: string; content?: string; plan?: string }) => void
): () => void {
    const params = new URLSearchParams({
        sessionId,
        prompt,
        framework,
    });

    const eventSource = new EventSource(`${API_BASE}/chat/plan/stream?${params}`);

    eventSource.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            onEvent(data);
            if (data.type === 'done' || data.type === 'complete') {
                eventSource.close();
            }
        } catch (e) {
            console.error('Error parsing SSE event:', e);
        }
    };

    eventSource.onerror = () => {
        eventSource.close();
        onEvent({ type: 'error', message: 'Connection lost' });
    };

    return () => eventSource.close();
}

// Get preview URL (direct to dev server port)
export function getPreviewUrl(sessionId: string): string {
    return `${API_BASE}/preview/${sessionId}/`;
}

// Start preview dev server and get status
export async function startPreview(sessionId: string): Promise<{ status: string; port?: number; url?: string }> {
    const response = await fetch(`${API_BASE}/preview/${sessionId}/start`);
    const data = await response.json();
    if (data.status === 'running' && data.port) {
        return { ...data, url: `http://localhost:${data.port}` };
    }
    return data;
}

// Get preview status
export async function getPreviewStatus(sessionId: string): Promise<{ status: string; port?: number; url?: string }> {
    const response = await fetch(`${API_BASE}/preview/${sessionId}/status`);
    const data = await response.json();
    if (data.status === 'running' && data.port) {
        return { ...data, url: `http://localhost:${data.port}` };
    }
    return data;
}

// Fast mode - direct execution with auto error-fixing
export function streamFastMode(
    sessionId: string,
    message: string,
    framework: 'react' | 'nextjs',
    onEvent: (data: any) => void
): () => void {
    const url = `${API_BASE}/chat/fast-mode/stream?sessionId=${encodeURIComponent(sessionId)}&message=${encodeURIComponent(message)}&framework=${framework}`;
    const eventSource = new EventSource(url);

    eventSource.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            onEvent(data);
            if (data.type === 'complete') {
                eventSource.close();
            }
        } catch (e) {
            console.error('Error parsing fast mode event:', e);
        }
    };

    eventSource.onerror = () => {
        eventSource.close();
        onEvent({ type: 'error', message: 'Connection lost' });
    };

    return () => eventSource.close();
}

// Repair mode - standalone build repair
export function streamRepairMode(
    sessionId: string,
    framework: 'react' | 'nextjs',
    onEvent: (data: any) => void
): () => void {
    const url = `${API_BASE}/chat/repair/stream?sessionId=${encodeURIComponent(sessionId)}&framework=${framework}`;
    const eventSource = new EventSource(url);

    eventSource.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            onEvent(data);
            if (data.type === 'complete') {
                eventSource.close();
            }
        } catch (e) {
            console.error('Error parsing repair mode event:', e);
        }
    };

    eventSource.onerror = () => {
        eventSource.close();
        onEvent({ type: 'error', message: 'Connection lost' });
    };

    return () => eventSource.close();
}

// List files in project
export async function listProjectFiles(sessionId: string): Promise<string[]> {
    try {
        const response = await fetch(`${API_BASE}/session/${sessionId}/files`);
        if (!response.ok) return [];
        const data = await response.json();
        // Backend returns direct array, not { files: [...] }
        return Array.isArray(data) ? data : (data.files || []);
    } catch (error) {
        console.warn('Failed to fetch files:', error);
        return [];
    }
}

// ==================== PROJECT API ====================

export interface Project {
    id: string;
    name: string;
    description: string | null;
    session_id: string;
    framework: 'react' | 'nextjs';
    status: string;
    current_phase: string;
    created_at: string;
    updated_at: string;
}

// List all projects
export async function listProjects(): Promise<Project[]> {
    try {
        const response = await fetch(`${API_BASE}/projects`);
        if (!response.ok) return [];
        const data = await response.json();
        return data.projects || [];
    } catch (error) {
        console.warn('Failed to fetch projects:', error);
        return [];
    }
}

// Create new project
export async function createProject(
    name: string,
    description?: string,
    framework: 'react' | 'nextjs' = 'react'
): Promise<Project | null> {
    try {
        const response = await fetch(`${API_BASE}/projects`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, description, framework }),
        });
        if (!response.ok) return null;
        const data = await response.json();
        return data.project || null;
    } catch (error) {
        console.error('Failed to create project:', error);
        return null;
    }
}

// Get project by ID
export async function getProject(id: string): Promise<{
    project: Project;
    chatHistory: Array<{ role: string; content: string }>;
    pendingPlan: unknown | null;
} | null> {
    try {
        const response = await fetch(`${API_BASE}/projects/${id}`);
        if (!response.ok) return null;
        return response.json();
    } catch (error) {
        console.error('Failed to get project:', error);
        return null;
    }
}

// Get project by session ID
export async function getProjectBySession(sessionId: string): Promise<{
    project: Project;
    chatHistory: Array<{ role: string; content: string }>;
    pendingPlan: unknown | null;
} | null> {
    try {
        const response = await fetch(`${API_BASE}/projects/session/${sessionId}`);
        if (!response.ok) return null;
        return response.json();
    } catch (error) {
        console.error('Failed to get project:', error);
        return null;
    }
}

// Delete project
export async function deleteProject(id: string): Promise<boolean> {
    try {
        const response = await fetch(`${API_BASE}/projects/${id}`, {
            method: 'DELETE',
        });
        const data = await response.json();
        return data.success || false;
    } catch (error) {
        console.error('Failed to delete project:', error);
        return false;
    }
}

