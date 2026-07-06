import "server-only";

import { pooledMap } from "@/lib/campaigns/dispatch";
import {
  isWithinCallWindow,
  nextCallWindowOpen,
} from "@/lib/shopify/call-window";
import {
  buildRecoveryVariables,
  type RecoveryVariableSource,
} from "@/lib/shopify/recovery";
import { createAdminClient } from "@/lib/supabase/admin";
import { APP_TIMEZONE } from "@/lib/time";
import { getWhatsAppProvider } from "@/lib/whatsapp/registry";
import { WhatsAppSendError } from "@/lib/whatsapp/provider";

type Admin = ReturnType<typeof createAdminClient>;

// Shares the cron tick with the voice/campaign/callback drainers.
const BATCH_LIMIT = 100;
const CONCURRENCY = 25;
const STUCK_IN_FLIGHT_MS = 30 * 60 * 1000;

// The WhatsApp due row: the cart context (RecoveryVariableSource) + the track's
// own counters. Extends the shared source so buildRecoveryVariables accepts it.
interface DueWhatsApp extends RecoveryVariableSource {
  phone: string | null;
  whatsapp_attempt: number;
  whatsapp_max_attempts: number;
  retry_interval_seconds: number;
}

const DUE_COLUMNS =
  "id, organisation_id, lead_id, phone, whatsapp_attempt, whatsapp_max_attempts, retry_interval_seconds, customer_name, cart_total, currency, recovery_url, cart_items, offer_label, offer_code, offer_discount_value, offer_discount_kind";

interface WhatsAppIntegrationRow {
  organisation_id: string;
  provider: string;
  api_token: string;
  base_url: string | null;
  sender_id: string | null;
  template_name: string | null;
  enabled: boolean;
}

interface WindowRow {
  organisation_id: string;
  call_window_start: string | null;
  call_window_end: string | null;
  first_channel: string;
  escalation_gap_minutes: number;
  whatsapp_template_name: string | null;
}

async function reconcileStuck(admin: Admin): Promise<void> {
  const cutoff = new Date(Date.now() - STUCK_IN_FLIGHT_MS).toISOString();
  await admin
    .from("shopify_recovery_attempts")
    .update({ whatsapp_status: "failed", whatsapp_error: "Send timed out" })
    .eq("whatsapp_status", "in_flight")
    .lt("updated_at", cutoff);
}

export interface WhatsAppDispatchResult {
  processed: number;
  sent: number;
}

export async function dispatchDueWhatsAppRecoveries(): Promise<WhatsAppDispatchResult> {
  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  await reconcileStuck(admin);

  const { data, error } = await admin
    .from("shopify_recovery_attempts")
    .select(DUE_COLUMNS)
    .eq("whatsapp_status", "pending")
    .is("converted_at", null)
    .lte("whatsapp_next_at", nowIso)
    .order("whatsapp_next_at", { ascending: true })
    .limit(BATCH_LIMIT)
    .returns<DueWhatsApp[]>();

  if (error) {
    console.error("[whatsapp dispatch] fetch failed", error);
    throw error;
  }

  const queue = (data ?? []).filter(
    (r) => r.whatsapp_attempt < r.whatsapp_max_attempts && r.phone,
  );
  if (queue.length === 0) return { processed: 0, sent: 0 };

  const orgIds = Array.from(new Set(queue.map((r) => r.organisation_id)));
  const [{ data: integrations }, { data: settingsRows }] = await Promise.all([
    admin
      .from("whatsapp_integrations")
      .select("organisation_id, provider, api_token, base_url, sender_id, template_name, enabled")
      .in("organisation_id", orgIds)
      .returns<WhatsAppIntegrationRow[]>(),
    admin
      .from("shopify_recovery_settings")
      .select(
        "organisation_id, call_window_start, call_window_end, first_channel, escalation_gap_minutes, whatsapp_template_name",
      )
      .in("organisation_id", orgIds)
      .returns<WindowRow[]>(),
  ]);
  const integrationByOrg = new Map(
    (integrations ?? []).map((i) => [i.organisation_id, i] as const),
  );
  const settingsByOrg = new Map(
    (settingsRows ?? []).map((s) => [s.organisation_id, s] as const),
  );

  // Calling-window gate — reuse the voice window; defer out-of-window sends.
  const now = new Date();
  const sendable: DueWhatsApp[] = [];
  const deferrals: Array<{ id: string; next: string }> = [];
  for (const r of queue) {
    const s = settingsByOrg.get(r.organisation_id);
    if (
      !s ||
      isWithinCallWindow(now, s.call_window_start, s.call_window_end, APP_TIMEZONE)
    ) {
      sendable.push(r);
    } else {
      deferrals.push({
        id: r.id,
        next: nextCallWindowOpen(now, s.call_window_start, APP_TIMEZONE).toISOString(),
      });
    }
  }
  if (deferrals.length > 0) {
    await Promise.all(
      deferrals.map((d) =>
        admin
          .from("shopify_recovery_attempts")
          .update({ whatsapp_next_at: d.next })
          .eq("id", d.id)
          .eq("whatsapp_status", "pending"),
      ),
    );
  }
  if (sendable.length === 0) return { processed: 0, sent: 0 };

  const results = await pooledMap(sendable, CONCURRENCY, async (r) => {
    const integration = integrationByOrg.get(r.organisation_id);
    const settings = settingsByOrg.get(r.organisation_id);
    const templateName =
      settings?.whatsapp_template_name?.trim() ||
      integration?.template_name?.trim() ||
      null;

    if (!integration || !integration.enabled || !templateName) {
      await admin
        .from("shopify_recovery_attempts")
        .update({
          whatsapp_status: "skipped",
          whatsapp_skip_reason: !integration || !integration.enabled ? "no_whatsapp" : "no_template",
        })
        .eq("id", r.id)
        .eq("whatsapp_status", "pending");
      return { id: r.id, ok: false };
    }

    // CAS claim — only proceed if still pending.
    const { data: claim } = await admin
      .from("shopify_recovery_attempts")
      .update({ whatsapp_status: "in_flight" })
      .eq("id", r.id)
      .eq("whatsapp_status", "pending")
      .select("id")
      .maybeSingle<{ id: string }>();
    if (!claim) return { id: r.id, ok: false };

    const raw = buildRecoveryVariables(r);
    const variables: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      variables[k] = v == null ? "" : String(v);
    }

    try {
      const provider = getWhatsAppProvider(integration.provider);
      const result = await provider.sendTemplate({
        apiToken: integration.api_token,
        baseUrl: integration.base_url,
        senderId: integration.sender_id,
        templateName,
        toPhone: r.phone!,
        variables,
      });

      const sentAt = new Date().toISOString();
      const { data: msgRow } = await admin
        .from("shopify_recovery_messages")
        .insert({
          organisation_id: r.organisation_id,
          shopify_recovery_attempt_id: r.id,
          to_phone: r.phone,
          template_name: templateName,
          provider: integration.provider,
          provider_message_id: result.providerMessageId,
          status: "sent",
          sent_at: sentAt,
        })
        .select("id")
        .single<{ id: string }>();

      await admin
        .from("shopify_recovery_attempts")
        .update({
          whatsapp_status: "sent",
          whatsapp_attempt: r.whatsapp_attempt + 1,
          whatsapp_sent_at: sentAt,
          last_whatsapp_message_id: msgRow?.id ?? null,
          whatsapp_error: null,
        })
        .eq("id", r.id)
        .eq("whatsapp_status", "in_flight");

      // Voice handshake: when WhatsApp leads, re-anchor the follow-up call to
      // gap-after-this-send. CAS on status='pending' (+ an agent set) so it
      // never disturbs an in-flight/finished/agentless call.
      if (settings?.first_channel === "whatsapp") {
        const nextVoice = new Date(
          Date.now() + (settings.escalation_gap_minutes ?? 30) * 60_000,
        ).toISOString();
        await admin
          .from("shopify_recovery_attempts")
          .update({ next_attempt_at: nextVoice, scheduled_at: nextVoice })
          .eq("id", r.id)
          .eq("status", "pending")
          .not("agent_id", "is", null);
      }

      return { id: r.id, ok: true };
    } catch (err) {
      const reason =
        err instanceof WhatsAppSendError
          ? err.message
          : "Failed to reach the WhatsApp provider";

      await admin.from("shopify_recovery_messages").insert({
        organisation_id: r.organisation_id,
        shopify_recovery_attempt_id: r.id,
        to_phone: r.phone,
        template_name: templateName,
        provider: integration.provider,
        status: "failed",
        error_message: reason.slice(0, 500),
      });

      const newAttempt = r.whatsapp_attempt + 1;
      const exhausted = newAttempt >= r.whatsapp_max_attempts;
      await admin
        .from("shopify_recovery_attempts")
        .update({
          whatsapp_status: exhausted ? "failed" : "pending",
          whatsapp_attempt: newAttempt,
          whatsapp_error: reason.slice(0, 500),
          ...(exhausted
            ? {}
            : {
                whatsapp_next_at: new Date(
                  Date.now() + r.retry_interval_seconds * 1000,
                ).toISOString(),
              }),
        })
        .eq("id", r.id)
        .eq("whatsapp_status", "in_flight");
      return { id: r.id, ok: false };
    }
  });

  const sent = results.filter(
    (f) => f.status === "fulfilled" && f.value.ok,
  ).length;
  return { processed: sendable.length, sent };
}

// =============================================================================
// DELIVERY — advance a message + its attempt track from the provider webhook.
// =============================================================================

export type WhatsAppDeliveryStatus = "sent" | "delivered" | "read" | "failed";

const STATUS_RANK: Record<string, number> = {
  queued: 0,
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 4,
};

export async function applyWhatsAppDeliveryUpdate(input: {
  providerMessageId: string;
  status: WhatsAppDeliveryStatus;
  errorMessage?: string | null;
}): Promise<"updated" | "not_found" | "noop"> {
  const admin = createAdminClient();

  const { data: msg } = await admin
    .from("shopify_recovery_messages")
    .select("id, shopify_recovery_attempt_id, status")
    .eq("provider_message_id", input.providerMessageId)
    .maybeSingle<{
      id: string;
      shopify_recovery_attempt_id: string | null;
      status: string;
    }>();
  if (!msg) return "not_found";

  // Monotonic: ignore backward/duplicate transitions (out-of-order webhooks).
  const currentRank = STATUS_RANK[msg.status] ?? 0;
  const nextRank = STATUS_RANK[input.status] ?? 0;
  if (input.status !== "failed" && nextRank <= currentRank) return "noop";
  if (input.status === "failed" && msg.status === "failed") return "noop";

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status: input.status };
  if (input.status === "sent") patch.sent_at = now;
  else if (input.status === "delivered") patch.delivered_at = now;
  else if (input.status === "read") patch.read_at = now;
  else if (input.status === "failed") {
    patch.error_message = input.errorMessage ?? "Delivery failed";
  }

  await admin.from("shopify_recovery_messages").update(patch).eq("id", msg.id);

  // A failed delivery marks the attempt's WhatsApp track failed (informational —
  // delivered/read do NOT stop the voice escalation; only conversion does).
  if (input.status === "failed" && msg.shopify_recovery_attempt_id) {
    await admin
      .from("shopify_recovery_attempts")
      .update({
        whatsapp_status: "failed",
        whatsapp_error: input.errorMessage ?? "Delivery failed",
      })
      .eq("id", msg.shopify_recovery_attempt_id)
      .eq("whatsapp_status", "sent");
  }

  return "updated";
}
