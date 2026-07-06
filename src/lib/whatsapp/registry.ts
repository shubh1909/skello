import "server-only";

import { kwikengageProvider } from "@/lib/kwikengage/client";
import type { WhatsAppProvider } from "@/lib/whatsapp/provider";

// Maps a per-org `provider` string to its adapter. Only KwikEngage is wired
// today; add a BSP here (+ its webhook route) without touching the dispatcher.
const PROVIDERS: Record<string, WhatsAppProvider> = {
  kwikengage: kwikengageProvider,
};

export function getWhatsAppProvider(
  name: string | null | undefined,
): WhatsAppProvider {
  const key = (name ?? "kwikengage").trim().toLowerCase();
  const provider = PROVIDERS[key];
  if (!provider) {
    throw new Error(`Unsupported WhatsApp provider: ${name ?? "(none)"}`);
  }
  return provider;
}
