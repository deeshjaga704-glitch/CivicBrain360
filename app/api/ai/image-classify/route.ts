import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

type Result = { category: string; severity: 'LOW'|'MEDIUM'|'HIGH'|'CRITICAL'; issue: string; evidenceSummary: string; confidence: number; provider: 'openai' };

async function userFromRequest(request: Request) {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!token || !url || !key) return null;
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return (await supabase.auth.getUser(token)).data.user ?? null;
}

export async function POST(request: Request) {
  try {
    const user = await userFromRequest(request);
    if (!user) return NextResponse.json({ error: 'Authentication is required.' }, { status: 401 });
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'OPENAI_API_KEY is not configured.' }, { status: 503 });
    const body = await request.json() as { image?: string; categories?: string[] };
    if (!body.image?.startsWith('data:image/')) return NextResponse.json({ error: 'A base64 data-image is required.' }, { status: 400 });
    const model = process.env.AI_VISION_MODEL || process.env.AI_MODEL || 'gpt-4o-mini';
    const response = await fetch(process.env.OPENAI_API_BASE || 'https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'Analyze civic infrastructure evidence. Do not identify people. Return JSON only with category, severity (LOW|MEDIUM|HIGH|CRITICAL), issue, evidenceSummary, confidence (0 to 1). Use one of the supplied categories when appropriate. If the image is unclear, say so and lower confidence.' },
          { role: 'user', content: [{ type: 'text', text: JSON.stringify({ categories: (body.categories || []).slice(0, 50) }) }, { type: 'image_url', image_url: { url: body.image, detail: 'low' } }] }
        ]
      })
    });
    if (!response.ok) return NextResponse.json({ error: 'AI vision provider request failed.' }, { status: 502 });
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const parsed = JSON.parse(payload.choices?.[0]?.message?.content || '{}') as Partial<Result>;
    const severity = ['LOW','MEDIUM','HIGH','CRITICAL'].includes(parsed.severity || '') ? parsed.severity as Result['severity'] : 'MEDIUM';
    return NextResponse.json({ provider: 'openai', category: parsed.category || body.categories?.[0] || 'Other', severity, issue: parsed.issue || 'Civic infrastructure issue detected.', evidenceSummary: parsed.evidenceSummary || 'Image reviewed by AI.', confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5 });
  } catch { return NextResponse.json({ error: 'Unable to analyze the evidence image.' }, { status: 400 }); }
}
