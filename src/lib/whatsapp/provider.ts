import "server-only";

// Provider-agnostic WhatsApp seam. The recovery pipeline (dispatcher, ledger,
// scheduling, UI) depends only on this contract; each BSP (KwikEngage today,
// others later) supplies an adapter. Adding a BSP = a new adapter + webhook
// route, no changes here.

export class WhatsAppSendError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "WhatsAppSendError";
  }
}

export interface WhatsAppSendInput {
  apiToken: string;
  baseUrl?: string | null;
  senderId?: string | null;
  templateName: string;
  toPhone: string;
  // Keys from buildRecoveryVariables; the adapter maps them into the template's
  // positional parameters.
  variables: Record<string, string>;
}

export interface WhatsAppSendResult {
  providerMessageId: string;
  status: string;
}

export interface WhatsAppProvider {
  readonly name: string;
  sendTemplate(input: WhatsAppSendInput): Promise<WhatsAppSendResult>;
}
