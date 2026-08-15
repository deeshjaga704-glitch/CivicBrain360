export type UserRole = 'Citizen' | 'Officer' | 'Department Admin' | 'Super Admin';
export type ComplaintStatus = 'SUBMITTED' | 'VERIFIED' | 'ASSIGNED' | 'IN_PROGRESS' | 'RESOLVED' | 'CITIZEN_VERIFICATION' | 'CLOSED' | 'REJECTED' | 'ON_HOLD' | 'ESCALATED' | 'REOPENED';

export interface Profile { id: string; full_name: string | null; role: UserRole; department_id: string | null; created_at?: string; }
export interface Category { id: string; name: string; is_active: boolean; created_at?: string; }
export interface Department { id: string; name: string; created_at?: string; }
export interface Project { id: string; name: string; description: string | null; category_id: string | null; department_id: string | null; panchayat: string | null; status: string; latitude: number | null; longitude: number | null; created_at?: string; }
export interface Complaint { id: string; category_id: string; description: string; latitude: number; longitude: number; address: string | null; severity: string; status: ComplaintStatus; created_by: string; assigned_to: string | null; department_id: string | null; project_id: string | null; created_at: string; updated_at?: string; }
export interface Notification { id: string; user_id: string; title: string; body: string; read_at: string | null; created_at: string; }

type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];
type Row<T> = T;
type Insert<T> = Partial<T>;
type Update<T> = Partial<T>;

export interface Database {
  public: {
    Tables: {
      profiles: { Row: Row<Profile>; Insert: Insert<Profile>; Update: Update<Profile> };
      categories: { Row: Row<Category>; Insert: Insert<Category>; Update: Update<Category> };
      departments: { Row: Row<Department>; Insert: Insert<Department>; Update: Update<Department> };
      projects: { Row: Row<Project>; Insert: Insert<Project>; Update: Update<Project> };
      complaints: { Row: Row<Complaint>; Insert: Insert<Complaint>; Update: Update<Complaint> };
      complaint_supporters: { Row: { complaint_id: string; user_id: string; created_at: string }; Insert: { complaint_id: string; user_id: string }; Update: never };
      project_complaints: { Row: { project_id: string; complaint_id: string; relationship_status: 'PENDING' | 'CONFIRMED' | 'REJECTED'; reviewed_by: string | null; created_at: string }; Insert: { project_id: string; complaint_id: string; relationship_status?: 'PENDING' | 'CONFIRMED' | 'REJECTED'; reviewed_by?: string | null }; Update: { relationship_status?: 'PENDING' | 'CONFIRMED' | 'REJECTED'; reviewed_by?: string | null } };
      complaint_status_history: { Row: { id: string; complaint_id: string; from_status: ComplaintStatus | null; to_status: ComplaintStatus; changed_by: string | null; reason: string | null; created_at: string }; Insert: { complaint_id: string; from_status: ComplaintStatus | null; to_status: ComplaintStatus; changed_by: string | null; reason?: string | null }; Update: never };
      evidence: { Row: { id: string; complaint_id: string | null; project_id: string | null; uploader_id: string; file_path: string; file_url: string | null; evidence_type: string; latitude: number | null; longitude: number | null; metadata: Json; created_at: string }; Insert: { complaint_id?: string | null; project_id?: string | null; uploader_id: string; file_path: string; file_url?: string | null; evidence_type: string; latitude?: number | null; longitude?: number | null; metadata?: Json }; Update: never };
      notifications: { Row: Notification; Insert: { user_id: string; title: string; body: string; read_at?: string | null }; Update: { read_at?: string | null } };
      audit_logs: { Row: { id: string; actor_id: string | null; action: string; entity_type: string; entity_id: string | null; metadata: Json; created_at: string }; Insert: { actor_id?: string | null; action: string; entity_type: string; entity_id?: string | null; metadata?: Json }; Update: never };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: { app_role: UserRole; complaint_status: ComplaintStatus };
  };
}
