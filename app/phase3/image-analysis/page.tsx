'use client';

import { useState } from 'react';
import { createSupabaseBrowserClient } from '@/src/lib/supabase';

export default function EvidenceVision() {
  const [preview, setPreview] = useState('');
  const [result, setResult] = useState<{category:string;severity:string;issue:string;evidenceSummary:string;confidence:number} | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const categories = ['Roads','Garbage/Waste','Water','Electricity','Street Lights','Drainage','Public Safety','Pollution','Public Infrastructure','Other'];

  async function analyze(file?: File) {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setMessage('Please select an image file.'); return; }
    if (file.size > 6 * 1024 * 1024) { setMessage('Please choose an image smaller than 6 MB.'); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      const image = String(reader.result || ''); setPreview(image); setResult(null); setBusy(true); setMessage('Analyzing civic evidence...');
      try {
        const supabase = createSupabaseBrowserClient();
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) throw new Error('Login is required for image analysis.');
        const response = await fetch('/api/ai/image-classify', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ image, categories }) });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Image analysis failed.');
        setResult(payload); setMessage('AI evidence analysis complete.');
      } catch (e) { setMessage(`Error: ${e instanceof Error ? e.message : 'Image analysis failed.'}`); }
      finally { setBusy(false); }
    };
    reader.readAsDataURL(file);
  }

  return <main><header className="hero"><div><span className="badge">PHASE 3 • AI VISION</span><h1>Civic Evidence <span>Vision</span></h1><p>Use infrastructure photos as structured evidence for civic issue triage.</p></div><nav><a className="button secondary" href="/phase3/intelligence">Intelligence Center</a><a className="button secondary" href="/phase3">Phase 3 Workflow</a></nav></header><section className="card"><div className="section-title"><div><span className="eyebrow">AI IMAGE CLASSIFICATION</span><h2>Upload civic evidence</h2><p>The model suggests an issue category and severity. It does not identify people and should be reviewed by an officer before action.</p></div></div><label className="wide">Infrastructure image<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => void analyze(e.target.files?.[0])}/></label>{preview && <div className="grid2"><div><img src={preview} alt="Selected civic evidence" style={{maxWidth:'100%',borderRadius:16}}/></div><div>{busy ? <div className="ai-panel"><h3>Analyzing…</h3><p>Please wait while the evidence is classified.</p></div> : result ? <div className="ai-result"><span className="badge ai-live">OpenAI vision</span><div className="ai-grid"><div><small>Category</small><b>{result.category}</b></div><div><small>Severity</small><b>{result.severity}</b></div><div><small>Confidence</small><b>{Math.round(result.confidence * 100)}%</b></div></div><h3>{result.issue}</h3><p>{result.evidenceSummary}</p></div> : null}</div></div>}{message && <div className={`alert ${message.startsWith('Error') ? 'error' : 'success'}`}>{message}</div>}</section></main>;
}
