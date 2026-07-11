// Per-org WhatsApp BSP connection (mirrors public.whatsapp_integrations),
// redacted for the client. `provider` is which BSP powers it (only
// 'kwikengage' is wired today); the product UI never names the vendor.
export interface WhatsAppIntegration {
  organisation_id: string;
  provider: string;
  base_url: string | null;
  sender_id: string | null;
  template_name: string | null;
  // Meta template language code (e.g. "en", "en_US"). Defaults to "en".
  template_language: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  // Display-only — the full api_token never leaves the server.
  api_token_last4: string;
}
