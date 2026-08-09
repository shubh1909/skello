// Types for the COD (Cash-on-Delivery) order-confirmation section. A separate
// feature from cart recovery — its own settings, queue, and dashboard.

import type { CallTranscriptStatus } from "@/types/call";

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

// One confirmation call. Field-for-field a subset of the shared
// `CallPaneCall` contract, so the COD sheet renders through the same call panel
// the lead sheet and cart recovery use rather than growing a fourth copy.
export interface CodCallRow {
  id: string;
  status: string;
  direction: string;
  to_phone: string | null;
  from_phone: string | null;
  error_message: string | null;
  bolna_call_id: string | null;
  created_at: string;
  started_at: string | null;
  answered_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  recording_url: string | null;
  transcript: string | null;
  transcript_url: string | null;
  transcript_status: CallTranscriptStatus;
  language: string | null;
  summary: string | null;
  actionable: string | null;
  name_extracted: string | null;
  interest: string | null;
  lead_intent_extracted: string | null;
  customer_status: string | null;
  call_outcome: string | null;
  requested_callback_at: string | null;
  connect_on_whatsapp: boolean | null;
  visit_scheduled_at: string | null;
  lead_data: Record<string, unknown> | null;
  custom_data: Record<string, unknown> | null;
  // The linked lead's current view, attached on read. Lets a COD call render
  // the shared pane's Lead panel — on this surface the call is all you can see,
  // so "who is this?" is otherwise unanswerable.
  lead_name?: string | null;
  lead_status?: string | null;
  lead_intent?: string | null;
}
