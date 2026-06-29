// Pure Shopify helpers — no secrets, safe to import anywhere (server or client).

// Only ever accept the canonical *.myshopify.com store host. Custom storefront
// domains (e.g. store.brand.com) are rejected: Shopify's APIs only respond on
// the myshopify host, and this also stops us being pointed at an arbitrary URL.
const SHOP_DOMAIN_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

export function isValidShopDomain(
  shop: string | null | undefined,
): shop is string {
  return !!shop && SHOP_DOMAIN_RE.test(shop);
}

// Trim + lowercase, returning the normalised domain or null if it isn't a valid
// myshopify host.
export function normalizeShopDomain(
  shop: string | null | undefined,
): string | null {
  if (!shop) return null;
  const trimmed = shop.trim().toLowerCase();
  return isValidShopDomain(trimmed) ? trimmed : null;
}
