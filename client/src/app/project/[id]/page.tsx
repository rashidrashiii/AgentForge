'use client';

import { useState, useRef, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Send, Loader2, CheckCircle2, AlertCircle, Code2, Eye, FileCode, RefreshCw, Zap } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { createPlanStream, approvePlanStream, listProjectFiles, getProjectBySession, Project, startPreview, getPreviewStatus, streamFastMode, streamRepairMode } from '@/lib/api';
import { Wrench } from 'lucide-react';

interface Message {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    status?: 'pending' | 'streaming' | 'complete' | 'error';
    phase?: string;
}

export default function EditorPage() {
    const params = useParams();
    const router = useRouter();
    const projectId = params.id as string;

    const [project, setProject] = useState<Project | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isLoadingProject, setIsLoadingProject] = useState(true);
    const [currentPhase, setCurrentPhase] = useState<'idle' | 'planning' | 'awaiting_approval' | 'coding' | 'complete'>('idle');
    const [streamingContent, setStreamingContent] = useState('');
    const [files, setFiles] = useState<string[]>([]);
    const [activeTab, setActiveTab] = useState('preview');
    const [previewKey, setPreviewKey] = useState(0);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [previewStatus, setPreviewStatus] = useState<string>('idle');
    const [mode, setMode] = useState<'planning' | 'fast'>('planning');
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const [hasError, setHasError] = useState(false);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        if (previewStatus === 'error') {
            setHasError(true);
        }
    }, [previewStatus]);

    useEffect(() => {
        scrollToBottom();
    }, [messages, streamingContent]);


    // Load project data on mount
    useEffect(() => {
        const loadProject = async () => {
            setIsLoadingProject(true);
            try {
                // Load project details and chat history
                const data = await getProjectBySession(projectId);
                if (data?.project) {
                    setProject(data.project);
                    setCurrentPhase(data.project.current_phase as typeof currentPhase);

                    // Load chat history
                    if (data.chatHistory && data.chatHistory.length > 0) {
                        const loadedMessages: Message[] = data.chatHistory.map((msg, idx) => ({
                            id: `loaded-${idx}`,
                            role: msg.role as 'user' | 'assistant' | 'system',
                            content: msg.content,
                            status: 'complete' as const,
                        }));
                        setMessages(loadedMessages);
                    }
                }

                // Load project files
                const projectFiles = await listProjectFiles(projectId);
                setFiles(projectFiles);
            } catch (error) {
                console.error('Failed to load project:', error);
            }
            setIsLoadingProject(false);
        };

        loadProject();
    }, [projectId]);

    // Start preview dev server when preview tab is active
    useEffect(() => {
        if (activeTab !== 'preview') return;

        const startDevServer = async () => {
            setPreviewStatus('starting');
            const result = await startPreview(projectId);
            setPreviewStatus(result.status);
            if (result.url) {
                setPreviewUrl(result.url);
            } else if (result.status === 'installing' || result.status === 'starting') {
                // Poll for status
                const pollInterval = setInterval(async () => {
                    const status = await getPreviewStatus(projectId);
                    setPreviewStatus(status.status);
                    if (status.url) {
                        setPreviewUrl(status.url);
                        clearInterval(pollInterval);
                    }
                    if (status.status === 'error') {
                        clearInterval(pollInterval);
                    }
                }, 2000);

                return () => clearInterval(pollInterval);
            }
        };

        startDevServer();
    }, [projectId, activeTab]);

    const refreshPreview = () => {
        setPreviewKey(prev => prev + 1);
        listProjectFiles(projectId).then(setFiles).catch(console.error);
    };

    const handleSend = async () => {
        if (!input.trim() || isLoading) return;

        const userMessage: Message = {
            id: Date.now().toString(),
            role: 'user',
            content: input,
            status: 'complete',
        };
        setMessages((prev) => [...prev, userMessage]);
        setInput('');
        setIsLoading(true);
        setCurrentPhase('planning');
        setStreamingContent('');
        setHasError(false);

        // Add assistant placeholder
        const assistantId = (Date.now() + 1).toString();
        setMessages((prev) => [...prev, {
            id: assistantId,
            role: 'assistant',
            content: '',
            status: 'streaming',
            phase: 'Planning...',
        }]);

        // Start appropriate stream based on mode
        if (mode === 'fast') {
            const cleanup = streamFastMode(
                projectId,
                input,
                project?.framework || 'react',
                (event) => {
                    if (event.type === 'status') {
                        setMessages((prev) => prev.map((m) =>
                            m.id === assistantId ? { ...m, phase: event.message } : m
                        ));
                    } else if (event.type === 'changes') {
                        setMessages((prev) => prev.map((m) =>
                            m.id === assistantId ? { ...m, content: (m.content || '') + '📝 Code updated\n' } : m
                        ));
                    } else if (event.type === 'error') {
                        const errorMsg = event.errors ? event.errors.join('\n') : event.message;
                        setHasError(true);
                        setMessages((prev) => prev.map((m) =>
                            m.id === assistantId ? { ...m, content: (m.content || '') + `⚠️ Error: ${errorMsg}\n` } : m
                        ));
                    } else if (event.type === 'fix') {
                        setMessages((prev) => prev.map((m) =>
                            m.id === assistantId ? { ...m, content: (m.content || '') + '🔧 Applied fix\n' } : m
                        ));
                    } else if (event.type === 'complete') {
                        setCurrentPhase('complete');
                        setMessages((prev) => prev.map((m) =>
                            m.id === assistantId ? { ...m, status: 'complete', phase: event.message } : m
                        ));
                        setIsLoading(false);
                        refreshPreview();
                    }
                }
            );
            return () => cleanup();
        } else {
            // Start planning stream (existing logic)
            const cleanup = createPlanStream(
                projectId,
                input,
                project?.framework || 'react',
                (event) => {
                    if (event.type === 'status') {
                        setMessages((prev) => prev.map((m) =>
                            m.id === assistantId ? { ...m, phase: event.message } : m
                        ));
                    } else if (event.type === 'chunk' || event.type === 'complete') {
                        const content = event.content || event.plan || '';
                        setStreamingContent((prev) => prev + content);
                        setMessages((prev) => prev.map((m) =>
                            m.id === assistantId ? { ...m, content: content } : m
                        ));

                        if (event.type === 'complete') {
                            setCurrentPhase('awaiting_approval');
                            setMessages((prev) => prev.map((m) =>
                                m.id === assistantId ? { ...m, status: 'complete', phase: 'Awaiting approval' } : m
                            ));
                            setIsLoading(false);
                        }
                    } else if (event.type === 'done') {
                        setIsLoading(false);
                    } else if (event.type === 'error') {
                        setHasError(true);
                        setMessages((prev) => prev.map((m) =>
                            m.id === assistantId ? { ...m, status: 'error', content: event.message || 'An error occurred' } : m
                        ));
                        setIsLoading(false);
                    }
                }
            );

            return () => cleanup();
        }
    };

    const handleApprove = async () => {
        setIsLoading(true);
        setCurrentPhase('coding');
        setStreamingContent('');

        const assistantId = Date.now().toString();
        setMessages((prev) => [...prev, {
            id: assistantId,
            role: 'assistant',
            content: '',
            status: 'streaming',
            phase: 'Coding...',
        }]);

        const cleanup = approvePlanStream(
            projectId,
            (event) => {
                if (event.type === 'status' || event.type === 'progress') {
                    setMessages((prev) => prev.map((m) =>
                        m.id === assistantId ? { ...m, phase: event.message } : m
                    ));
                } else if (event.type === 'chunk') {
                    setStreamingContent((prev) => prev + (event.content || ''));
                    setMessages((prev) => prev.map((m) =>
                        m.id === assistantId ? { ...m, content: m.content + (event.content || '') } : m
                    ));
                } else if (event.type === 'complete') {
                    setCurrentPhase('complete');
                    setMessages((prev) => prev.map((m) =>
                        m.id === assistantId ? { ...m, status: 'complete', phase: 'Complete!' } : m
                    ));
                    setIsLoading(false);
                    // Refresh files and preview
                    refreshPreview();
                } else if (event.type === 'done') {
                    setIsLoading(false);
                } else if (event.type === 'error') {
                    setMessages((prev) => prev.map((m) =>
                        m.id === assistantId ? { ...m, status: 'error', content: event.message || 'An error occurred' } : m
                    ));
                    setIsLoading(false);
                }
            }
        );

        return () => cleanup();
        return () => cleanup();
    };

    const handleRepair = () => {
        if (isLoading) return;
        setIsLoading(true);
        setCurrentPhase('coding');
        setStreamingContent('');
        setHasError(false);

        // Add assistant placeholder
        const assistantId = (Date.now() + 1).toString();
        setMessages((prev) => [...prev, {
            id: assistantId,
            role: 'assistant',
            content: '',
            status: 'streaming',
            phase: 'Repairing...',
        }]);

        const cleanup = streamRepairMode(
            projectId,
            project?.framework || 'react',
            (event) => {
                if (event.type === 'status') {
                    setMessages((prev) => prev.map((m) =>
                        m.id === assistantId ? { ...m, phase: event.message } : m
                    ));
                } else if (event.type === 'chunk') {
                    setMessages((prev) => prev.map((m) =>
                        m.id === assistantId ? { ...m, content: (m.content || '') + event.content } : m
                    ));
                } else if (event.type === 'error') {
                    const errorMsg = event.errors ? event.errors.join('\n') : event.message;
                    setHasError(true);
                    setMessages((prev) => prev.map((m) =>
                        m.id === assistantId ? { ...m, content: (m.content || '') + `⚠️ Error: ${errorMsg}\n` } : m
                    ));
                } else if (event.type === 'complete') {
                    setCurrentPhase('complete');
                    setMessages((prev) => prev.map((m) =>
                        m.id === assistantId ? { ...m, status: 'complete', phase: event.message } : m
                    ));
                    setIsLoading(false);
                    refreshPreview();
                }
            }
        );
        return () => cleanup();
    };

    return (
        <div className="h-screen flex flex-col">
            {/* Header */}
            <header className="border-b border-border/40 bg-background/80 backdrop-blur-xl px-4 py-3 flex items-center gap-4">
                <Link href="/">
                    <Button variant="ghost" size="icon">
                        <ArrowLeft className="w-4 h-4" />
                    </Button>
                </Link>
                <div className="flex items-center gap-2">
                    <Code2 className="w-5 h-5 text-violet-400" />
                    <span className="font-semibold">{projectId}</span>
                </div>
                <Badge variant="outline" className="ml-auto">
                    {currentPhase === 'idle' ? 'Ready' :
                        currentPhase === 'planning' ? 'Planning...' :
                            currentPhase === 'awaiting_approval' ? 'Review Plan' :
                                currentPhase === 'coding' ? 'Building...' : 'Complete'}
                </Badge>
            </header>

            {/* Main Content */}
            <div className="flex-1 flex overflow-hidden">
                {/* Left Panel - Chat */}
                <div className="w-[40%] border-r border-border/40 flex flex-col h-full">
                    {/* Scrollable Chat History */}
                    <div className="flex-1 overflow-y-auto p-4">
                        <div className="space-y-4">
                            {messages.length === 0 && (
                                <div className="text-center py-20">
                                    <Code2 className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                                    <h3 className="text-lg font-medium mb-2">Start Building</h3>
                                    <p className="text-muted-foreground text-sm max-w-xs mx-auto">
                                        Describe what you want to create and AI will help you build it.
                                    </p>
                                </div>
                            )}

                            {messages.map((message) => (
                                <div
                                    key={message.id}
                                    className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                                >
                                    <div
                                        className={`max-w-[85%] rounded-2xl px-4 py-3 ${message.role === 'user'
                                            ? 'bg-gradient-to-r from-violet-600 to-cyan-600 text-white'
                                            : 'bg-card border border-border/50'
                                            }`}
                                    >
                                        {message.phase && message.role === 'assistant' && (
                                            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                                                {message.status === 'streaming' ? (
                                                    <Loader2 className="w-3 h-3 animate-spin" />
                                                ) : message.status === 'complete' ? (
                                                    <CheckCircle2 className="w-3 h-3 text-green-500" />
                                                ) : message.status === 'error' ? (
                                                    <AlertCircle className="w-3 h-3 text-red-500" />
                                                ) : null}
                                                {message.phase}
                                            </div>
                                        )}
                                        <div className="text-sm whitespace-pre-wrap">{message.content}</div>
                                    </div>
                                </div>
                            ))}
                            <div ref={messagesEndRef} />
                        </div>
                    </div>

                    {/* Action Bar - Fixed at bottom */}
                    {currentPhase === 'awaiting_approval' && (
                        <div className="p-4 border-t border-border/40 bg-amber-500/10 shrink-0">
                            <div className="flex items-center justify-between">
                                <span className="text-sm text-amber-400">Review the plan above</span>
                                <Button
                                    onClick={handleApprove}
                                    disabled={isLoading}
                                    className="gap-2 bg-gradient-to-r from-green-600 to-emerald-600"
                                >
                                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                                    Approve & Build
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* Input - Fixed at bottom */}
                    <div className="p-4 border-t border-border/40 bg-background shrink-0">
                        <div className="mb-2">
                            <Select value={mode} onValueChange={(v) => setMode(v as 'planning' | 'fast')}>
                                <SelectTrigger className="w-[200px] h-8 text-xs bg-background">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="planning">
                                        <div className="flex items-center gap-2">
                                            <Code2 className="w-3 h-3 text-blue-500" />
                                            <div>
                                                <div className="font-medium">Planning Mode</div>
                                                <div className="text-[10px] text-muted-foreground">Plan {'->'} Approve {'->'} Build</div>
                                            </div>
                                        </div>
                                    </SelectItem>
                                    <SelectItem value="fast">
                                        <div className="flex items-center gap-2">
                                            <Zap className="w-3 h-3 text-amber-500" />
                                            <div>
                                                <div className="font-medium">Fast Mode</div>
                                                <div className="text-[10px] text-muted-foreground">Direct edit + Auto-fix</div>
                                            </div>
                                        </div>
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="flex gap-2">
                            <Textarea
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                placeholder={mode === 'fast' ? "Describe the change (e.g., 'Change button color to blue')..." : "Describe what you want to build..."}
                                className="min-h-[60px] resize-none focus-visible:ring-indigo-500"
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        handleSend();
                                    }
                                }}
                                disabled={isLoading || currentPhase === 'awaiting_approval'}
                            />
                            <Button
                                onClick={handleSend}
                                disabled={!input.trim() || isLoading || currentPhase === 'awaiting_approval'}
                                size="icon"
                                className={`h-auto ${mode === 'fast' ? 'bg-gradient-to-r from-amber-500 to-orange-600' : 'bg-gradient-to-r from-violet-600 to-cyan-600'}`}
                            >
                                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : mode === 'fast' ? <Zap className="w-4 h-4 fill-white" /> : <Send className="w-4 h-4" />}
                            </Button>
                        </div>
                    </div>
                </div>

                {/* Right Panel - Preview & Code */}
                <div className="flex-1 flex flex-col">
                    <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
                        <div className="px-4 pt-2 border-b border-border/40">
                            <TabsList className="bg-transparent">
                                <TabsTrigger value="preview" className="gap-2">
                                    <Eye className="w-4 h-4" />
                                    Preview
                                </TabsTrigger>
                                <TabsTrigger value="code" className="gap-2">
                                    <FileCode className="w-4 h-4" />
                                    Code
                                </TabsTrigger>
                            </TabsList>
                        </div>

                        <TabsContent value="preview" className="flex-1 m-0 p-4">
                            <Card className="h-full overflow-hidden relative">
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="absolute top-2 right-2 z-10 bg-background/80 backdrop-blur"
                                    onClick={refreshPreview}
                                >
                                    <RefreshCw className="w-4 h-4" />
                                </Button>
                                <Button
                                    size={hasError ? "sm" : "icon"}
                                    variant={hasError ? "destructive" : "ghost"}
                                    className={`absolute top-2 left-2 z-10 gap-2 shadow-lg transition-all duration-300 ${hasError
                                        ? 'bg-red-500 hover:bg-red-600 text-white'
                                        : 'bg-background/80 backdrop-blur text-muted-foreground hover:bg-background hover:text-foreground'}`}
                                    onClick={handleRepair}
                                    disabled={isLoading}
                                    title="Fix Build Errors"
                                >
                                    <Wrench className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                                    {hasError && "Fix Build Errors"}
                                </Button>
                                {previewUrl ? (
                                    <iframe
                                        key={previewKey}
                                        src={previewUrl}
                                        className="w-full h-full border-0"
                                        title="Preview"
                                    />
                                ) : (
                                    <div className="w-full h-full flex flex-col items-center justify-center gap-4 bg-gradient-to-br from-gray-900 to-gray-950">
                                        <Loader2 className="w-8 h-8 animate-spin text-violet-500" />
                                        <div className="text-center">
                                            <p className="text-lg font-medium text-white">
                                                {previewStatus === 'installing' ? 'Installing dependencies...' :
                                                    previewStatus === 'starting' ? 'Starting dev server...' :
                                                        previewStatus === 'error' ? 'Error starting server' :
                                                            'Preparing preview...'}
                                            </p>
                                            <p className="text-sm text-gray-400 mt-1">This may take a moment</p>
                                        </div>
                                    </div>
                                )}
                            </Card>
                        </TabsContent>

                        <TabsContent value="code" className="flex-1 m-0 p-4">
                            <Card className="h-full overflow-hidden">
                                <ScrollArea className="h-full p-4">
                                    <div className="space-y-2">
                                        <h3 className="text-sm font-medium text-muted-foreground mb-4">Project Files</h3>
                                        {files.length === 0 ? (
                                            <p className="text-muted-foreground text-sm">No files yet. Start building!</p>
                                        ) : (
                                            files.map((file) => (
                                                <div key={file} className="flex items-center gap-2 text-sm py-1 px-2 rounded hover:bg-accent/50 cursor-pointer">
                                                    <FileCode className="w-4 h-4 text-muted-foreground" />
                                                    {file}
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </ScrollArea>
                            </Card>
                        </TabsContent>
                    </Tabs>
                </div>
            </div>
        </div >
    );
}
