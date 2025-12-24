'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Folder, Zap, Code2, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { listProjects, createProject, deleteProject, Project } from '@/lib/api';

export default function Dashboard() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newProject, setNewProject] = useState({ name: '', description: '', framework: 'react' as 'react' | 'nextjs' });

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    setIsLoading(true);
    const data = await listProjects();
    setProjects(data);
    setIsLoading(false);
  };

  const handleCreateProject = async () => {
    if (!newProject.name.trim()) return;

    setIsCreating(true);
    const project = await createProject(
      newProject.name,
      newProject.description,
      newProject.framework
    );

    if (project) {
      setIsCreateOpen(false);
      setNewProject({ name: '', description: '', framework: 'react' });
      // Navigate to the new project
      router.push(`/project/${project.session_id}`);
    } else {
      alert('Failed to create project');
    }
    setIsCreating(false);
  };

  const handleDeleteProject = async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();

    if (!confirm('Are you sure you want to delete this project?')) return;

    const success = await deleteProject(id);
    if (success) {
      setProjects(projects.filter(p => p.id !== id));
    }
  };

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-border/40 bg-background/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-semibold">Code Agent</span>
          </div>

          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2 bg-gradient-to-r from-violet-600 to-cyan-600 hover:from-violet-500 hover:to-cyan-500">
                <Plus className="w-4 h-4" />
                New Project
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Create New Project</DialogTitle>
                <DialogDescription>Start building with AI assistance</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Project Name</label>
                  <Input
                    placeholder="My Awesome App"
                    value={newProject.name}
                    onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Description</label>
                  <Textarea
                    placeholder="A brief description of your project"
                    value={newProject.description}
                    onChange={(e) => setNewProject({ ...newProject, description: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Framework</label>
                  <div className="flex gap-2">
                    <Button
                      variant={newProject.framework === 'react' ? 'default' : 'outline'}
                      onClick={() => setNewProject({ ...newProject, framework: 'react' })}
                      className="flex-1"
                    >
                      React
                    </Button>
                    <Button
                      variant={newProject.framework === 'nextjs' ? 'default' : 'outline'}
                      onClick={() => setNewProject({ ...newProject, framework: 'nextjs' })}
                      className="flex-1"
                    >
                      Next.js
                    </Button>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={handleCreateProject} disabled={!newProject.name || isCreating}>
                  {isCreating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Create Project
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-6 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Your Projects</h1>
          <p className="text-muted-foreground">Build, iterate, and deploy with AI assistance</p>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-violet-500" />
          </div>
        )}

        {/* Projects Grid */}
        {!isLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {projects.map((project) => (
              <Link key={project.id} href={`/project/${project.session_id}`}>
                <Card className="group hover:border-violet-500/50 transition-all duration-300 cursor-pointer h-full bg-card/50 backdrop-blur relative">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => handleDeleteProject(e, project.id)}
                  >
                    <Trash2 className="w-4 h-4 text-red-400" />
                  </Button>
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-violet-500/20 to-cyan-500/20 flex items-center justify-center mb-2 group-hover:from-violet-500/30 group-hover:to-cyan-500/30 transition-colors">
                        <Code2 className="w-5 h-5 text-violet-400" />
                      </div>
                      <Badge variant="secondary" className="text-xs">
                        {project.framework === 'nextjs' ? 'Next.js' : 'React'}
                      </Badge>
                    </div>
                    <CardTitle className="group-hover:text-violet-400 transition-colors">{project.name}</CardTitle>
                    <CardDescription>{project.description || 'No description'}</CardDescription>
                  </CardHeader>
                  <CardFooter className="text-xs text-muted-foreground flex justify-between">
                    <span>Created {new Date(project.created_at).toLocaleDateString()}</span>
                    <Badge variant="outline" className="text-xs capitalize">{project.current_phase}</Badge>
                  </CardFooter>
                </Card>
              </Link>
            ))}

            {/* Empty State */}
            {projects.length === 0 && (
              <Card className="border-dashed border-2 flex items-center justify-center min-h-[200px] col-span-full">
                <div className="text-center p-6">
                  <Folder className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground mb-4">No projects yet</p>
                  <Button onClick={() => setIsCreateOpen(true)}>Create your first project</Button>
                </div>
              </Card>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
