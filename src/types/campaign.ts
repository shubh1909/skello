import type { CallOutcome } from "./call";

export type CampaignStatus =
  | "draft"
  | "scheduled"
  | "in_progress"
  | "paused"
  | "stopped"
  | "completed"
  | "failed";

export type CampaignContactStatus =
  | "pending"
  | "in_flight"
  | "succeeded"
  | "failed"
  | "skipped";

export type CampaignRetryTrigger =
  | "no_answer"
  | "busy"
  | "failed"
  | "canceled";

export interface Campaign {
  id: string;
  organisation_id: string;
  created_by: string | null;
  name: string;
  file_name: string | null;
  agent_id: string | null;
  from_phone_number: string | null;
  // Caller-ID rotation pool. Empty → fall back to from_phone_number then the
  // org default. The dispatcher round-robins across these under a daily cap.
  from_phone_numbers: string[];
  status: CampaignStatus;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  max_attempts: number;
  // Max customer-requested callbacks ("call me later") honored per contact,
  // independent of max_attempts. 0 disables callback honoring.
  max_callbacks: number;
  retry_interval_seconds: number;
  retry_on: CampaignRetryTrigger[];
  // Caller-ID switching: rest a number whose connect rate over
  // switch_window_minutes falls below switch_connect_rate_floor (once it has
  // switch_min_samples dials in the window).
  switch_connect_rate_floor: number;
  switch_window_minutes: number;
  switch_min_samples: number;
  total_contacts: number;
  valid_contacts: number;
  succeeded_count: number;
  failed_count: number;
  in_flight_count: number;
  created_at: string;
  updated_at: string;
}

export interface CampaignContact {
  id: string;
  campaign_id: string;
  organisation_id: string;
  raw_phone: string;
  phone: string;
  name: string | null;
  metadata: Record<string, unknown>;
  status: CampaignContactStatus;
  attempt: number;
  // Honored callbacks so far — a budget separate from `attempt`.
  callback_count: number;
  // Consecutive all-numbers-resting deferrals (drives the backoff → least-bad
  // fallback in the dispatcher).
  health_defer_count: number;
  next_attempt_at: string | null;
  last_call_id: string | null;
  last_status: string | null;
  // Most recent semantic disposition (mirrors calls.call_outcome).
  last_outcome: CallOutcome | null;
  last_error: string | null;
  lead_id: string | null;
  created_at: string;
  updated_at: string;
}
