/**
 * Field bounds for the contact form, in one place because both sides need them.
 *
 * The server rejects anything over these - it has to, the form is a public
 * endpoint and nothing stops a post that never rendered the page. The inputs
 * carry them as maxLength too, so somebody pasting a long message is stopped
 * at the field rather than by an error after they press Send.
 *
 * They cannot live in contact/actions.ts: a "use server" module may only
 * export async functions, so a client component cannot read a constant from it.
 */
/**
 * email is 254 because that is the longest an address may be over SMTP
 * (RFC 5321). It was the one field with no bound on either side, while the
 * comment above and the one in contact/actions.ts both said every field had
 * one - and it is the field that goes into a header rather than a body, as
 * the reply-to on the message we send ourselves.
 */
/**
 * website is the honeypot. It is never sent in a message, so it looked like
 * the one field that did not need a bound - but a filled one is logged, and
 * an unbounded attacker-controlled string written to a function log is the
 * same exposure as one written to a header, just paid for by the megabyte
 * rather than delivered.
 *
 * This is the second time the comments here and in contact/actions.ts have
 * promised every field was bounded while one was not. It was email last time,
 * for the same reason: the field nobody pictured as a field.
 */
/**
 * tier, sector, clusters and market are the picks a tier's CTA carries to
 * /contact (R69), posted as hidden inputs. Nobody types them, so a long one
 * is a hand-made post: bounded, then validated against the tier names and
 * SECTORS, and dropped rather than refused if it does not match.
 */
export const CONTACT_LIMITS = {
  name: 120,
  email: 254,
  company: 200,
  message: 5000,
  website: 200,
  tier: 40,
  sector: 60,
  clusters: 4,
  market: 4,
};

/**
 * The address the site publishes, which is not the address mail is delivered
 * to - and the whole point of naming it here is that those are two facts.
 *
 * Delivery is `process.env.CONTACT_EMAIL_DESTINATION`, which a deployment may
 * point anywhere and which no agent here can read. This is the string a
 * visitor is shown and told to write to: the footer, /legal's mailto, the
 * "reaches the same people" line on /contact, both actions' send-failed
 * copy, and `contactPoint.email` in the JSON-LD an answer engine parses.
 * They share a default because the default should be the published address,
 * and they are separate constants because a deployment changing where mail
 * lands must not silently change what the site tells people to write to.
 *
 * Counted on 20 Sep 2026: the literal was typed thirteen times across seven
 * files and no constant existed. That is the two-copies species at its
 * largest instance in this tree - the date formatter, the honeypot and
 * `brand-name.ts` were two each, and in every one the untested copy was the
 * wrong one. Thirteen is not a rename anybody completes by grep, and the
 * copies that would survive it are the two nobody reads while working: the
 * `mailto:` on /legal and the machine-readable one in the entity graph.
 *
 * `contact.test.mts` sweeps the tree for the bare literal, so a fourteenth
 * cannot be typed.
 */
export const CONTACT_EMAIL = "hello@alwayscited.com";

/**
 * The same, for the other public form.
 *
 * `RequestScanForm` posts to a "use server" action that mails Danny, and it had
 * no bound on any of its three fields on either side - so the defect this file
 * exists for had a third instance, in a file neither the comments here nor
 * `contact.test.mts` could see. Both were scoped to the contact action, and the
 * species is not "the contact form" but "a public form whose values we put in a
 * message".
 *
 * They live beside CONTACT_LIMITS rather than in their own module so that there
 * is one place to look and one denominator to sweep. A fourth form with its own
 * table somewhere else is how this happens a fourth time.
 *
 * domain is 253, the longest a DNS name may be, and it is the bound the live
 * scan path already enforces in `isPlausibleDomain`. email is 254 for the same
 * RFC 5321 reason as above; it becomes the reply-to header on what we send
 * ourselves. topic is free text and matches `company`.
 *
 * website is the honeypot, and it is here because the species this file names
 * had a fourth instance after all: the contact action has read a hidden
 * `website` field since `a22129b` and the waitlist action read nothing, so the
 * two public forms facing the same web were guarded differently. Bounded at the
 * log for the reason CONTACT_LIMITS.website is - a filled one is written to a
 * function log, and an unbounded attacker-controlled string is paid for by the
 * megabyte whether or not anybody reads it.
 */
export const WAITLIST_LIMITS = { domain: 253, topic: 200, email: 254, website: 200 };

/**
 * The order form on /checkout (R91, 29 Sep 2026). `email` and `keyword` are
 * refused over their bound by `checkoutRequest`; the hidden picks are cut to
 * theirs by `/api/checkout` before they are read, and must then validate.
 */
/**
 * The /app Clusters search box (T6 part 1, 30 Sep 2026); the page cuts `?q=` to it before filtering.
 * `note`: Add a note on the one-cluster page (T7 part 4b, 30 Sep 2026) - tracking_notes' own
 * check is 1 to 200 characters, and note.ts refuses past it before the insert.
 * `task`: Add a task on Actions (13 Oct 2026, DIY P3) - plan_items.title's own check is 1 to 200
 * characters, and plan/transitions.ts readTitle refuses past it before the insert. A note on an
 * Actions item takes `note`, the same 200 as plan_items.note's check.
 */
export const APP_LIMITS = { search: 120, note: 200, email: 254, task: 200 };

// `website`: asked only when the order has no scan (R158, 1 Oct 2026); a hostname's own bound.
// gaClientId (15 Oct 2026): the GA client id, "<digits>.<digits>", passed to
// Stripe's metadata so the webhook's server-side purchase joins the visit.
export const CHECKOUT_LIMITS = { email: 254, keyword: { min: 2, max: 120 }, tier: 20, sector: 60, clusters: 4, market: 4, scan: 32, website: 253, gaClientId: 25 };

/**
 * The campaign benchmark form, which is the fourth table this file predicted.
 *
 * The comment above says in as many words that "a fourth form with its own
 * table somewhere else is how this happens a fourth time", and that is exactly
 * what `/api/coverage-check` had: `text(body.brand, 2, 80)`,
 * `text(body.topic, 2, 120)` and `text(body.segment, 2, 80)` typed into the
 * route, with no bound of any kind on the four inputs that feed them.
 *
 * The route was never wrong - it refuses an over-length value the way it always
 * did. What was wrong is what the visitor is told. `text()` returns null for
 * too-short and too-long alike, and the message only describes the short case,
 * so pasting a long brand name got back "Tell us the brand name." after a
 * Turnstile check and a round trip, on the one form on this site that spends
 * money. The bound on the input makes that branch unreachable from the form.
 *
 * min is here as well as max because the route checks both, and a table that
 * only carried the half the input uses is how the two drift apart again.
 */
export const COVERAGE_LIMITS = {
  brand: { min: 2, max: 80 },
  topic: { min: 2, max: 120 },
  segment: { min: 2, max: 80 },
  /**
   * The two pasted blocks on the benchmark form, bounded as whole textareas
   * rather than per line.
   *
   * Per line is what the eye expects and it is the wrong unit - the field is
   * one string on the wire, the server bounds one string, and a per-line bound
   * in the browser would leave the actual body unbounded.
   *
   * The row ceilings, MAX_COVERAGE_URLS and MAX_AGENCY_PROMPTS, are separate
   * and do a different thing. They cap how many lines are *used*, after
   * parsing. These cap how much can be typed at all.
   *
   * Sized to hold those ceilings with slack - five long URLs carrying campaign
   * tracking tags, and five prompts of a sentence each.
   */
  links: { min: 0, max: 2000 },
  prompts: { min: 0, max: 1000 },
};

/**
 * The scan flow's own two editable fields, which are a different pair of
 * numbers from the waitlist's and were reached by a different route.
 *
 * `ConfirmScreen` is where a question is edited before it is billed. Its
 * category field had no bound while the confirm and questions routes both
 * refuse a topic over 120; its question rows had `maxLength={200}`, a typed
 * literal that happens to match the routes' own 200 rather than reading it.
 * One of the two was a live gap and the other was a coincidence waiting to
 * stop being one, and neither is the waitlist's `topic: 200` - that bound
 * belongs to `TopicScreen`, which posts to the waitlist action and not to a
 * scan route, so it is correct where it is and must not be tidied into
 * agreement with these.
 */
/**
 * topicVariant is the fifth bound this file predicted, and it arrived the way
 * the fourth did: typed inline, in two routes, on the same field.
 *
 * `confirm` and `questions` both take `body.topic_variants` off the wire and
 * both filtered it with `v.length >= 2 && v.length <= 80` written as literals.
 * Nothing joined the two, so they were one edit from disagreeing about what the
 * same screen may send - and the same pair disagreed about the *cap* already:
 * `questions` sliced at `TOPIC_VARIANT_COUNT` while `confirm` typed a `5`.
 *
 * It has no `maxLength` anywhere and that is correct - a variant is a chip the
 * model wrote and the visitor toggles, never a field. So this is a bound the
 * server owns outright, which is the case `input-bounds.test.mts` covers by
 * asking for a server reader rather than for an input.
 *
 * min and max together, for the reason COVERAGE_LIMITS carries both: the routes
 * check both ends, and a table holding one half is how the halves drift.
 */
export const SCAN_LIMITS = {
  topic: 120,
  question: 200,
  email: 254,
  topicVariant: { min: 2, max: 80 },
};

/**
 * The walkthrough ask's three required fields (Danny, 13 Oct 2026): the
 * person's name, their business category and their market. Its email is
 * SCAN_LIMITS.email, as it always was.
 *
 * name matches CONTACT_LIMITS.name and is typed, so it is refused over the
 * bound by both walkthrough routes (lib/scan/walkthrough-fields.ts). category
 * and market are picked, not typed - a select of SECTORS ids and two radios -
 * so a long one is a hand-made post: refused over these bounds before it is
 * matched against SECTORS or the two markets. 60 and 4 are the contact
 * form's sector and market bounds, for the same values.
 */
export const WALKTHROUGH_LIMITS = { name: 120, category: 60, market: 4 };

/**
 * Who runs the site, in the words Danny gave on 26 Sep 2026 (R31) - the
 * footer and /legal both print this. Name and number only: the address is
 * changing, so it is off every surface (Danny, 28 Sep 2026, R81). The ICO
 * number is not here: it is still unconfirmed (docs/blocked.md item 1).
 */
export const COMPANY_LINE = "Nomada Digital Ltd, company number 12869202";
