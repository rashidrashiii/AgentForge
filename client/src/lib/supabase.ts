import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Types
export interface Project {
    id: string;
    name: string;
    description: string | null;
    framework: 'nextjs' | 'react';
    session_id: string;
    status: string;
    created_at: string;
    updated_at: string;
}

export interface ChatMessage {
    id: string;
    project_id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    created_at: string;
}
