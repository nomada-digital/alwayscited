/**
 * Nomada staff opening a customer's dashboard they are not on (Danny, 14 Nov 2026: Alistair Mac Photography's link in
 * the weekly update he is copied on - AC_VISIBILITY_CC - said "Nothing here"). A customer's dashboard opens only for
 * its own team, and staff are not on it, so a staff session is sent to the hub's "What the customer sees" for that
 * customer, the read-only view staff open it with, instead of the 404. It grants nothing: the hub checks the staff
 * member itself, and anyone else still gets the 404. Pure, no imports.
 */
export const HUB_ORIGIN = "https://dashboards.nomadadigital.co.uk";

export const isStaffEmail = (email: string | null | undefined): boolean => !!email && /^[^@\s]+@nomadadigital\.co\.uk$/i.test(email);

/** The hub's customer page, opened on What the customer sees; null for a slug that is not one. */
export const hubCustomerView = (slug: string): string | null => (/^[a-z0-9-]{1,80}$/.test(slug) ? `${HUB_ORIGIN}/ac/${slug}#customer` : null);
