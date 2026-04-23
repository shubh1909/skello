-- Leads: source-of-truth lives in Supabase. This file mirrors the live schema.
-- Tenant scoping is via `org_slug` (text) rather than a UUID FK.

create type if not exists public.intent_type as enum ('Hot', 'Warm', 'Cold');

create table if not exists public.leads (
  id                          uuid primary key default gen_random_uuid(),
  created_at                  timestamptz not null default now(),
  org_slug                    text,
  name                        text,
  product                     text,
  lead_intent                 public.intent_type,
  visit_date_time             timestamptz,
  customer_status             text,
  wants_to_connect_on_watsapp boolean,
  contacted_on_watsapp        boolean,
  constraint leads_org_slug_key unique (org_slug)
);

-- NOTE: `unique (org_slug)` means ONE lead per org_slug globally.
-- The webhook handler will return 409 on the second lead per org as a result.
-- If that wasn't intentional, drop it:
--   alter table public.leads drop constraint leads_org_slug_key;
