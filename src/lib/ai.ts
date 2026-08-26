import type { AiSuggestion } from './types';
import { createSupabaseBrowserClient } from './supabase';

export async function classifyComplaint(input: { title: string; description: string; categories: string[]; departments: string[] }): Promise<AiSuggestion> {
  const supabase = createSupabaseBrowserClient();
  const { data: sessionResult, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  const token = sessionResult.session?.access_token;
  if (!token) throw new Error('Login is required for AI analysis.');
  const response = await fetch('/api/ai/classify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(input)
  });
  const payload = await response.json() as AiSuggestion & { error?: string };
  if (!response.ok) throw new Error(payload.error || 'AI analysis failed.');
  return payload;
}
