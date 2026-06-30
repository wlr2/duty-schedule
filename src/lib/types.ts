// Shared data types mirroring the database schema.

export type Role = "manager" | "employee";

export interface Organization {
  id: string;
  name: string;
  join_code: string;
  created_by: string | null;
  created_at: string;
}

export interface Profile {
  id: string;
  org_id: string | null;
  full_name: string | null;
  role: Role;
  target_hours_per_week: number;
  created_at: string;
}

export interface ShiftType {
  id: string;
  org_id: string;
  name: string;
  start_time: string; // "HH:MM:SS"
  end_time: string;
  color: string;
  required_staff: number;
  created_at: string;
}

export type PreferenceLevel = "preferred" | "available" | "unavailable";

export interface EmployeePreference {
  id: string;
  org_id: string;
  employee_id: string;
  day_of_week: number; // 0 = Sunday
  preference: PreferenceLevel;
  updated_at: string;
}

export interface SchedulePeriod {
  id: string;
  org_id: string;
  start_date: string;
  end_date: string;
  status: "draft" | "published";
  created_at: string;
}

export interface Assignment {
  id: string;
  org_id: string;
  period_id: string | null;
  shift_type_id: string | null;
  employee_id: string | null;
  work_date: string;
  /** Optional per-assignment block time (overrides the shift type's fixed time,
   *  used for rotating-post rosters like guard duty). */
  start_time: string | null;
  end_time: string | null;
  status: "scheduled" | "open" | "swapped";
  created_at: string;
}

export interface LeaveRequest {
  id: string;
  org_id: string;
  employee_id: string;
  type: "leave" | "mc";
  start_date: string;
  end_date: string;
  reason: string | null;
  status: "pending" | "approved" | "rejected";
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface CoverageRequest {
  id: string;
  org_id: string;
  requester_id: string;
  assignment_id: string | null;
  note: string | null;
  status: "open" | "claimed" | "closed";
  claimed_by: string | null;
  created_at: string;
}

export interface AppNotification {
  id: string;
  user_id: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  created_at: string;
}
