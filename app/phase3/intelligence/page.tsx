'use client';

import { useEffect, useState } from 'react';
import { createSupabaseBrowserClient } from '@/src/lib/supabase';

type Risk = { complaint_id: string; risk_score: number; risk_level: string; factors: Record<string, unknown>; calculated_at: string };
type ProjectIntel = { id: string; name: string; panchayat: string | null; status: string; complaint_count: number; open_complaints: number; high_priority_complaints: number; budget_allocated: number; spent_to_date: number; remaining_budget: number; routine_maintenance_cost: number; full_replacement_cost: number; planning_horizon_years: number; recommended_intervention: string };
type Complaint = { id: string; title: string; severity: string; status: string; created_at: string };
type Escalation = { id: string; complaint_id: string; rule_key: string; rule_reason: string; created_at: string };

const supabase = createSupabaseBrowserClient();
const db = supabase as any;

export default function IntelligenceCenter() {
  const [risks, setRisks] = useState<Risk[]>([]);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [projects, setProjects] = useState<ProjectIntel[]>([]);
  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [selectedProject, setSelectedProject] = useState<ProjectIntel | null>(null);
  const [financial, setFinancial] = useState({ budget: '', spent: '', maintenance: '', replacement: '', years: '3' });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    const [riskResult, complaintResult, projectResult, escalationResult] = await Promise.all([
      supabase.from('complaint_risk_scores').select('*').order('risk_score', { ascending: false }).limit(50),
      supabase.from('complaints').select('id,title,severity,status,created_at').order('created_at', { ascending: false }).limit(100),
      supabase.from('phase3_project_intelligence').select('*').order('open_complaints', { ascending: false }),
      supabase.from('escalation_events').select('*').order('created_at', { ascending: false }).limit(30)
    ]);
    if (riskResult.error) throw riskResult.error;
    if (complaintResult.error) throw complaintResult.error;
    if (projectResult.error) throw projectResult.error;
    if (escalationResult.error) throw escalationResult.error;
    setRisks((riskResult.data ?? []) as Risk[]);
    setComplaints((complaintResult.data ?? []) as Complaint[]);
    setProjects((projectResult.data ?? []) as ProjectIntel[]);
    setEscalations((escalationResult.data ?? []) as Escalation[]);
  }

  useEffect(() => { void load().catch((e) => setMessage(`Error: ${e.message}`)); }, []);

  async function calculateRisks() {
    setBusy(true); setMessage('Calculating risk scores...');
    try {
      for (const complaint of complaints.filter((c) => !['CLOSED', 'REJECTED'].includes(c.status)).slice(0, 100)) {
        const { error } = await db.rpc('calculate_complaint_risk', { p_complaint_id: complaint.id });
        if (error) throw error;
      }
      await load(); setMessage('Risk scores updated using severity, age, local complaint density and project pressure.');
    } catch (e) { setMessage(`Error: ${e instanceof Error ? e.message : 'Risk calculation failed'}`); }
    finally { setBusy(false); }
  }

  async function runEscalation() {
    setBusy(true); setMessage('Running escalation rules...');
    try {
      const { data, error } = await db.rpc('run_phase3_automation');
      if (error) throw error;
      await load(); setMessage(`${data ?? 0} new complaint(s) escalated. Hourly automation is also enabled in Supabase.`);
    } catch (e) { setMessage(`Error: ${e instanceof Error ? e.message : 'Escalation failed'}`); }
    finally { setBusy(false); }
  }

  function chooseProject(project: ProjectIntel) {
    setSelectedProject(project);
    setFinancial({ budget: String(project.budget_allocated || ''), spent: String(project.spent_to_date || ''), maintenance: String(project.routine_maintenance_cost || ''), replacement: String(project.full_replacement_cost || ''), years: String(project.planning_horizon_years || 3) });
  }

  async function saveFinancials() {
    if (!selectedProject) return;
    setBusy(true);
    try {
      const { error } = await db.from('project_financials').upsert({
        project_id: selectedProject.id,
        budget_allocated: Number(financial.budget) || 0,
        spent_to_date: Number(financial.spent) || 0,
        routine_maintenance_cost: Number(financial.maintenance) || 0,
        full_replacement_cost: Number(financial.replacement) || 0,
        planning_horizon_years: Math.max(1, Number(financial.years) || 3)
      }, { onConflict: 'project_id' });
      if (error) throw error;
      await load(); setMessage('Project financial intelligence updated.');
    } catch (e) { setMessage(`Error: ${e instanceof Error ? e.message : 'Could not save financial data'}`); }
    finally { setBusy(false); }
  }

  const riskByComplaint = new Map(risks.map((r) => [r.complaint_id, r]));
  const critical = risks.filter((r) => r.risk_level === 'CRITICAL').length;
  const high = risks.filter((r) => r.risk_level === 'HIGH').length;

  return <main className="phase3-center">
    <header className="hero"><div><span className="badge">PHASE 3 • CIVIC INTELLIGENCE CENTER</span><h1>CivicBrain <span>360</span></h1><p>Turn civic reports into risk signals, predictions, financial decisions and automatic escalation.</p></div><a className="button secondary" href="/phase3">← Back to Phase 3</a></header>
    {message && <div className="alert success">{message}<button className="close" onClick={() => setMessage('')}>×</button></div>}

    <section className="stats grid4"><Stat label="Risk-scored reports" value={risks.length} icon="🧠"/><Stat label="Critical risk" value={critical} icon="🚨"/><Stat label="High risk" value={high} icon="⚠️"/><Stat label="Auto escalations" value={escalations.length} icon="📣"/></section>

    <section className="card"><div className="section-title"><div><span className="eyebrow">1 • RISK SCORING</span><h2>Which complaints need attention first?</h2><p>Scores combine severity, complaint age, nearby same-category density and project pressure. They are decision support, not a replacement for officer judgement.</p></div><button disabled={busy} onClick={() => void calculateRisks()}>{busy ? 'Working…' : 'Calculate risk scores'}</button></div><div className="table-wrap"><table><thead><tr><th>Complaint</th><th>Severity</th><th>Status</th><th>Risk</th><th>Signals</th></tr></thead><tbody>{complaints.slice(0, 30).map((c) => { const r = riskByComplaint.get(c.id); return <tr key={c.id}><td><b>#{c.id.slice(0,8).toUpperCase()}</b><br/>{c.title}</td><td>{c.severity}</td><td>{c.status}</td><td>{r ? <span className={`priority ${r.risk_level === 'CRITICAL' || r.risk_level === 'HIGH' ? 'urgent' : 'normal'}`}>{r.risk_score} · {r.risk_level}</span> : 'Not scored'}</td><td>{r ? <small>Age {String(r.factors.age_days)}d · Nearby {String(r.factors.nearby_open_same_category)} · Project open {String(r.factors.project_open_complaints)}</small> : '—'}</td></tr>; })}</tbody></table></div></section>

    <section className="grid2"><section className="card"><span className="eyebrow">2 • PREDICTIVE MAINTENANCE</span><h2>Infrastructure pressure</h2><p>Repeated complaint patterns become maintenance signals. Projects with recurring open issues rise to the top.</p>{projects.slice(0, 8).map((p) => <button className="list-row" key={p.id} onClick={() => chooseProject(p)}><span><b>{p.name}</b><small>{p.panchayat || 'Location not specified'} · {p.open_complaints} open · {p.high_priority_complaints} high priority</small></span><span className="badge">{p.recommended_intervention}</span></button>)}</section>

    <section className="card"><span className="eyebrow">3 • FINANCIAL × PHYSICAL INTELLIGENCE</span><h2>Cost-aware intervention</h2>{selectedProject ? <><h3>{selectedProject.name}</h3><div className="grid2"><label>Allocated budget<input value={financial.budget} onChange={e => setFinancial({ ...financial, budget: e.target.value })}/></label><label>Spent to date<input value={financial.spent} onChange={e => setFinancial({ ...financial, spent: e.target.value })}/></label><label>Maintenance cost / intervention<input value={financial.maintenance} onChange={e => setFinancial({ ...financial, maintenance: e.target.value })}/></label><label>Full replacement cost<input value={financial.replacement} onChange={e => setFinancial({ ...financial, replacement: e.target.value })}/></label><label>Planning horizon (years)<input value={financial.years} onChange={e => setFinancial({ ...financial, years: e.target.value })}/></label></div><button onClick={() => void saveFinancials()} disabled={busy}>Save financial model</button><p className="hint">Recommendation compares repeated maintenance cost over the planning horizon with full replacement cost.</p></> : <p>Select a project on the left to add budget and lifecycle cost data.</p>}</section></section>

    <section className="card"><div className="section-title"><div><span className="eyebrow">4 • AUTOMATIC ESCALATION</span><h2>Rules that prevent complaints from disappearing</h2><p>Production automation checks unresolved complaints hourly. The same engine can be run manually for a live demonstration.</p></div><button disabled={busy} onClick={() => void runEscalation()}>{busy ? 'Running…' : 'Run escalation scan now'}</button></div><div className="grid3"><Rule title="30-day timeout" text="Unresolved complaints older than 30 days are escalated."/><Rule title="Critical timeout" text="Critical complaints older than 7 days are escalated."/><Rule title="Complaint cluster" text="Five or more similar nearby open complaints in 14 days are escalated."/></div>{escalations.length > 0 && <div className="timeline">{escalations.slice(0, 8).map(e => <div key={e.id}><span/><div><b>#{e.complaint_id.slice(0,8).toUpperCase()} · {e.rule_key}</b><small>{e.rule_reason} · {new Date(e.created_at).toLocaleString()}</small></div></div>)}</div>}</section>

    <section className="card feature"><span className="eyebrow">PHASE 3 STATUS</span><h2>The intelligence layer is now connected to the Phase 2 foundation.</h2><p>AI complaint classification and duplicate detection already exist in CivicBrain360. This center adds persistent risk scores, predictive maintenance signals, financial-vs-physical recommendations and automatic escalation on top of that foundation.</p><a className="button secondary" href="/phase3">Open complaint workflow →</a></section>
  </main>;
}

function Stat({ label, value, icon }: { label: string; value: string | number; icon: string }) { return <div className="stat"><span>{icon}</span><div><b>{value}</b><small>{label}</small></div></div>; }
function Rule({ title, text }: { title: string; text: string }) { return <article className="card"><b>{title}</b><p>{text}</p></article>; }
