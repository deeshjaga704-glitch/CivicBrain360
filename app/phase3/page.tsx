'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { classifyComplaint } from '@/src/lib/ai';
import { citizenVerifyResolution, createComplaint, findDuplicateComplaints, nearbyProjects, reviewDuplicateLink, transitionComplaint, uploadEvidence } from '@/src/lib/civic-supabase';
import { login, logout, register } from '@/src/lib/auth';
import { createSupabaseBrowserClient } from '@/src/lib/supabase';
import { userFacingError } from '@/src/lib/errors';
import type { AiSuggestion, Category, Complaint, ComplaintAiAnalysis, ComplaintStatus, Department, DuplicateMatch, Evidence, Notification, Profile, Project, StatusHistory } from '@/src/lib/types';

const CivicMap = dynamic(() => import('@/src/components/CivicMap'), { ssr: false, loading: () => <div className="map-empty">Loading Civic Map…</div> });
const statuses: ComplaintStatus[] = ['SUBMITTED', 'VERIFIED', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CITIZEN_VERIFICATION', 'CLOSED', 'REOPENED', 'ESCALATED', 'ON_HOLD', 'REJECTED'];
type Tab = 'overview' | 'report' | 'complaints' | 'officer' | 'admin' | 'projects';
const msg = (error: unknown) => userFacingError(error);
const shortId = (id: string) => id.slice(0, 8).toUpperCase();
const ageInDays = (createdAt: string) => Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000);
const isClosed = (status: ComplaintStatus) => ['CLOSED', 'REJECTED'].includes(status);
const isUrgent = (complaint: Complaint) => complaint.severity === 'CRITICAL' || (complaint.severity === 'HIGH' && !isClosed(complaint.status));

export default function Phase3Page() {
  const supabase = useMemo(() => {
    try { return createSupabaseBrowserClient(); } catch { return null; }
  }, []);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [officers, setOfficers] = useState<Profile[]>([]);
  const [tab, setTab] = useState<Tab>('overview');
  const [selected, setSelected] = useState<Complaint | null>(null);
  const [history, setHistory] = useState<StatusHistory[]>([]);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [detailAi, setDetailAi] = useState<ComplaintAiAnalysis | null>(null);
  const [detailDuplicates, setDetailDuplicates] = useState<DuplicateMatch[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [filter, setFilter] = useState<ComplaintStatus | 'ALL'>('ALL');
  const [officerScope, setOfficerScope] = useState('ALL');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<AiSuggestion | null>(null);
  const [acceptedAi, setAcceptedAi] = useState<{ categoryId?: string; severity?: string; departmentId?: string; priority?: AiSuggestion['priority']; summary?: string }>({});
  const [duplicateMatches, setDuplicateMatches] = useState<DuplicateMatch[]>([]);
  const [form, setForm] = useState({ title: '', categoryId: '', description: '', latitude: '', longitude: '', address: '', severity: 'MEDIUM', projectId: '' });
  const isOfficer = ['Officer', 'Department Admin', 'Super Admin'].includes(profile?.role ?? '');
  const isAdmin = ['Department Admin', 'Super Admin'].includes(profile?.role ?? '');
  const visible = filter === 'ALL' ? complaints : complaints.filter((complaint) => complaint.status === filter);
  const open = complaints.filter((complaint) => !isClosed(complaint.status)).length;
  const resolved = complaints.filter((complaint) => ['RESOLVED', 'CLOSED'].includes(complaint.status)).length;
  const critical = complaints.filter((complaint) => isUrgent(complaint) && !isClosed(complaint.status)).length;
  const officerVisible = visible.filter((complaint) => officerScope === 'ASSIGNED_TO_ME' ? complaint.assigned_to === profile?.id : officerScope === 'UNASSIGNED' ? !complaint.assigned_to : officerScope === 'URGENT' ? isUrgent(complaint) : true);

  const refresh = useCallback(async () => {
    if (!supabase) { setMessage('Configure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to connect CivicBrain360.'); return; }
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError) throw authError;
    let currentProfile: Profile | null = null;
    if (auth.user) {
      const profileResult = await supabase.from('profiles').select('*').eq('id', auth.user.id).maybeSingle();
      if (profileResult.error) throw profileResult.error;
      currentProfile = profileResult.data as Profile | null;
    }
    const [categoryResult, departmentResult, projectResult] = await Promise.all([
      supabase.from('categories').select('*').eq('is_active', true).order('name'),
      supabase.from('departments').select('*').order('name'),
      supabase.from('projects').select('*').order('name').limit(100)
    ]);
    if (categoryResult.error) throw categoryResult.error;
    if (departmentResult.error && auth.user) throw departmentResult.error;
    if (projectResult.error) throw projectResult.error;
    let complaintRows: Complaint[] = [];
    if (auth.user) {
      const complaintResult = await supabase.from('complaints').select('*').order('created_at', { ascending: false }).limit(100);
      if (complaintResult.error) throw complaintResult.error;
      complaintRows = (complaintResult.data ?? []) as Complaint[];
    }
    setProfile(currentProfile);
    setCategories((categoryResult.data ?? []) as Category[]);
    setDepartments((departmentResult.data ?? []) as Department[]);
    setComplaints(complaintRows);
    setProjects((projectResult.data ?? []) as Project[]);
    if (auth.user) {
      const notificationResult = await supabase.from('notifications').select('*').eq('user_id', auth.user.id).order('created_at', { ascending: false }).limit(20);
      if (notificationResult.error) throw notificationResult.error;
      setNotifications(notificationResult.data ?? []);
      if (['Officer', 'Department Admin', 'Super Admin'].includes(currentProfile?.role ?? '')) {
        const officerResult = await supabase.from('profiles').select('*').in('role', ['Officer', 'Department Admin', 'Super Admin']).order('full_name');
        if (officerResult.error) throw officerResult.error;
        setOfficers((officerResult.data ?? []) as Profile[]);
      } else setOfficers([]);
    } else { setNotifications([]); setOfficers([]); }
  }, [supabase]);

  const selectComplaint = useCallback(async (complaint: Complaint) => {
    if (!supabase) return;
    setSelected(complaint);
    const [historyResult, evidenceResult, aiResult] = await Promise.all([
      supabase.from('complaint_status_history').select('*').eq('complaint_id', complaint.id).order('created_at', { ascending: true }),
      supabase.from('evidence').select('*').eq('complaint_id', complaint.id).order('created_at', { ascending: false }),
      supabase.from('complaint_ai_analysis').select('*').eq('complaint_id', complaint.id).order('created_at', { ascending: false }).limit(1)
    ]);
    if (historyResult.error) throw historyResult.error;
    if (evidenceResult.error) throw evidenceResult.error;
    setHistory((historyResult.data ?? []) as StatusHistory[]);
    const evidenceRows = (evidenceResult.data ?? []) as Evidence[];
    const bucket = process.env.NEXT_PUBLIC_EVIDENCE_BUCKET || 'evidence';
    const signedEvidence = await Promise.all(evidenceRows.map(async (item) => {
      const { data: signed } = await supabase.storage.from(bucket).createSignedUrl(item.file_path, 3600);
      return { ...item, file_url: signed?.signedUrl ?? null };
    }));
    setEvidence(signedEvidence);
    setDetailAi((aiResult.data?.[0] as ComplaintAiAnalysis | undefined) ?? null);
    try { setDetailDuplicates((await findDuplicateComplaints({ categoryId: complaint.category_id, title: complaint.title, description: complaint.description, latitude: complaint.latitude, longitude: complaint.longitude })).filter((match) => match.id !== complaint.id)); } catch { setDetailDuplicates([]); }
  }, [supabase]);

  useEffect(() => { void refresh().catch((error) => setMessage(`Error: ${msg(error)}`)); }, [refresh]);

  useEffect(() => {
    const requestedId = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('complaint');
    if (!requestedId || !complaints.length) return;
    const complaint = complaints.find((item) => item.id === requestedId);
    if (complaint && selected?.id !== complaint.id) void selectComplaint(complaint).catch((error) => setMessage(`Error: ${msg(error)}`));
    if (!complaint) setMessage('Complaint not found or you are not authorized to view it.');
  }, [complaints, selected?.id, selectComplaint]);

  async function locate() {
    if (!navigator.geolocation) { setMessage('Location is not supported by this browser.'); return; }
    navigator.geolocation.getCurrentPosition((position) => setForm((current) => ({ ...current, latitude: position.coords.latitude.toFixed(6), longitude: position.coords.longitude.toFixed(6) })), (error) => setMessage(`Location error: ${error.message}`), { enableHighAccuracy: true, timeout: 10000 });
  }

  async function analyze() {
    if (!form.title.trim() && !form.description.trim()) { setMessage('Add a title or description before requesting AI analysis.'); return; }
    setAiBusy(true);
    try {
      const result = await classifyComplaint({ title: form.title, description: form.description, categories: categories.map((category) => category.name), departments: departments.map((department) => department.name) });
      setAiAnalysis(result);
      setMessage(result.isAvailable ? 'AI analysis ready for your review.' : 'Demo classification ready. No AI provider is configured, so nothing will be overwritten automatically.');
    } catch (error) { setMessage(`AI analysis unavailable: ${msg(error)}`); }
    finally { setAiBusy(false); }
  }

  function applyAiSuggestion() {
    if (!aiAnalysis) return;
    const category = categories.find((item) => item.name.toLowerCase() === aiAnalysis.category.toLowerCase());
    const department = departments.find((item) => item.name.toLowerCase() === aiAnalysis.department.toLowerCase());
    setForm((current) => ({ ...current, categoryId: category?.id ?? current.categoryId, severity: aiAnalysis.severity }));
    setAcceptedAi({ categoryId: category?.id, severity: aiAnalysis.severity, departmentId: department?.id, priority: aiAnalysis.priority, summary: aiAnalysis.shortSummary });
    setMessage('AI suggestion applied. Review and modify any field before submitting.');
  }

  async function submit() {
    if (!profile) { setMessage('Please login before submitting a complaint.'); return; }
    setBusy(true);
    try {
      const latitude = Number(form.latitude); const longitude = Number(form.longitude);
      const matches = await findDuplicateComplaints({ categoryId: form.categoryId, title: form.title, description: form.description, latitude, longitude });
      setDuplicateMatches(matches);
      if (matches.length) setMessage(`Similar complaints have already been reported in this area. Review ${matches.length} possible match(es); you may still submit a new report.`);
      const nearby = await nearbyProjects(latitude, longitude);
      const complaintId = await createComplaint({ ...form, latitude, longitude, projectId: form.projectId || nearby[0]?.id, aiAnalysis: aiAnalysis ?? undefined, acceptedAi });
      if (file) await uploadEvidence({ file, complaintId, evidenceType: file.type.startsWith('image/') ? 'PHOTO' : file.type.startsWith('video/') ? 'VIDEO' : 'DOCUMENT', metadata: { source: 'complaint_submission', original_name: file.name, mime_type: file.type } });
      setForm({ title: '', categoryId: '', description: '', latitude: '', longitude: '', address: '', severity: 'MEDIUM', projectId: '' });
      setFile(null); setAiAnalysis(null); setAcceptedAi({}); setDuplicateMatches([]);
      await refresh();
      const created = complaints.find((complaint) => complaint.id === complaintId);
      if (created) await selectComplaint(created);
      setTab('complaints');
      setMessage(`Complaint #${shortId(complaintId)} submitted successfully.`);
    } catch (error) { setMessage(`Error: ${msg(error)}`); }
    finally { setBusy(false); }
  }

  async function action(fn: () => Promise<unknown>, success: string) {
    setBusy(true);
    try { await fn(); setMessage(success); await refresh(); if (selected) await selectComplaint(selected); }
    catch (error) { setMessage(`Error: ${msg(error)}`); }
    finally { setBusy(false); }
  }

  async function upload() {
    if (!selected || !file) return;
    await action(() => uploadEvidence({ file, complaintId: selected.id, evidenceType: file.type.startsWith('image/') ? 'PHOTO' : file.type.startsWith('video/') ? 'VIDEO' : 'DOCUMENT', metadata: { source: 'complaint_detail', original_name: file.name, mime_type: file.type } }), 'Evidence uploaded.');
    setFile(null);
  }

  const openComplaintFromMap = (complaint: Complaint) => { void selectComplaint(complaint).catch((error) => setMessage(`Error: ${msg(error)}`)); setTab('complaints'); };

  return <main>
    <header className="hero"><div><span className="badge">PHASE 3 • CIVIC INTELLIGENCE</span><h1>CivicBrain <span>360</span></h1><p>Report. Track. Resolve. Make every civic issue visible.</p></div><div className="auth-box">{profile ? <><strong>{profile.full_name || 'Citizen'}</strong><small>{profile.role}</small><button className="secondary" onClick={() => logout().then(refresh).then(() => setMessage('Logged out.')).catch((error) => setMessage(`Error: ${msg(error)}`))}>Logout</button></> : <button onClick={() => document.getElementById('auth')?.scrollIntoView({ behavior: 'smooth' })}>Login / Register</button>}</div></header>
    <nav className="tabs">{(['overview', 'report', 'complaints', 'officer', 'admin', 'projects'] as Tab[]).map((item) => (item === 'officer' && !isOfficer) || (item === 'admin' && !isAdmin) ? null : <button key={item} className={tab === item ? 'active' : 'secondary'} onClick={() => setTab(item)}>{item === 'overview' ? 'Overview' : item === 'report' ? 'Report Issue' : item === 'complaints' ? 'My Complaints' : item === 'officer' ? 'Officer Desk' : item === 'admin' ? 'Admin' : 'Projects'}</button>)}<a className="tab-link" href="/map">Civic Map</a></nav>
    {message && <div className={`alert ${message.startsWith('Error') || message.includes('unavailable') ? 'error' : 'success'}`}>{message}<button className="close" onClick={() => setMessage('')}>×</button></div>}

    {tab === 'overview' && <><section className="stats grid4"><Stat label="Total Reports" value={complaints.length} icon="📋"/><Stat label="Active Reports" value={open} icon="🔎"/><Stat label="Resolved" value={resolved} icon="✅"/><Stat label="Urgent Open" value={critical} icon="🚨"/></section><div className="grid2"><section className="card feature"><span className="eyebrow">CITIZEN POWER</span><h2>One report can move a whole community.</h2><p>Detect duplicates, link issues to projects, preserve the full status history, and let citizens verify the final resolution.</p><nav><button onClick={() => setTab('report')}>Report a Civic Issue →</button><a className="button secondary" href="/map">Open Civic Map</a></nav></section><section className="card"><h2>Recent activity</h2>{complaints.slice(0, 6).map((complaint) => <button className="list-row" key={complaint.id} onClick={() => { void selectComplaint(complaint).catch((error) => setMessage(`Error: ${msg(error)}`)); setTab('complaints'); }}><span><b>#{shortId(complaint.id)}</b> {complaint.title}</span><Status status={complaint.status}/></button>)}{!complaints.length && <Empty text="No complaints yet."/>}</section></div><section id="auth" className="card"><h2>Account access</h2><div className="grid3"><label>Email<input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com"/></label><label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••"/></label><label>Full name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="For registration"/></label></div><nav><button onClick={() => login(email, password).then(refresh).then(() => setMessage('Welcome back!')).catch((error) => setMessage(`Error: ${msg(error)}`))}>Login</button><button className="secondary" onClick={() => register(email, password, name).then(refresh).then(() => setMessage('Registered. Check email if confirmation is enabled.')).catch((error) => setMessage(`Error: ${msg(error)}`))}>Create Citizen Account</button></nav></section></>}

    {tab === 'report' && <section className="card"><div className="section-title"><div><span className="eyebrow">NEW REPORT</span><h2>Tell us what is happening</h2></div><button className="secondary" onClick={() => void locate()}>📍 Use my location</button></div><div className="grid2"><label className="wide">Complaint title<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Short summary of the issue" maxLength={160}/></label><label>Category<select value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })}><option value="">Choose a category</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label>Severity<select value={form.severity} onChange={(event) => setForm({ ...form, severity: event.target.value })}>{['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((severity) => <option key={severity}>{severity}</option>)}</select></label><label className="wide">Description<textarea rows={5} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Describe the issue, landmarks and impact."/></label><label>Latitude<input value={form.latitude} onChange={(event) => setForm({ ...form, latitude: event.target.value })} placeholder="12.9716"/></label><label>Longitude<input value={form.longitude} onChange={(event) => setForm({ ...form, longitude: event.target.value })} placeholder="77.5946"/></label><label className="wide">Address / landmark<input value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })}/></label><label className="wide">Related project<select value={form.projectId} onChange={(event) => setForm({ ...form, projectId: event.target.value })}><option value="">Auto-detect nearby project</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label className="wide">Image / evidence<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf,video/mp4" onChange={(event) => setFile(event.target.files?.[0] ?? null)}/></label></div><div className="ai-panel"><div className="section-title"><div><span className="eyebrow">OPTIONAL ASSISTANCE</span><h3>AI Analysis</h3></div><button className="secondary" disabled={aiBusy} onClick={() => void analyze()}>{aiBusy ? 'Analyzing…' : 'Analyze complaint'}</button></div>{!aiAnalysis && <p className="hint">Suggestions never overwrite your entries. Without an AI provider, CivicBrain360 uses a clearly marked deterministic demo fallback.</p>}{aiAnalysis && <div className="ai-result"><span className={`badge ${aiAnalysis.isAvailable ? 'ai-live' : 'ai-demo'}`}>{aiAnalysis.isAvailable ? 'AI provider' : 'Demo fallback'}</span><div className="ai-grid"><div><small>Category</small><b>{aiAnalysis.category}</b></div><div><small>Severity</small><b>{aiAnalysis.severity}</b></div><div><small>Department</small><b>{aiAnalysis.department}</b></div><div><small>Priority</small><b>{aiAnalysis.priority}</b></div></div><p>{aiAnalysis.shortSummary}</p><button className="secondary" onClick={applyAiSuggestion}>Apply suggestion for review</button></div>}</div><button disabled={busy} onClick={() => void submit()}>{busy ? 'Submitting…' : 'Check duplicates & submit report'}</button>{duplicateMatches.length > 0 && <DuplicatePanel matches={duplicateMatches} title="Possible duplicates found"/>}<p className="hint">Reports keep the original citizen values, optional AI analysis, audit history, project links, notifications, and evidence association.</p></section>}

    {tab === 'complaints' && <div className="grid2"><section className="card"><div className="section-title"><h2>{profile ? 'Your complaints' : 'Complaint explorer'}</h2><select value={filter} onChange={(event) => setFilter(event.target.value as ComplaintStatus | 'ALL')}><option value="ALL">ALL</option>{statuses.map((status) => <option key={status}>{status}</option>)}</select></div>{visible.filter((complaint) => !profile || complaint.created_by === profile.id).map((complaint) => <button className={`complaint-row ${selected?.id === complaint.id ? 'selected' : ''}`} key={complaint.id} onClick={() => void selectComplaint(complaint).catch((error) => setMessage(`Error: ${msg(error)}`))}><div><strong>#{shortId(complaint.id)}</strong><p>{complaint.title}</p><small>{new Date(complaint.created_at).toLocaleString()} · {complaint.severity} · {complaint.address || 'Location recorded'}</small></div><Status status={complaint.status}/></button>)}{!visible.filter((complaint) => !profile || complaint.created_by === profile.id).length && <Empty text={profile ? 'No complaints match this filter.' : 'Login to see your complaints.'}/>}</section><Detail complaint={selected} profile={profile} history={history} evidence={evidence} ai={detailAi} duplicates={detailDuplicates} file={file} setFile={setFile} upload={upload} action={action} isOfficer={isOfficer}/></div>}

    {tab === 'officer' && isOfficer && <section className="card"><div className="section-title"><div><span className="eyebrow">OPERATIONS</span><h2>Officer desk</h2></div><nav><select value={officerScope} onChange={(event) => setOfficerScope(event.target.value)}><option value="ALL">All visible</option><option value="ASSIGNED_TO_ME">Assigned to me</option><option value="UNASSIGNED">Unassigned</option><option value="URGENT">Urgent / high priority</option></select><select value={filter} onChange={(event) => setFilter(event.target.value as ComplaintStatus | 'ALL')}><option value="ALL">All statuses</option>{statuses.map((status) => <option key={status}>{status}</option>)}</select></nav></div><div className="table-wrap"><table><thead><tr><th>Issue</th><th>Priority</th><th>Status</th><th>Location</th><th>Assign</th><th>Actions</th></tr></thead><tbody>{officerVisible.map((complaint) => <tr key={complaint.id}><td><b>#{shortId(complaint.id)}</b><br/>{complaint.title}<br/><small>{complaint.description}</small>{isUrgent(complaint) && <span className="priority urgent">Urgent</span>}</td><td><Priority complaint={complaint}/></td><td><Status status={complaint.status}/>{ageInDays(complaint.created_at) >= 7 && !isClosed(complaint.status) && <span className="priority overdue">Overdue</span>}</td><td>{complaint.address || `${complaint.latitude}, ${complaint.longitude}`}</td><td><select value={complaint.assigned_to ?? ''} onChange={(event) => void action(() => transitionComplaint(complaint.id, 'ASSIGNED', 'Assignment updated from officer desk', event.target.value), 'Complaint assignment updated.')}><option value="">Unassigned</option>{officers.map((officer) => <option key={officer.id} value={officer.id}>{officer.full_name || officer.id.slice(0, 6)}</option>)}</select></td><td><nav className="mini">{complaint.status === 'SUBMITTED' && <button onClick={() => void action(() => transitionComplaint(complaint.id, 'VERIFIED', 'Officer verified'), 'Verified.')}>Verify</button>}{['VERIFIED', 'ASSIGNED', 'REOPENED'].includes(complaint.status) && <button onClick={() => void action(() => transitionComplaint(complaint.id, 'IN_PROGRESS', 'Work started'), 'Work started.')}>Start</button>}{complaint.status === 'IN_PROGRESS' && <button onClick={() => void action(() => transitionComplaint(complaint.id, 'RESOLVED', 'Resolution completed'), 'Marked resolved.')}>Resolve</button>}{complaint.status === 'SUBMITTED' && <button className="secondary" onClick={() => void action(() => transitionComplaint(complaint.id, 'REJECTED', 'Rejected after officer review'), 'Complaint rejected.')}>Reject</button>}</nav></td></tr>)}</tbody></table>{!officerVisible.length && <Empty text="No complaints match the officer filters."/>}</div></section>}

    {tab === 'admin' && isAdmin && <section className="grid2"><section className="card"><span className="eyebrow">ADMIN OVERVIEW</span><h2>System health</h2><div className="admin-metrics"><Stat label="Unique reporters" value={new Set(complaints.map((complaint) => complaint.created_by)).size} icon="👥"/><Stat label="Projects" value={projects.length} icon="🏗️"/><Stat label="Departments" value={new Set(projects.map((project) => project.department_id).filter(Boolean)).size} icon="🏢"/><Stat label="Resolution rate" value={`${complaints.length ? Math.round(resolved / complaints.length * 100) : 0}%`} icon="📈"/></div></section><section className="card"><h2>Severity watch</h2>{['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((severity) => <div className="bar-row" key={severity}><b>{severity}</b><div className="bar"><i style={{ width: `${complaints.length ? Math.round(complaints.filter((complaint) => complaint.severity === severity).length / complaints.length * 100) : 0}%` }}/></div><span>{complaints.filter((complaint) => complaint.severity === severity).length}</span></div>)}</section><section className="card wide"><h2>Status management</h2><div className="admin-list">{visible.map((complaint) => <div className="admin-row" key={complaint.id}><span><b>#{shortId(complaint.id)}</b> {complaint.title}</span><Status status={complaint.status}/><select value={complaint.status} onChange={(event) => void action(() => transitionComplaint(complaint.id, event.target.value as ComplaintStatus, 'Admin status update'), 'Status updated.')}>{statuses.map((status) => <option key={status}>{status}</option>)}</select></div>)}</div></section></section>}

    {tab === 'projects' && <section className="card"><div className="section-title"><div><span className="eyebrow">PUBLIC INTELLIGENCE</span><h2>Project explorer</h2></div><span className="badge">{projects.length} projects</span></div><div className="project-grid">{projects.map((project) => <article className="project" key={project.id}><span className="project-icon">🏗️</span><h3>{project.name}</h3><Status status={project.status}/><p>{project.description || 'No description provided.'}</p><small>{project.panchayat || 'Location not specified'} · {project.latitude ?? '—'}, {project.longitude ?? '—'}</small><div className="project-footer">{complaints.filter((complaint) => complaint.project_id === project.id).length} linked reports</div></article>)}{!projects.length && <Empty text="No projects available."/>}</div></section>}

    {notifications.length > 0 && <aside className="notifications"><b>🔔 Notifications</b>{notifications.slice(0, 4).map((notification) => <button key={notification.id} onClick={async () => { try { await supabase?.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', notification.id); await refresh(); } catch (error) { setMessage(`Error: ${msg(error)}`); } }} className={notification.read_at ? 'read' : ''}><strong>{notification.title}</strong><span>{notification.body}</span></button>)}</aside>}
  </main>;
}

function Stat({ label, value, icon }: { label: string; value: string | number; icon: string }) { return <div className="stat"><span>{icon}</span><div><b>{value}</b><small>{label}</small></div></div>; }
function Status({ status }: { status: string }) { return <span className={`status s-${status.toLowerCase()}`}>{status.replaceAll('_', ' ')}</span>; }
function Priority({ complaint }: { complaint: Complaint }) { return <span className={`priority ${isUrgent(complaint) ? 'urgent' : 'normal'}`}>{isUrgent(complaint) ? 'HIGH' : complaint.severity === 'LOW' ? 'LOW' : 'NORMAL'}</span>; }
function Empty({ text }: { text: string }) { return <div className="empty">{text}</div>; }
function DuplicatePanel({ matches, title }: { matches: DuplicateMatch[]; title: string }) { return <div className="duplicate-panel"><b>{title}</b><p>Similar complaints have already been reported in this area. No complaints were merged automatically.</p>{matches.slice(0, 5).map((match) => <a key={match.id} href={`/phase3?complaint=${match.id}`}>#{shortId(match.id)} · {match.status} · {match.similarityScore}% match</a>)}</div>; }

function Detail({ complaint, profile, history, evidence, ai, duplicates, file, setFile, upload, action, isOfficer }: { complaint: Complaint | null; profile: Profile | null; history: StatusHistory[]; evidence: Evidence[]; ai: ComplaintAiAnalysis | null; duplicates: DuplicateMatch[]; file: File | null; setFile: (file: File | null) => void; upload: () => Promise<void>; action: (fn: () => Promise<unknown>, success: string) => Promise<void>; isOfficer: boolean }) {
  if (!complaint) return <section className="card detail empty">Select a complaint to view its timeline, evidence, AI analysis, related complaints, and actions.</section>;
  const canVerify = profile?.id === complaint.created_by && complaint.status === 'CITIZEN_VERIFICATION';
  return <section className="card detail"><div className="section-title"><div><span className="eyebrow">COMPLAINT #{shortId(complaint.id)}</span><h2>{complaint.title}</h2><p>{complaint.description}</p></div><Status status={complaint.status}/></div><div className="detail-grid"><div><small>Severity</small><b>{complaint.severity}</b></div><div><small>Address</small><b>{complaint.address || 'Not provided'}</b></div><div><small>Coordinates</small><b>{complaint.latitude}, {complaint.longitude}</b></div><div><small>Created</small><b>{new Date(complaint.created_at).toLocaleString()}</b></div>{isOfficer && <><div><small>Assigned officer</small><b>{complaint.assigned_to || 'Unassigned'}</b></div><div><small>Department</small><b>{complaint.department_id || 'Not assigned'}</b></div></>}</div><h3>Status timeline</h3><div className="timeline">{history.map((item) => <div key={item.id}><span/><div><b>{String(item.to_status).replaceAll('_', ' ')}</b><small>{item.reason || 'Status updated'} · {new Date(item.created_at).toLocaleString()}</small></div></div>)}{!history.length && <small>No status history available.</small>}</div>{canVerify && <div className="verify"><b>Was this issue actually resolved?</b><nav><button onClick={() => void action(() => citizenVerifyResolution(complaint.id, true), 'Complaint closed. Thanks for verifying.')}>Yes, resolved</button><button className="secondary" onClick={() => void action(() => citizenVerifyResolution(complaint.id, false, 'Issue still exists'), 'Complaint reopened.')}>No, reopen</button></nav></div>}<h3>AI analysis</h3>{ai ? <div className="ai-result"><span className={`badge ${ai.is_available ? 'ai-live' : 'ai-demo'}`}>{ai.is_available ? 'Provider result' : 'Demo fallback'}</span><div className="ai-grid"><div><small>Category</small><b>{ai.category_suggestion || '—'}</b></div><div><small>Severity</small><b>{ai.severity_suggestion || '—'}</b></div><div><small>Department</small><b>{ai.department_suggestion || '—'}</b></div><div><small>Priority</small><b>{ai.priority_suggestion || '—'}</b></div></div><p>{ai.short_summary || 'No summary available.'}</p></div> : <small>No AI analysis stored for this complaint.</small>}<h3>Related complaints</h3>{duplicates.length ? <DuplicatePanel matches={duplicates} title="Possibly related complaints"/> : <small>No similar unresolved complaints found.</small>}{isOfficer && duplicates.length > 0 && <nav className="mini"><button onClick={() => void action(() => reviewDuplicateLink(complaint.id, duplicates[0].id, 'CONFIRMED'), 'Duplicate relationship confirmed.')}>Link first possible duplicate</button><button className="secondary" onClick={() => void action(() => reviewDuplicateLink(complaint.id, duplicates[0].id, 'REJECTED'), 'Duplicate suggestion rejected.')}>Reject suggestion</button></nav>}<h3>Evidence</h3><div className="evidence">{evidence.map((item) => <a key={item.id} href={item.file_url || '#'} target="_blank" rel="noreferrer">📎 {item.evidence_type} · {new Date(item.created_at).toLocaleDateString()}</a>)}{!evidence.length && <small>No evidence uploaded yet.</small>}</div>{profile && <div className="upload"><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf,video/mp4" onChange={(event) => setFile(event.target.files?.[0] ?? null)}/><button disabled={!file} onClick={() => void upload()}>Upload evidence</button></div>}</section>;
}
