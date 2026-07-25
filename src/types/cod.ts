// Types for the COD (Cash-on-Delivery) order-confirmation section. A separate
// feature from cart recovery — its own settings, queue, and dashboard.

export type CodConfirmationStatus =
  | "pending"
  | "in_flight"
  | "confirmed_call"
  | "failed"
  | "canceled"
  | "skipped";

export interface CodSettings {
  organisation_id: string;
  enabled: boolean;
  wait_minutes: number;
  max_attempts: number;
  retry_interval_seconds: number;
  agent_id: string | null;
  call_window_start: string | null;
  call_window_end: string | null;
  cod_gateway_names: string[];
  created_at: string;
  updated_at: string;
}

// Headline dashboard metrics for the section.
export interface CodMetrics {
  // Orders queued for confirmation (every actionable row we recorded).
  orders: number;
  // Confirmation calls placed (rows with at least one dial).
  calls_made: number;
  // Reached + confirmed the order (confirmed = true).
  confirmed: number;
  // Reached but declined / unsure (confirmed = false).
  declined: number;
  // Never connected within the attempt cap.
  not_reached: number;
  currency: string | null;
}

// Read-only voice-agent summary for the section card. Product copy never names
// the underlying provider — always "voice agent".
export interface CodVoiceAgent {
  name: string | null;
  callerNumber: string | null;
  configured: boolean;
}

export interface CodOverview {
  connected: boolean;
  settings: CodSettings | null;
  metrics: CodMetrics;
  voiceAgent: CodVoiceAgent;
}

// One row in the confirmations activity table.
export interface CodConfirmationRow {
  id: string;
  order_name: string | null;
  order_total: number | null;
  currency: string | null;
  phone: string | null;
  customer_name: string | null;
  gateway: string | null;
  status: CodConfirmationStatus;
  confirmed: boolean | null;
  skip_reason: string | null;
  attempt: number;
  max_attempts: number;
  last_status: string | null;
  connected_at: string | null;
  next_attempt_at: string | null;
  created_at: string;
}

export interface CodPage<T> {
  rows: T[];
  total: number;
}
