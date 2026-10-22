-- Payment received - your invoice (22 Oct 2026, src/lib/checkout/invoice-mail.ts). Additive: one settings row.
-- A transactional email: sent because a customer paid, with their invoice's Stripe page and PDF. Unlike the lifecycle
-- emails it ships ON (lifecycle-flag.ts transactionalOn reads a missing row as on); set it to false to stop it.
insert into app_settings (key, value) values ('email_payment_received_enabled', 'true'::jsonb)
on conflict (key) do nothing;
