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
  status: CampaignStatus;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  max_attempts: number;
  retry_interval_seconds: number;
  retry_on: CampaignRetryTrigger[];
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
  next_attempt_at: string | null;
  last_call_id: string | null;
  last_status: string | null;
  last_error: string | null;
  lead_id: string | null;
  created_at: string;
  updated_at: string;
}
