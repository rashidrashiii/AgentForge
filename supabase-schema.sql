-- =====================================================
-- Code Agent - Supabase Database Schema
-- Run this in your Supabase SQL Editor
-- =====================================================

-- 1. PROJECTS TABLE
-- Main table for storing project information
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Core Fields
  name VARCHAR(255) NOT NULL,
  description TEXT,
  session_id VARCHAR(100) UNIQUE NOT NULL,
  
  -- Framework & Configuration
  framework VARCHAR(20) NOT NULL DEFAULT 'react' CHECK (framework IN ('react', 'nextjs')),
  
  -- State Management
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'building', 'error', 'archived')),
  current_phase VARCHAR(30) DEFAULT 'idle' CHECK (current_phase IN (
    'idle', 'planning', 'awaiting_approval', 'coding', 'verifying', 'complete'
  )),
  
  -- Metadata (flexible JSON)
  metadata JSONB DEFAULT '{}',
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- Indexes for projects
CREATE INDEX IF NOT EXISTS idx_projects_session_id ON projects(session_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects(updated_at DESC);

-- 2. CHAT MESSAGES TABLE
-- Stores all chat history
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  
  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  phase VARCHAR(30),
  
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for chat_messages
CREATE INDEX IF NOT EXISTS idx_chat_project ON chat_messages(project_id);
CREATE INDEX IF NOT EXISTS idx_chat_created ON chat_messages(created_at DESC);

-- 3. PLANS TABLE
-- Stores AI-generated plans for approval
CREATE TABLE IF NOT EXISTS plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  
  request TEXT NOT NULL,
  plan_text TEXT NOT NULL,
  
  components JSONB DEFAULT '[]',
  files JSONB DEFAULT '[]',
  steps JSONB DEFAULT '[]',
  
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'superseded')),
  approved_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Only one pending plan per project
CREATE UNIQUE INDEX IF NOT EXISTS idx_plans_pending ON plans(project_id) WHERE status = 'pending';

-- 4. FILE CHANGES TABLE
-- Tracks file modifications
CREATE TABLE IF NOT EXISTS file_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  plan_id UUID REFERENCES plans(id),
  
  file_path VARCHAR(500) NOT NULL,
  change_type VARCHAR(20) NOT NULL CHECK (change_type IN ('created', 'modified', 'deleted')),
  
  content_before TEXT,
  content_after TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for file_changes
CREATE INDEX IF NOT EXISTS idx_file_changes_project ON file_changes(project_id);
CREATE INDEX IF NOT EXISTS idx_file_changes_plan ON file_changes(plan_id);

-- 5. AUTO-UPDATE TRIGGER
-- Automatically updates updated_at column
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to projects
DROP TRIGGER IF EXISTS projects_updated_at ON projects;
CREATE TRIGGER projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- 6. ENABLE ROW LEVEL SECURITY (for future multi-user)
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_changes ENABLE ROW LEVEL SECURITY;

-- 7. PUBLIC ACCESS POLICIES (for development - restrict in production)
CREATE POLICY "Allow all for development" ON projects FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for development" ON chat_messages FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for development" ON plans FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for development" ON file_changes FOR ALL USING (true) WITH CHECK (true);

-- =====================================================
-- DONE! Your schema is ready.
-- =====================================================
