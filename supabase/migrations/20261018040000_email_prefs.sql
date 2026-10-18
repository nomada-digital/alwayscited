-- Customer emails, brief item 2e (18 Oct 2026). Additive only and idempotent. Written, NOT applied: Danny applies it
-- (or says to) after reviewing the rebuilt emails; until then every reader below tolerates it being absent.
--
-- 1. dashboard_members.this_week_opt_out: a member who switched the Monday "This week" email (#7) off, from its
--    one-click unsubscribe (src/app/api/dash/unsubscribe/route.ts) or Email settings. week-recipients.ts leaves them
--    out. Default false, so every existing row keeps getting what it got; before this column exists the opt-out
--    read fails, is logged, and nobody is left out.
--
-- 2. email_payment_failed_enabled, the new #11 payment_failed email's flag, seeded false as every lifecycle flag is.
--    Nothing is sent until Danny approves the preview at /admin/emails and sets it to true himself. `on conflict do
--    nothing` keeps a value already set.
--
-- 3. A partial unique index making #11's once-per-invoice claim exact: payment-failed-mail.ts writes one
--    dashboard_events row, event payment_failed_mail with props.invoice, before it sends, so two deliveries of
--    Stripe's event racing fail one claim with 23505 instead of mailing twice. No existing row has that event, so
--    every row already satisfies it.

alter table public.dashboard_members add column if not exists this_week_opt_out boolean not null default false;

insert into app_settings (key, value) values ('email_payment_failed_enabled', 'false'::jsonb)
on conflict (key) do nothing;

create unique index if not exists dashboard_events_payment_failed_mail_once
  on public.dashboard_events (client_domain_id, (props->>'invoice'))
  where event = 'payment_failed_mail';
