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
  employment_type: "full_time" | "part_time" | "contingent";
  // Per-person solver limits (migration 06). 0 / null = no limit.
  min_rest_hours: number;
  max_consecutive_days: number | null;
  // Compensation scaffolding (modular — payroll computation added later).
  pay_type: string | null; // 'hourly' | 'salary' | null
  pay_rate: number | null;
  overtime_multiplier: number | null;
  created_at: string;
}

// A "position" (Sentry, PAC, Dishwasher, Server, …). required_staff is the
// concurrent headcount; start/end is the coverage window.
export interface ShiftType {
  id: string;
  org_id: string;
  name: string;
  start_time: string; // "HH:MM:SS"
  end_time: string;
  color: string;
  required_staff: number; // concurrent headcount
  block_minutes: number | null; // rotation length; null = one continuous shift
  min_rest_minutes: number; // rest between a person's blocks
  staffing_model: "standing" | "shift" | "continuous_coverage";
  created_at: string;
}

/** Keystone (migration 06): headcount demand per position per time band.
 *  day_of_week null = every day. Multiple bands allow e.g. 2 by day / 1 overnight. */
export interface CoverageRequirement {
  id: string;
  org_id: string;
  position_id: string;
  day_of_week: number | null; // 0 = Sunday
  start_time: string;
  end_time: string;
  min_headcount: number;
  max_headcount: number | null;
  created_at: string;
}

export interface PositionMember {
  id: string;
  org_id: string;
  position_id: string;
  employee_id: string;
}

export interface AvailabilityException {
  id: string;
  org_id: string;
  employee_id: string;
  work_date: string;
  reason: string | null;
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
  source: "pattern" | "manual" | "solver";
  /** Locked rows survive regeneration untouched. */
  locked: boolean;
  created_at: string;
}

export interface LeaveRequest {
  id: string;
  org_id: string;
  employee_id: string;
  category: string | null; // medical | overseas | compassionate | annual | other
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
  // Self-describing snapshot for the master-sheet log.
  work_date: string | null;
  start_time: string | null;
  end_time: string | null;
  position_label: string | null;
  resolved_at: string | null;
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
