/**
 * The terms of service's version and date (Danny, 8 Nov 2026). The page is /terms (app/terms/page.tsx); checkout
 * states them beside the pay button and records TERMS_VERSION on every Stripe Checkout Session and subscription it
 * opens (lib/checkout/session.ts metadata terms_version), so which version a customer accepted is on their order in
 * Stripe. A change to the terms is a new version and a new date here, given 30 days ahead (clause "changes").
 *
 * REGISTERED_OFFICE is Danny's to give: the address came off every surface on 28 Sep 2026 because it was changing
 * (config/contact.ts COMPANY_LINE). The page prints it beside the company line once it is set.
 */
export const TERMS_VERSION = "1.0";
export const TERMS_UPDATED = "8 November 2026";
export const TERMS_PATH = "/terms";
export const REGISTERED_OFFICE: string | null = null;
