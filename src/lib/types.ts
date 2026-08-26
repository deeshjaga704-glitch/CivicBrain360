export type UserRole = 'Citizen' | 'Officer' | 'Department Admin' | 'Super Admin';
export type ComplaintStatus = 'SUBMITTED' | 'VERIFIED' | 'ASSIGNED' | 'IN_PROGRESS' | 'RESOLVED' | 'CITIZEN_VERIFICATION' | 'CLOSED' | 'REJECTED' | 'ON_HOLD' | 'ESCALATED' | 'REOPENED';
export type EvidenceType = 'PHOTO' | 'DOCUMENT' | 'VIDEO';
export type AiProvider = 'openai' | 'demo';
export type AiPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

export type Profile = { id: string; full_name: string | null; role: UserRole; department_id: string | null; created_at?: string };
export type Category = { id: string; name: string; is_active: boolean; created_at?: string };
export type Department = { id: string; name: string; created_at?: string };
export type Project = { id: string; name: string; description: string | null; category_id: string | null; department_id: string | null; panchayat: string | null; status: string; latitude: number | null; longitude: number | null; created_at?: string };
export type Complaint = { id: string; title: string; category_id: string; description: string; latitude: number; longitude: number; address: string | null; severity: string; status: ComplaintStatus; created_by: string; assigned_to: string | null; department_id: string | null; project_id: string | null; created_at: string; updated_at?: string };
export type Notification = { id: string; user_id: string; title: string; body: string; read_at: string | null; created_at: string };
export type StatusHistory = { id: string; complaint_id: string; from_status: ComplaintStatus | null; to_status: ComplaintStatus; changed_by: string | null; reason: string | null; created_at: string };
export type Evidence = { id: string; complaint_id: string | null; project_id: string | null; uploader_id: string; file_path: string; file_url: string | null; evidence_type: string; latitude: number | null; longitude: number | null; metadata: Json; created_at: string };
export type ComplaintAiAnalysis = { id: string; complaint_id: string; provider: AiProvider; is_available: boolean; category_suggestion: string | null; severity_suggestion: string | null; department_suggestion: string | null; short_summary: string | null; priority_suggestion: AiPriority | null; confidence: number | null; raw_response: Json; accepted_category_id: string | null; accepted_severity: string | null; accepted_department_id: string | null; accepted_priority: AiPriority | null; accepted_summary: string | null; accepted_by: string | null; created_at: string; updated_at: string };
export type AiSuggestion = { provider: AiProvider; isAvailable: boolean; category: string; severity: string; department: string; shortSummary: string; priority: AiPriority; confidence: number; error?: string; rawResponse?: Json };
export type DuplicateMatch = Complaint & { similarityScore: number; matchedOn: string[] };
export type DuplicateRelationshipStatus = 'PENDING' | 'CONFIRMED' | 'REJECTED';
export type DuplicateLink = { id: string; primary_complaint_id: string; duplicate_complaint_id: string; relationship_status: DuplicateRelationshipStatus; created_by: string | null; reviewed_by: string | null; created_at: string };

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];
export type JsonObject = { [key: string]: Json | undefined };
type Table<Row, Insert, Update> = { Row: Row; Insert: Insert; Update: Update; Relationships: [] };

export type Database = {
  public: {
    Tables: {
      profiles: Table<Profile, Partial<Profile>, Partial<Profile>>;
      categories: Table<Category, Partial<Category>, Partial<Category>>;
      departments: Table<Department, Partial<Department>, Partial<Department>>;
      projects: Table<Project, Partial<Project>, Partial<Project>>;
      complaints: Table<Complaint, Partial<Complaint>, Partial<Complaint>>;
      complaint_supporters: Table<{ complaint_id: string; user_id: string; created_at: string }, { complaint_id: string; user_id: string }, never>;
      project_complaints: Table<{ project_id: string; complaint_id: string; relationship_status: 'PENDING' | 'CONFIRMED' | 'REJECTED'; reviewed_by: string | null; created_at: string }, { project_id: string; complaint_id: string; relationship_status?: 'PENDING' | 'CONFIRMED' | 'REJECTED'; reviewed_by?: string | null }, { relationship_status?: 'PENDING' | 'CONFIRMED' | 'REJECTED'; reviewed_by?: string | null }>;
      complaint_status_history: Table<{ id: string; complaint_id: string; from_status: ComplaintStatus | null; to_status: ComplaintStatus; changed_by: string | null; reason: string | null; created_at: string }, { complaint_id: string; from_status: ComplaintStatus | null; to_status: ComplaintStatus; changed_by: string | null; reason?: string | null }, never>;
      evidence: Table<Evidence, Partial<Evidence> & { uploader_id: string; file_path: string; evidence_type: string }, never>;
      notifications: Table<Notification, { user_id: string; title: string; body: string; read_at?: string | null }, { read_at?: string | null }>;
      audit_logs: Table<{ id: string; actor_id: string | null; action: string; entity_type: string; entity_id: string | null; metadata: Json; created_at: string }, { actor_id?: string | null; action: string; entity_type: string; entity_id?: string | null; metadata?: Json }, never>;
      complaint_ai_analysis: Table<ComplaintAiAnalysis, Partial<ComplaintAiAnalysis> & { complaint_id: string; provider: AiProvider }, Partial<ComplaintAiAnalysis>>;
      complaint_duplicate_links: Table<DuplicateLink, Partial<DuplicateLink> & { primary_complaint_id: string; duplicate_complaint_id: string }, Partial<DuplicateLink>>;
    };
    Views: Record<string, never>;
    Functions: {
      create_complaint: { Args: { p_title: string; p_category_id: string; p_description: string; p_latitude: number; p_longitude: number; p_address?: string | null; p_severity?: string; p_project_id?: string | null }; Returns: string };
      transition_complaint: { Args: { p_complaint_id: string; p_to_status: ComplaintStatus; p_reason?: string | null; p_assigned_to?: string | null; p_update_assignment?: boolean }; Returns: null };
      citizen_verify_complaint: { Args: { p_complaint_id: string; p_resolved: boolean; p_reason?: string | null }; Returns: null };
    };
  };
};
