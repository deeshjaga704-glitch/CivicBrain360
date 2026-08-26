'use client';

import dynamic from 'next/dynamic';
import { Component, useCallback, useEffect, useMemo, useState } from 'react';
import { createSupabaseBrowserClient } from '@/src/lib/supabase';
import { userFacingError } from '@/src/lib/errors';
import type { Category, Complaint, ComplaintStatus, Profile } from '@/src/lib/types';

const CivicMap = dynamic(() => import('@/src/components/CivicMap'), { ssr: false, loading: () => <div className="map-empty">Loading Civic Map…</div> });
const statuses: Array<ComplaintStatus | 'ALL'> = ['ALL', 'SUBMITTED', 'VERIFIED', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CITIZEN_VERIFICATION', 'CLOSED', 'REOPENED', 'ESCALATED', 'ON_HOLD', 'REJECTED'];
class MapErrorBoundary extends Component<{ children: React.ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() { return this.state.hasError ? <section className="card map-login"><h2>Map temporarily unavailable</h2><p>Complaint data remains available from the dashboard. Please try the map again later.</p><a className="button" href="/phase3">Back to dashboard</a></section> : this.props.children; }
}

export default function MapPage() {
  const [supabase] = useState(() => { try { return createSupabaseBrowserClient(); } catch { return null; } });
  const [profile, setProfile] = useState<Profile | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [categoryId, setCategoryId] = useState('ALL');
  const [severity, setSeverity] = useState('ALL');
  const [status, setStatus] = useState<ComplaintStatus | 'ALL'>('ALL');
  const [dateRange, setDateRange] = useState('ALL');
  const [area, setArea] = useState('');
  const [message, setMessage] = useState('');

  const refresh = useCallback(async () => {
    if (!supabase) { setMessage('Configure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to connect CivicBrain360.'); return; }
    const authResult = await supabase.auth.getUser();
    if (authResult.error) throw authResult.error;
    if (!authResult.data.user) { setMessage('Sign in to view authorized civic complaint markers.'); return; }
    const [profileResult, categoryResult, complaintResult] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', authResult.data.user.id).maybeSingle(),
      supabase.from('categories').select('*').eq('is_active', true).order('name'),
      supabase.from('complaints').select('*').order('created_at', { ascending: false }).limit(100)
    ]);
    if (profileResult.error) throw profileResult.error;
    if (categoryResult.error) throw categoryResult.error;
    if (complaintResult.error) throw complaintResult.error;
    setProfile(profileResult.data as Profile | null);
    setCategories((categoryResult.data ?? []) as Category[]);
    setComplaints((complaintResult.data ?? []) as Complaint[]);
  }, [supabase]);

  useEffect(() => { void refresh().catch((error) => setMessage(userFacingError(error, 'Unable to load the Civic Map.'))); }, [refresh]);

  const filteredComplaints = useMemo(() => {
    const cutoff = dateRange === 'ALL' ? 0 : Date.now() - Number(dateRange) * 86400000;
    const searchArea = area.trim().toLowerCase();
    return complaints.filter((complaint) => categoryId === 'ALL' || complaint.category_id === categoryId).filter((complaint) => severity === 'ALL' || complaint.severity === severity).filter((complaint) => status === 'ALL' || complaint.status === status).filter((complaint) => !cutoff || new Date(complaint.created_at).getTime() >= cutoff).filter((complaint) => !searchArea || (complaint.address || '').toLowerCase().includes(searchArea));
  }, [area, categoryId, complaints, dateRange, severity, status]);
  const validCount = filteredComplaints.filter((complaint) => Number.isFinite(complaint.latitude) && Number.isFinite(complaint.longitude) && Math.abs(complaint.latitude) <= 90 && Math.abs(complaint.longitude) <= 180).length;

  return <main className="map-page"><header className="hero"><div><span className="badge">PUBLIC INTELLIGENCE</span><h1>Civic <span>Map</span></h1><p>Explore authorized civic reports by location, urgency, and status.</p></div><nav><a className="button secondary" href="/phase3">Back to dashboard</a><a className="button" href="/phase3#report">Report an issue</a></nav></header>{message && <div className="alert error">{message}</div>}<section className="card map-toolbar"><div className="filter-grid"><label>Category<select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="ALL">All categories</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label>Severity<select value={severity} onChange={(event) => setSeverity(event.target.value)}><option>ALL</option>{['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((item) => <option key={item}>{item}</option>)}</select></label><label>Status<select value={status} onChange={(event) => setStatus(event.target.value as ComplaintStatus | 'ALL')}>{statuses.map((item) => <option key={item}>{item}</option>)}</select></label><label>Date range<select value={dateRange} onChange={(event) => setDateRange(event.target.value)}><option value="ALL">All time</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select></label><label>Area / address<input value={area} onChange={(event) => setArea(event.target.value)} placeholder="Search saved locations"/></label></div><div className="map-summary"><span><b>{validCount}</b> mappable complaints</span><span>Markers without valid coordinates are excluded.</span><span className="legend"><i className="legend-dot critical"/> Critical <i className="legend-dot high"/> High <i className="legend-dot open"/> Open <i className="legend-dot resolved"/> Resolved</span></div></section>{profile ? <MapErrorBoundary><CivicMap complaints={filteredComplaints} categories={categories} onOpenComplaint={(complaint) => { window.location.href = `/phase3?complaint=${encodeURIComponent(complaint.id)}`; }}/></MapErrorBoundary> : <section className="card map-login"><h2>Sign in to see your authorized map</h2><p>Citizen reports are protected by Supabase RLS. Sign in from the main dashboard to view your complaints, or access the officer map with the permissions assigned to your profile.</p><a className="button" href="/phase3#auth">Login / Register</a></section>}</main>;
}
