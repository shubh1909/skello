-- =============================================================================
-- shopify_integrations — per-org Shopify connection (cart-recovery source).
--   Stores the offline Admin API access token minted by the OAuth callback.
--   RLS is enabled with NO authenticated policies — all access goes via the
--   service-role admin client, gated by app-layer ownership checks. Keeps the
--   access_token off the wire to the browser (same posture as
--   bolna_integrations).
--   shop_domain is globally unique so a webhook's X-Shopify-Shop-Domain
--   resolves to exactly one organisation.
-- =============================================================================

create table if not exists public.shopify_integrations (
  organisation_id  uuid primary key references public.organisations (id) on delete cascade,
  shop_domain      text not null unique
                     check (shop_domain ~* '^[a-z0-9][a-z0-9-]*\.myshopify\.com$'),
  access_token     text not null check (char_length(access_token) between 1 and 500),
  scope            text not null default '',
  enabled          boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

drop trigger if exists shopify_integrations_set_updated_at on public.shopify_integrations;
create trigger shopify_integrations_set_updated_at
  before update on public.shopify_integrations
  for each row execute function public.set_updated_at();

alter table public.shopify_integrations enable row level security;
-- Intentionally NO policies for authenticated users. Service-role only.
