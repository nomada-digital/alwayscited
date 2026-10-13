-- DIY P9, Shell 2 (13 Oct 2026; docs/diy-platform-2026-10-12/10-spec.md sections
-- 5.8, 7.10 and 8.3 Q3): the Monday "This week" email, built dark.
--
-- Additive only, under the 19 Sep 2026 authorisation, and idempotent:
--
-- 1. email_this_week_enabled, seeded false, as every lifecycle flag is. Nothing
--    is sent until Danny approves the preview at /admin/emails and sets it to
--    true himself (client-facing email is his). `on conflict do nothing` keeps a
--    value already set.
--
-- 2. A partial unique index that makes the email's claim exact, as
--    20261008040000_trial_lifecycle_emails.sql does for the trial emails: the
--    sweep (src/lib/email/lifecycle-sweep.ts sweepThisWeek) writes one
--    dashboard_events row per client per Monday, event this_week_mail_<monday>,
--    before it sends, and two runs racing then fail one claim with 23505 instead
--    of mailing twice. No existing row has such an event, so every row already
--    satisfies it. A claim that reached nobody is renamed unsent_this_week_mail_...,
--    which falls outside the index (it does not start with this_week_mail_), so
--    the next run can try again. `_` is escaped in the pattern: unescaped, it
--    matches any one character.
--
-- Harmless landing before or after the deploy: until the row exists the flag
-- reads as off (lifecycle-flag.ts: a missing row is off); until the index exists
-- the read of this Monday's claims is the only guard, and the cron runs once a day.

insert into app_settings (key, value) values ('email_this_week_enabled', 'false'::jsonb)
on conflict (key) do nothing;

create unique index if not exists dashboard_events_this_week_mail_once
  on public.dashboard_events (client_domain_id, event)
  where event like 'this\_week\_mail\_%';
