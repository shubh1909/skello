-- Add phone number to leads for WhatsApp / call workflows.
-- Stored as raw E.164-ish text; UI normalises before building wa.me URLs.

alter table public.leads add column if not exists phone text;

create index if not exists leads_org_slug_phone_idx
  on public.leads (org_slug, phone)
  where phone is not null;
