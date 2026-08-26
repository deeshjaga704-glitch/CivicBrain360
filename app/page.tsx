'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { login, logout, register } from '@/src/lib/auth';
import { canPerformOfficerAction } from '@/src/lib/roles';
import { citizenVerifyResolution, createComplaint, findDuplicateComplaints, nearbyProjects, supportComplaint, transitionComplaint, uploadEvidence } from '@/src/lib/civic-supabase';
import { createSupabaseBrowserClient } from '@/src/lib/supabase';
import { userFacingError } from '@/src/lib/errors';
import type { Category, Complaint, Profile, Project } from '@/src/lib/types';

function errorMessage(error: unknown) {
  return userFacingError(error);
}

export default function HomePage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ title: '', categoryId: '', description: '', latitude: '12.9716', longitude: '77.5946', address: '', severity: 'MEDIUM', projectId: '' });
  const supabase = useMemo(() => {
    try {
      return createSupabaseBrowserClient();
    } catch {
      return null;
    }
  }, []);
  const canOperate = canPerformOfficerAction(profile?.role);

  const refresh = useCallback(async () => {
    if (!supabase) {
      setMessage('Configure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to connect CivicBrain360.');
      return;
    }
    const { data: authUser, error: authError } = await supabase.auth.getUser();
    if (authError) throw authError;
    if (authUser.user) {
      const { data: profileRow, error: profileError } = await supabase.from('profiles').select('*').eq('id', authUser.user.id).maybeSingle();
      if (profileError) throw profileError;
      setProfile(profileRow ?? null);
    } else {
      setProfile(null);
    }

    const [categoryResult, complaintResult, projectResult] = await Promise.all([
      supabase.from('categories').select('*').eq('is_active', true).order('name'),
      supabase.from('complaints').select('*').order('created_at', { ascending: false }).limit(25),
      supabase.from('projects').select('*').order('name').limit(50)
    ]);
    if (categoryResult.error) throw categoryResult.error;
    if (complaintResult.error) throw complaintResult.error;
    if (projectResult.error) throw projectResult.error;
    setCategories(categoryResult.data ?? []);
    setComplaints(complaintResult.data ?? []);
    setProjects(projectResult.data ?? []);
  }, [supabase]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh().catch((error) => setMessage(`Error: ${errorMessage(error)}`));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  async function submitComplaint(continueWithNew = false) {
    if (busy) return;
    setBusy(true);
    try {
      const latitude = Number(form.latitude);
    const longitude = Number(form.longitude);
    const dupes = continueWithNew ? [] : await findDuplicateComplaints({ categoryId: form.categoryId, latitude, longitude });

    if (dupes.length) {
      setMessage(`Found ${dupes.length} likely duplicate(s). Support the first existing report or continue with a new report.`);
      return;
    }

    const nearby = await nearbyProjects(latitude, longitude);
    const projectId = form.projectId || nearby[0]?.id;
    const id = await createComplaint({ title: form.title, categoryId: form.categoryId, description: form.description, latitude, longitude, address: form.address, severity: form.severity, projectId });
    if (evidenceFile) {
      await uploadEvidence({ file: evidenceFile, complaintId: id, evidenceType: evidenceFile.type.startsWith('image/') ? 'PHOTO' : 'DOCUMENT', metadata: { source: 'complaint_submission', original_name: evidenceFile.name, mime_type: evidenceFile.type } });
    }
    setEvidenceFile(null);
    setMessage(`Created complaint ${id}`);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function supportFirstDuplicate() {
    const latitude = Number(form.latitude);
    const longitude = Number(form.longitude);
    const dupes = await findDuplicateComplaints({ categoryId: form.categoryId, latitude, longitude });
    if (!dupes[0]) {
      setMessage('No duplicate report is currently available to support.');
      return;
    }
    await supportComplaint(dupes[0].id);
    setMessage(`Supported existing complaint ${dupes[0].id}`);
    await refresh();
  }

  return <main>
    <h1>CivicBrain 360</h1>
    <p className="badge">Canonical frontend: Next.js App Router + Supabase</p>
    {profile && <p>Signed in as {profile.full_name ?? (email || profile.id)} ({profile.role})</p>}
    {message && <p className={message.includes('Error') ? 'error' : 'success'}>{message}</p>}

    <div className="grid">
      <section className="card"><h2>Authentication</h2>
        <label>Email<input value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <label>Full name<input value={fullName} onChange={(event) => setFullName(event.target.value)} /></label>
        <p>New public registrations are created as Citizen accounts. Officer/Admin roles must be assigned by an authorized admin in Supabase.</p>
        <nav>
          <button onClick={() => register(email, password, fullName).then(refresh).then(() => setMessage('Registered; check email if confirmation is enabled.')).catch((error) => setMessage(`Error: ${errorMessage(error)}`))}>Register</button>
          <button onClick={() => login(email, password).then(refresh).then(() => setMessage('Logged in')).catch((error) => setMessage(`Error: ${errorMessage(error)}`))}>Login</button>
          <button className="secondary" onClick={() => logout().then(refresh).then(() => setMessage('Logged out')).catch((error) => setMessage(`Error: ${errorMessage(error)}`))}>Logout</button>
        </nav>
      </section>

      <section className="card"><h2>Report Issue</h2>
        <label>Title<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Short summary of the issue" /></label>
        <label>Category<select value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })}><option value="">Select</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
        <label>Description<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
        <label>Latitude<input value={form.latitude} onChange={(event) => setForm({ ...form, latitude: event.target.value })} /></label>
        <label>Longitude<input value={form.longitude} onChange={(event) => setForm({ ...form, longitude: event.target.value })} /></label>
        <label>Address<input value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} /></label>
        <label>Severity<select value={form.severity} onChange={(event) => setForm({ ...form, severity: event.target.value })}><option>LOW</option><option>MEDIUM</option><option>HIGH</option><option>CRITICAL</option></select></label>
        <label>Related project<select value={form.projectId} onChange={(event) => setForm({ ...form, projectId: event.target.value })}><option value="">Auto / none</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
        <label>Image / evidence<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf,video/mp4" onChange={(event) => setEvidenceFile(event.target.files?.[0] ?? null)} /></label>
        <nav>
          <button disabled={busy} onClick={() => submitComplaint(false).catch((error) => setMessage(`Error: ${errorMessage(error)}`))}>{busy ? 'Submitting…' : 'Check Duplicates / Submit'}</button>
          <button className="secondary" onClick={() => supportFirstDuplicate().catch((error) => setMessage(`Error: ${errorMessage(error)}`))}>Support Existing Report</button>
          <button disabled={busy} className="secondary" onClick={() => submitComplaint(true).catch((error) => setMessage(`Error: ${errorMessage(error)}`))}>Continue With New Report</button>
        </nav>
      </section>
    </div>

    <section className="card"><h2>Officer/Admin Operations</h2>
      {!canOperate && <p>Officer actions require Officer, Department Admin, or Super Admin role.</p>}
      {complaints.map((complaint) =>       <p key={complaint.id}><strong>{complaint.id}</strong> {complaint.status} — {complaint.title}: {complaint.description}<br />
        <button disabled={!canOperate} onClick={() => transitionComplaint(complaint.id, 'VERIFIED', 'Officer verified').then(refresh).catch((error) => setMessage(`Error: ${errorMessage(error)}`))}>Verify</button>{' '}
        <button disabled={!canOperate} onClick={() => transitionComplaint(complaint.id, 'IN_PROGRESS', 'Work started').then(refresh).catch((error) => setMessage(`Error: ${errorMessage(error)}`))}>Start</button>{' '}
        <button disabled={!canOperate} onClick={() => transitionComplaint(complaint.id, 'CITIZEN_VERIFICATION', 'Resolution submitted').then(refresh).catch((error) => setMessage(`Error: ${errorMessage(error)}`))}>Submit Resolution</button>{' '}
        <button disabled={profile?.id !== complaint.created_by || complaint.status !== 'CITIZEN_VERIFICATION'} className="secondary" onClick={() => citizenVerifyResolution(complaint.id, true).then(refresh).catch((error) => setMessage(`Error: ${errorMessage(error)}`))}>YES, ISSUE RESOLVED</button>{' '}
        <button disabled={profile?.id !== complaint.created_by || complaint.status !== 'CITIZEN_VERIFICATION'} className="secondary" onClick={() => citizenVerifyResolution(complaint.id, false, 'Issue still exists').then(refresh).catch((error) => setMessage(`Error: ${errorMessage(error)}`))}>NO, ISSUE STILL EXISTS</button>
      </p>)}
    </section>

    <section className="card"><h2>Project Explorer</h2>{projects.map((project) => <p key={project.id}><strong>{project.name}</strong> — {project.status} — {project.panchayat ?? 'No panchayat'} ({project.latitude ?? 'n/a'}, {project.longitude ?? 'n/a'})</p>)}</section>
  </main>;
}
