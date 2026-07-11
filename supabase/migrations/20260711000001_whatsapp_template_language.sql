-- -----------------------------------------------------------------------------
-- WhatsApp: configurable template language.
--
-- Meta approves a template under a specific language code (e.g. "en", "en_US").
-- The send must pass the SAME code or the BSP rejects it with a generic 400. The
-- code was hard-wired to "en"; make it per-org config so a template approved
-- under any other code can be used. Default "en" preserves current behaviour.
-- -----------------------------------------------------------------------------
alter table public.whatsapp_integrations
  add column if not exists template_language text not null default 'en'
    check (char_length(template_language) between 2 and 15);
