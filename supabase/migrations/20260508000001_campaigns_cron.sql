-- pg_cron + pg_net wiring for campaign processing.
--
-- Apply this AFTER enabling the `pg_cron` and `pg_net` extensions in your
-- Supabase project (Database → Extensions). Vault ships enabled by default.
--
-- Before the cron job will fire, store two secrets in Vault:
--
--   select vault.create_secret(
--     'https://<your-deploy>/api/cron/campaigns/tick',  -- the URL
--     'campaigns_cron_target_url'                        -- the name
--   );
--   select vault.create_secret(
--     '<some long random string>',                       -- the secret
--     'campaigns_cron_secret'                            -- the name
--   );
--
-- The secret value must match `CRON_SECRET` in your Next.js env.
-- Until both secrets exist, campaigns_cron_tick() is a no-op.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.campaigns_cron_tick()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url   text;
  v_token text;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets
    where name = 'campaigns_cron_target_url'
    limit 1;
  select decrypted_secret into v_token
    from vault.decrypted_secrets
    where name = 'campaigns_cron_secret'
    limit 1;
  if v_url is null or v_token is null then return; end if;

  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', v_token
    ),
    body    := '{}'::jsonb
  );
end $$;

-- Idempotent: drop any pre-existing schedule with this name before adding it.
do $$
begin
  perform cron.unschedule('campaign-tick');
exception when others then null;
end $$;

select cron.schedule(
  'campaign-tick',
  '* * * * *',
  $$select public.campaigns_cron_tick();$$
);
