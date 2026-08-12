import "server-only";

import { headers } from "next/headers";

export interface AppOrigin {
  /** Scheme + host, no trailing slash. `""` only if the request carried no host. */
  url: string;
  /** True when `NEXT_PUBLIC_APP_URL` supplied it, rather than the request. */
  configured: boolean;
  /**
   * Can something on the public internet actually reach this?
   *
   * False for localhost and private ranges. A webhook address is handed to
   * Google or Meta and called from *their* servers, so `http://localhost:3000`
   * is not merely unhelpful — it is an address that looks entirely valid and
   * silently never receives anything. Surfaces are expected to say so.
   */
  reachable: boolean;
}

/** Hosts nothing outside this machine or network can resolve. */
const LOCAL_HOST = /^(localhost|127\.|0\.0\.0\.0|\[::1\]|.*\.local)$/i;
const PRIVATE_HOST = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

/**
 * The origin this deployment is reachable at, for URLs we hand to a third party.
 *
 * `NEXT_PUBLIC_APP_URL` wins — set it to `https://app.skelo.team` in production.
 * Without it we fall back to the request's own host, which is right for a
 * deployment behind a proxy but produces `http://localhost:3000` in development.
 *
 * Kept separate from `SHOPIFY_APP_URL`, which exists because Shopify's
 * registered redirect URI has to match byte for byte and may legitimately differ
 * from the app's own domain.
 */
export async function appOrigin(): Promise<AppOrigin> {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) {
    const url = configured.replace(/\/+$/, "");
    return { url, configured: true, reachable: isReachable(url) };
  }

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return { url: "", configured: false, reachable: false };

  // Assume https unless the proxy says otherwise — an address a provider will
  // refuse to call over http is worse than a wrong guess in local dev.
  const proto = h.get("x-forwarded-proto") ?? "https";
  const url = `${proto}://${host}`;
  return { url, configured: false, reachable: isReachable(url) };
}

function isReachable(url: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return false;
  }
  return !LOCAL_HOST.test(hostname) && !PRIVATE_HOST.test(hostname);
}
