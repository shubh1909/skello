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

export async function initiateBolnaCall(
  input: InitiateCallInput,
): Promise<InitiateCallResult> {
  const response = await fetch(`${bolnaBaseUrl()}/call`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify({
      agent_id: input.agentId,
      recipient_phone_number: input.recipientPhone,
      ...(input.fromPhone ? { from_phone_number: input.fromPhone } : {}),
      ...(input.metadata ? { user_data: input.metadata } : {}),
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new BolnaApiError(
      response.status,
      text || `Voice provider returned ${response.status}`,
    );
  }

  const body = (await response.json().catch(() => null)) as
    | { call_id?: string; id?: string; status?: string; message?: string }
    | null;

  const callId = body?.call_id ?? body?.id;
  if (!callId) {
    throw new BolnaApiError(
      502,
      body?.message ?? "Voice provider response missing call_id",
    );
  }

  return { bolnaCallId: callId, status: body?.status ?? "initiated" };
}
