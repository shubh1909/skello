-- =============================================================================
-- shopify_integrations — per-org Shopify connection (cart-recovery source).
--   One row per organisation. Each client runs their own Shopify app, so the
--   credentials are PER ORG:
--     * client_id    — the app's API key, used to build the OAuth authorize URL.
--     * api_secret   — the app's API secret key (shpss_…), used for BOTH the
--                      OAuth token exchange/callback HMAC AND verifying the HMAC
--                      on that store's webhooks.
--     * access_token — Admin API access token, minted by the OAuth callback and
--                      saved here. NULL until the store is authorized.
--   RLS is enabled with NO authenticated policies — all access is via the
--   service-role admin client, gated by app-layer requireAdmin(). Keeps the
--   secret + token off the wire to the browser (same posture as
--   bolna_integrations).
--   shop_domain is globally unique so a webhook's X-Shopify-Shop-Domain resolves
--   to exactly one organisation.
-- =============================================================================

create table if not exists public.shopify_integrations (
  organisation_id  uuid primary key references public.organisations (id) on delete cascade,
  shop_domain      text not null unique
                     check (shop_domain ~* '^[a-z0-9][a-z0-9-]*\.myshopify\.com$'),
  client_id        text not null check (char_length(client_id) between 1 and 200),
  api_secret       text not null check (char_length(api_secret) between 1 and 500),
  -- NULL until the OAuth callback authorizes the store.
  access_token     text check (access_token is null or char_length(access_token) between 1 and 500),
  api_version      text not null check (api_version ~ '^\d{4}-\d{2}$'),
  scope            text not null default '',
  enabled          boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Self-heal a table created by an earlier version of this migration. The column
-- set evolved (api_secret + client_id were added; access_token relaxed to
-- nullable for the OAuth flow). `create table if not exists` above is a no-op on
-- an existing table, so these idempotent ALTERs bring it up to date.
alter table public.shopify_integrations
  add column if not exists client_id text;
alter table public.shopify_integrations
  add column if not exists api_secret text;
alter table public.shopify_integrations
  add column if not exists api_version text;
alter table public.shopify_integrations
  alter column access_token drop not null;

drop trigger if exists shopify_integrations_set_updated_at on public.shopify_integrations;
create trigger shopify_integrations_set_updated_at
  before update on public.shopify_integrations
  for each row execute function public.set_updated_at();

alter table public.shopify_integrations enable row level security;
-- Intentionally NO policies for authenticated users. Service-role only.
