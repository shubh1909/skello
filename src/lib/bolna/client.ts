import "server-only";

const DEFAULT_BASE = "https://api.bolna.ai";

export class BolnaApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "BolnaApiError";
  }
}

export interface InitiateCallInput {
  apiKey: string;
  agentId: string;
  recipientPhone: string;
  fromPhone?: string | null;
  metadata?: Record<string, unknown>;
}

export interface InitiateCallResult {
  bolnaCallId: string;
  status: string;
}

function bolnaBaseUrl(): string {
  const url = process.env.BOLNA_API_BASE_URL?.trim();
  return url && url.length > 0 ? url.replace(/\/+$/, "") : DEFAULT_BASE;
}

export interface ExecutionTelephonyData {
  to_number?: string | null;
  from_number?: string | null;
}

export interface ExecutionPayload {
  id: string;
  status?: string;
  conversation_time?: number;
  transcript?: string | null;
  telephony_data?: ExecutionTelephonyData | null;
  extracted_data?: Record<string, unknown> | null;
  answered_by_voice_mail?: boolean | null;
  error_message?: string | null;
  created_at?: string;
  updated_at?: string;
}

export async function fetchBolnaExecution(input: {
  apiKey: string;
  executionId: string;
}): Promise<ExecutionPayload> {
  const response = await fetch(
    `${bolnaBaseUrl()}/executions/${encodeURIComponent(input.executionId)}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${input.apiKey}` },
      cache: "no-store",
    },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new BolnaApiError(
      response.status,
      text || `Voice provider returned ${response.status}`,
    );
  }

  const body = (await response.json().catch(() => null)) as
    | ExecutionPayload
    | null;
  if (!body || typeof body !== "object" || !body.id) {
    throw new BolnaApiError(502, "Voice provider returned malformed execution");
  }
  return body;
}

export interface PingResult {
  ok: boolean;
  status: number;
  // Raw response body, truncated to 1000 chars. We surface this verbatim so
  // operators can read Bolna's exact rejection wording.
  body: string;
}

// Lightweight probe: hits Bolna's "list executions for agent" endpoint with
// page_size=1. A 200 means both the API key and the agent_id are accepted by
// the same Bolna workspace. Non-200 responses (incl. "Unrecognized access
// token") are surfaced verbatim. Does NOT place a call.
export async function pingBolna(input: {
  apiKey: string;
  agentId: string;
}): Promise<PingResult> {
  const url = `${bolnaBaseUrl()}/v2/agent/${encodeURIComponent(
    input.agentId,
  )}/executions?page_size=1`;
  const response = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${input.apiKey}` },
    cache: "no-store",
  });
  const text = (await response.text().catch(() => "")) ?? "";
  return {
    ok: response.ok,
    status: response.status,
    body: text.slice(0, 1000),
  };
}

/**
 * Bolna's /call API rejects numbers without the leading `+`. Our internal
 * stores keep phones digit-only (campaign_contacts.phone enforces 5..15
 * digits) so we have to coerce on the way out. Anything that already starts
 * with `+` is passed through unchanged after we strip whitespace and other
 * formatting (spaces, dashes, parens).
 */
function toE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^0-9]/g, "");
  if (digits.length === 0) return null;
  return `+${digits}`;
}

export async function initiateBolnaCall(
  input: InitiateCallInput,
): Promise<InitiateCallResult> {
  const recipient = toE164(input.recipientPhone);
  if (!recipient) {
    throw new BolnaApiError(
      400,
      "Recipient phone is empty or contains no digits",
    );
  }
  const fromPhone = toE164(input.fromPhone);

  const requestBody = {
    agent_id: input.agentId,
    recipient_phone_number: recipient,
    ...(fromPhone ? { from_phone_number: fromPhone } : {}),
    ...(input.metadata ? { user_data: input.metadata } : {}),
  };

  // Lightweight trace — no raw phone numbers in prod logs. If you need to
  // debug a specific dial, expand this temporarily and remove before commit.
  console.log("[bolna] POST /call", {
    agent: input.agentId,
    recipientPrefixed: recipient.startsWith("+"),
    hasFromPhone: !!fromPhone,
  });

  const response = await fetch(`${bolnaBaseUrl()}/call`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify(requestBody),
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new BolnaApiError(
      response.status,
      text || `Voice provider returned ${response.status}`,
    );
  }

  // Bolna's POST /call success body looks like:
  //   { "message": "done", "status": "queued", "execution_id": "<uuid>" }
  // The identifier field is `execution_id`; older deployments returned
  // `call_id` / `id`, so we accept any of them. The literal `message: "done"`
  // is a status string, NOT an error — do not fall back to it.
  const body = (await response.json().catch(() => null)) as
    | {
        execution_id?: string;
        call_id?: string;
        id?: string;
        status?: string;
        message?: string;
      }
    | null;

  const callId = body?.execution_id ?? body?.call_id ?? body?.id;
  if (!callId) {
    throw new BolnaApiError(
      502,
      body?.message
        ? `Voice provider response missing execution_id (message: ${body.message})`
        : "Voice provider response missing execution_id",
    );
  }

  return { bolnaCallId: callId, status: body?.status ?? "queued" };
}
