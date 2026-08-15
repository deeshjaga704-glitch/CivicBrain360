import { createSupabaseBrowserClient } from './supabase';
import { distanceKm } from './geo';
import { canPerformOfficerAction } from './roles';
import type { Complaint, ComplaintStatus, Project } from './types';

const unresolved: ComplaintStatus[] = ['SUBMITTED', 'VERIFIED', 'ASSIGNED', 'IN_PROGRESS', 'CITIZEN_VERIFICATION', 'ON_HOLD', 'ESCALATED', 'REOPENED'];
const allowedEvidence = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'video/mp4'];
const maxEvidenceBytes = 10 * 1024 * 1024;

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

export async function findDuplicateComplaints(input: { categoryId: string; latitude: number; longitude: number; radiusKm?: number }) {
  const { data, error } = await createSupabaseBrowserClient()
    .from('complaints')
    .select('*')
    .eq('category_id', input.categoryId)
    .in('status', unresolved);
  if (error) throw error;
  return ((data ?? []) as Complaint[]).filter((row) => distanceKm(input, row) <= (input.radiusKm ?? 0.5));
}

export async function createComplaint(input: { categoryId: string; description: string; latitude: number; longitude: number; address?: string; severity: string; projectId?: string }) {
  if (!input.categoryId) throw new Error('Category is required.');
  if (!Number.isFinite(input.latitude) || !Number.isFinite(input.longitude)) throw new Error('Valid latitude and longitude are required.');
  if (!input.description.trim()) throw new Error('Description is required.');

  const supabase = createSupabaseBrowserClient();
  const user = await requireUser();
  const { data, error } = await supabase
    .from('complaints')
    .insert({ category_id: input.categoryId, description: input.description.trim(), latitude: input.latitude, longitude: input.longitude, address: input.address || null, severity: input.severity, project_id: input.projectId || null, created_by: user.id, status: 'SUBMITTED' })
    .select('id')
    .single();
  if (error) throw error;

  const complaintId = data.id;
  await supabase.from('complaint_status_history').insert({ complaint_id: complaintId, from_status: null, to_status: 'SUBMITTED', changed_by: user.id, reason: 'Complaint submitted' }).throwOnError();
  await supabase.from('notifications').insert({ user_id: user.id, title: 'Complaint submitted', body: `Complaint ${complaintId} was submitted.` }).throwOnError();
  await supabase.from('audit_logs').insert({ actor_id: user.id, action: 'complaint.submitted', entity_type: 'complaint', entity_id: complaintId, metadata: input }).throwOnError();
  if (input.projectId) await linkComplaintToProject(complaintId, input.projectId, 'PENDING');
  return complaintId;
}

export async function supportComplaint(complaintId: string) {
  const supabase = createSupabaseBrowserClient();
  const user = await requireUser();
  await supabase.from('complaint_supporters').upsert({ complaint_id: complaintId, user_id: user.id }, { ignoreDuplicates: true }).throwOnError();
  await supabase.from('audit_logs').insert({ actor_id: user.id, action: 'complaint.supported', entity_type: 'complaint', entity_id: complaintId }).throwOnError();
}

export async function nearbyProjects(latitude: number, longitude: number, radiusKm = 2) {
  const { data, error } = await createSupabaseBrowserClient()
    .from('projects')
    .select('*')
    .not('latitude', 'is', null)
    .not('longitude', 'is', null);
  if (error) throw error;
  return ((data ?? []) as Project[]).filter((project) => project.latitude !== null && project.longitude !== null && distanceKm({ latitude, longitude }, { latitude: project.latitude, longitude: project.longitude }) <= radiusKm);
}

export async function linkComplaintToProject(complaintId: string, projectId: string, status: 'PENDING' | 'CONFIRMED' | 'REJECTED' = 'PENDING') {
  const supabase = createSupabaseBrowserClient();
  const user = status === 'PENDING' ? await requireUser() : await requireOfficer();
  await supabase.from('project_complaints').upsert({ complaint_id: complaintId, project_id: projectId, relationship_status: status, reviewed_by: status === 'PENDING' ? null : user.id }).throwOnError();
  await supabase.from('audit_logs').insert({ actor_id: user.id, action: `project_complaint.${status.toLowerCase()}`, entity_type: 'complaint', entity_id: complaintId, metadata: { projectId } }).throwOnError();
}

export async function transitionComplaint(complaintId: string, toStatus: ComplaintStatus, reason?: string, assignedTo?: string) {
  const supabase = createSupabaseBrowserClient();
  const user = await requireOfficer();
  const { data: current, error } = await supabase.from('complaints').select('status, created_by').eq('id', complaintId).single();
  if (error) throw error;
  await supabase.from('complaints').update({ status: toStatus, assigned_to: assignedTo ?? null }).eq('id', complaintId).throwOnError();
  await supabase.from('complaint_status_history').insert({ complaint_id: complaintId, from_status: current.status, to_status: toStatus, changed_by: user.id, reason: reason ?? null }).throwOnError();
  await supabase.from('audit_logs').insert({ actor_id: user.id, action: 'complaint.status_changed', entity_type: 'complaint', entity_id: complaintId, metadata: { from: current.status, to: toStatus, reason } }).throwOnError();
  await supabase.from('notifications').insert({ user_id: current.created_by, title: 'Complaint status changed', body: `Complaint ${complaintId} is now ${toStatus}.` }).throwOnError();
}

export async function citizenVerifyResolution(complaintId: string, resolved: boolean, reason?: string) {
  const supabase = createSupabaseBrowserClient();
  const user = await requireUser();
  const { data: current, error } = await supabase.from('complaints').select('status, created_by').eq('id', complaintId).single();
  if (error) throw error;
  if (current.created_by !== user.id) throw new Error('Only the complaint creator can verify the resolution.');
  const nextStatus: ComplaintStatus = resolved ? 'CLOSED' : 'REOPENED';
  const transitionReason = resolved ? 'Citizen confirmed resolution' : reason || 'Citizen rejected resolution';
  await supabase.from('complaints').update({ status: nextStatus }).eq('id', complaintId).throwOnError();
  await supabase.from('complaint_status_history').insert({ complaint_id: complaintId, from_status: current.status, to_status: nextStatus, changed_by: user.id, reason: transitionReason }).throwOnError();
  await supabase.from('audit_logs').insert({ actor_id: user.id, action: resolved ? 'complaint.citizen_closed' : 'complaint.reopened', entity_type: 'complaint', entity_id: complaintId, metadata: { reason: transitionReason } }).throwOnError();
  await supabase.from('notifications').insert({ user_id: user.id, title: resolved ? 'Complaint closed' : 'Complaint reopened', body: resolved ? `Complaint ${complaintId} was closed.` : `Complaint ${complaintId} was reopened for review.` }).throwOnError();
}

export async function uploadEvidence(input: { file: File; complaintId?: string; projectId?: string; evidenceType: string; latitude?: number; longitude?: number; metadata?: Record<string, unknown> }) {
  if (!allowedEvidence.includes(input.file.type)) throw new Error('Unsupported evidence file type.');
  if (input.file.size > maxEvidenceBytes) throw new Error('Evidence file exceeds 10 MB.');
  const supabase = createSupabaseBrowserClient();
  const user = await requireUser();
  const owner = input.complaintId ?? input.projectId;
  if (!owner) throw new Error('Evidence must be attached to a complaint or project.');
  const bucket = process.env.NEXT_PUBLIC_EVIDENCE_BUCKET || 'evidence';
  const safeName = input.file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${owner}/${crypto.randomUUID()}-${safeName}`;
  const { error: uploadError } = await supabase.storage.from(bucket).upload(path, input.file, { contentType: input.file.type, upsert: false });
  if (uploadError) throw uploadError;
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  await supabase.from('evidence').insert({ complaint_id: input.complaintId ?? null, project_id: input.projectId ?? null, uploader_id: user.id, file_path: path, file_url: data.publicUrl, evidence_type: input.evidenceType, latitude: input.latitude ?? null, longitude: input.longitude ?? null, metadata: input.metadata ?? {} }).throwOnError();
  await supabase.from('audit_logs').insert({ actor_id: user.id, action: 'evidence.uploaded', entity_type: input.complaintId ? 'complaint' : 'project', entity_id: owner, metadata: { path, evidenceType: input.evidenceType } }).throwOnError();
  return path;
}
