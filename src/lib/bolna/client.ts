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
      text || `Bolna API ${response.status}`,
    );
  }

  const body = (await response.json().catch(() => null)) as
    | { call_id?: string; id?: string; status?: string; message?: string }
    | null;

  const callId = body?.call_id ?? body?.id;
  if (!callId) {
    throw new BolnaApiError(
      502,
      body?.message ?? "Bolna response missing call_id",
    );
  }

  return { bolnaCallId: callId, status: body?.status ?? "initiated" };
}
