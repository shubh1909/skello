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
  // Meta template language code (e.g. "en", "en_US"). Must match the code the
  // template was approved under, else the BSP 400s. Null/empty → adapter default.
  language?: string | null;
  toPhone: string;
  // Keys from buildRecoveryVariables; the adapter maps them into the template's
  // positional parameters.
  variables: Record<string, string>;
  // Positional order of the template's {{1}}..{{n}} body variables (keys into
  // `variables`). Lets one org's template differ from another's. REQUIRED: an
  // implicit default silently sends one layout's parameters at another layout's
  // template, which the BSP rejects as an un-itemised 400. Resolve it from the
  // org's layout via recoveryTemplateVariableOrder().
  variableOrder: readonly string[];
}

export interface WhatsAppSendResult {
  providerMessageId: string;
  status: string;
}

export interface WhatsAppProvider {
  readonly name: string;
  sendTemplate(input: WhatsAppSendInput): Promise<WhatsAppSendResult>;
}
