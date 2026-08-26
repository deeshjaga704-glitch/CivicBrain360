import { distanceKm } from './geo';
import { canPerformOfficerAction } from './roles';
import { createSupabaseBrowserClient } from './supabase';
import type { AiSuggestion, Complaint, ComplaintStatus, DuplicateMatch, DuplicateRelationshipStatus, Json, Project } from './types';

const unresolved: ComplaintStatus[] = ['SUBMITTED', 'VERIFIED', 'ASSIGNED', 'IN_PROGRESS', 'CITIZEN_VERIFICATION', 'ON_HOLD', 'ESCALATED', 'REOPENED'];
const allowedEvidence = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'video/mp4'];
const maxEvidenceBytes = 10 * 1024 * 1024;
const duplicateLookbackDays = 180;

async function requireUser() {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error('Login is required.');
  return data.user;
}

async function requireOfficer() {
  const supabase = createSupabaseBrowserClient();
  const user = await requireUser();
  const { data: profile, error } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  if (error) throw error;
  if (!canPerformOfficerAction(profile.role)) throw new Error('Officer, Department Admin, or Super Admin role is required.');
  return user;
}

const tokens = (value: string) => new Set(value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((token) => token.length > 2));
const jaccard = (left: Set<string>, right: Set<string>) => {
  const union = new Set([...left, ...right]);
  if (!union.size) return 0;
  let overlap = 0;
  for (const token of left) if (right.has(token)) overlap += 1;
  return overlap / union.size;
};

export async function findDuplicateComplaints(input: { categoryId: string; title?: string; description?: string; latitude: number; longitude: number; radiusKm?: number }): Promise<DuplicateMatch[]> {
  if (!input.categoryId || !Number.isFinite(input.latitude) || !Number.isFinite(input.longitude)) return [];
  const radiusKm = input.radiusKm ?? 0.5;
  const since = new Date(Date.now() - duplicateLookbackDays * 86400000).toISOString();
  const { data, error } = await createSupabaseBrowserClient().from('complaints').select('*').eq('category_id', input.categoryId).in('status', unresolved).gte('created_at', since).order('created_at', { ascending: false }).limit(100);
  if (error) throw error;
  const incomingText = tokens(`${input.title ?? ''} ${input.description ?? ''}`);
  return ((data ?? []) as Complaint[]).map((row) => {
    const km = distanceKm(input, row);
    const textScore = jaccard(incomingText, tokens(`${row.title} ${row.description}`));
    const score = (km <= radiusKm ? 0.45 * Math.max(0, 1 - km / radiusKm) : 0) + (textScore * 0.35) + (row.category_id === input.categoryId ? 0.2 : 0);
    const matchedOn = ['category'];
    if (km <= radiusKm) matchedOn.push('location');
    if (textScore >= 0.2) matchedOn.push('title/description');
    return { ...row, similarityScore: Math.round(score * 100), matchedOn };
  }).filter((row) => row.similarityScore >= 35).sort((left, right) => right.similarityScore - left.similarityScore);
}

export async function saveAiAnalysis(complaintId: string, suggestion: AiSuggestion, accepted: { categoryId?: string; severity?: string; departmentId?: string; priority?: AiSuggestion['priority']; summary?: string } = {}) {
  const user = await requireUser();
  const supabase = createSupabaseBrowserClient();
  await supabase.from('complaint_ai_analysis').insert({ complaint_id: complaintId, provider: suggestion.provider, is_available: suggestion.isAvailable, category_suggestion: suggestion.category, severity_suggestion: suggestion.severity, department_suggestion: suggestion.department, short_summary: suggestion.shortSummary, priority_suggestion: suggestion.priority, confidence: suggestion.confidence, raw_response: suggestion.rawResponse ?? {}, accepted_category_id: accepted.categoryId ?? null, accepted_severity: accepted.severity ?? null, accepted_department_id: accepted.departmentId ?? null, accepted_priority: accepted.priority ?? null, accepted_summary: accepted.summary ?? null, accepted_by: Object.keys(accepted).length ? user.id : null }).throwOnError();
}

export async function createComplaint(input: { title: string; categoryId: string; description: string; latitude: number; longitude: number; address?: string; severity: string; projectId?: string; aiAnalysis?: AiSuggestion; acceptedAi?: { categoryId?: string; severity?: string; departmentId?: string; priority?: AiSuggestion['priority']; summary?: string } }) {
  if (!input.title.trim()) throw new Error('Complaint title is required.');
  if (input.title.trim().length > 160) throw new Error('Complaint title must be 160 characters or fewer.');
  if (!input.categoryId) throw new Error('Category is required.');
  if (!Number.isFinite(input.latitude) || !Number.isFinite(input.longitude) || Math.abs(input.latitude) > 90 || Math.abs(input.longitude) > 180) throw new Error('Valid latitude and longitude are required.');
  if (!input.description.trim()) throw new Error('Description is required.');
  const supabase = createSupabaseBrowserClient();
  const { data: complaintId, error } = await supabase.rpc('create_complaint', { p_title: input.title.trim(), p_category_id: input.categoryId, p_description: input.description.trim(), p_latitude: input.latitude, p_longitude: input.longitude, p_address: input.address || null, p_severity: input.severity, p_project_id: input.projectId || null });
  if (error) throw error;
  if (!complaintId) throw new Error('The complaint could not be created.');
  if (input.aiAnalysis) {
    try { await saveAiAnalysis(complaintId, input.aiAnalysis, input.acceptedAi); } catch { /* AI persistence must never block the civic report. */ }
  }
  return complaintId;
}

export async function supportComplaint(complaintId: string) {
  const supabase = createSupabaseBrowserClient();
  const user = await requireUser();
  await supabase.from('complaint_supporters').upsert({ complaint_id: complaintId, user_id: user.id }, { ignoreDuplicates: true }).throwOnError();
}

export async function nearbyProjects(latitude: number, longitude: number, radiusKm = 2) {
  const { data, error } = await createSupabaseBrowserClient().from('projects').select('*').not('latitude', 'is', null).not('longitude', 'is', null).limit(100);
  if (error) throw error;
  return ((data ?? []) as Project[]).filter((project) => project.latitude !== null && project.longitude !== null && distanceKm({ latitude, longitude }, { latitude: project.latitude, longitude: project.longitude }) <= radiusKm);
}

export async function linkComplaintToProject(complaintId: string, projectId: string, status: 'PENDING' | 'CONFIRMED' | 'REJECTED' = 'PENDING') {
  const supabase = createSupabaseBrowserClient();
  const user = status === 'PENDING' ? await requireUser() : await requireOfficer();
  await supabase.from('project_complaints').upsert({ complaint_id: complaintId, project_id: projectId, relationship_status: status, reviewed_by: status === 'PENDING' ? null : user.id }).throwOnError();
}

export async function reviewDuplicateLink(primaryComplaintId: string, duplicateComplaintId: string, status: DuplicateRelationshipStatus) {
  const user = await requireOfficer();
  const supabase = createSupabaseBrowserClient();
  await supabase.from('complaint_duplicate_links').upsert({ primary_complaint_id: primaryComplaintId, duplicate_complaint_id: duplicateComplaintId, relationship_status: status, created_by: user.id, reviewed_by: user.id }).throwOnError();
}

export async function transitionComplaint(complaintId: string, toStatus: ComplaintStatus, reason?: string, assignedTo?: string) {
  await requireOfficer();
  const normalizedAssignee = assignedTo?.trim() || null;
  await createSupabaseBrowserClient().rpc('transition_complaint', { p_complaint_id: complaintId, p_to_status: toStatus, p_reason: reason ?? null, p_assigned_to: normalizedAssignee, p_update_assignment: assignedTo !== undefined }).throwOnError();
}

export async function citizenVerifyResolution(complaintId: string, resolved: boolean, reason?: string) {
  await requireUser();
  await createSupabaseBrowserClient().rpc('citizen_verify_complaint', { p_complaint_id: complaintId, p_resolved: resolved, p_reason: reason ?? null }).throwOnError();
}

export async function uploadEvidence(input: { file: File; complaintId?: string; projectId?: string; evidenceType: string; latitude?: number; longitude?: number; metadata?: Record<string, Json | undefined> }) {
  if (!allowedEvidence.includes(input.file.type)) throw new Error('Unsupported evidence file type.');
  if (input.file.size > maxEvidenceBytes) throw new Error('Evidence file exceeds 10 MB.');
  const supabase = createSupabaseBrowserClient();
  const user = await requireUser();
  const owner = input.complaintId ?? input.projectId;
  if (!owner) throw new Error('Evidence must be attached to a complaint or project.');
  if (input.complaintId) {
    const { data: complaint, error: complaintError } = await supabase.from('complaints').select('created_by').eq('id', input.complaintId).single();
    if (complaintError) throw complaintError;
    if (complaint.created_by !== user.id) await requireOfficer();
  } else await requireOfficer();
  const bucket = process.env.NEXT_PUBLIC_EVIDENCE_BUCKET || 'evidence';
  const safeName = input.file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'evidence';
  const objectOwner = input.projectId ? `project/${input.projectId}` : owner;
  const path = `${objectOwner}/${crypto.randomUUID()}-${safeName}`;
  const storage = supabase.storage.from(bucket);
  const { error: uploadError } = await storage.upload(path, input.file, { contentType: input.file.type, upsert: false });
  if (uploadError) throw uploadError;
  try {
    await supabase.from('evidence').insert({ complaint_id: input.complaintId ?? null, project_id: input.projectId ?? null, uploader_id: user.id, file_path: path, file_url: null, evidence_type: input.evidenceType, latitude: input.latitude ?? null, longitude: input.longitude ?? null, metadata: input.metadata ?? {} }).throwOnError();
  } catch (error) {
    await storage.remove([path]);
    throw error;
  }
  return path;
}
