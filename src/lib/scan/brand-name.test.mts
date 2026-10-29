import assert from "node:assert/strict";
import { test } from "node:test";

import { brandKey, cleanBrandName, displayNamesFor, domainStem, namesBrand, namesSubject, pickDisplayName, subjectKeys } from "./brand-name.ts";

/**
 * `namesBrand` decides `scan_answers.brand_named`, which is the number this
 * product sells: the visibility figure on the free result, the "names X" /
 * "does not name X" line against every engine on the report, the count in the
 * report email's subject, and - through `deriveOpportunities`, which treats a
 * page cited for an answer the brand was absent from as a placement
 * opportunity - the length of the gated placement list.
 *
 * It had no check of any kind until 20 September 2026, and it had shipped two
 * defects by then. The second is the one these cases were written for: a brand
 * with a full stop in it never matched its own spelling.
 *
 * The four suffix cases are the first defect, kept as regression cover.
 */

test("a brand with a full stop matches its own spelling", () => {
  // The defect, in its plainest form: the engine wrote the name exactly as the
  // site spells it and the answer was recorded as not naming the brand.
  assert.ok(namesBrand("Booking.com is the largest travel agency.", "Booking.com"));
  assert.ok(namesBrand("We recommend Checkout.com for payments.", "Checkout.com"));
  assert.ok(namesBrand("See gov.uk for the current guidance.", "Gov.uk"));
  assert.ok(namesBrand("St. Andrews Golf is open all year.", "St. Andrews Golf"));
});

test("a full stop in the name is optional in the prose, not required", () => {
  // Engines drop the stop as readily as they keep it, and the name is read off
  // the site rather than off the answer, so neither spelling can be assumed.
  assert.ok(namesBrand("Booking com is the largest.", "Booking.com"));
  assert.ok(namesBrand("bookingcom is the largest.", "Booking.com"));
  assert.ok(namesBrand("St Andrews Golf is open all year.", "St. Andrews Golf"));
});

test("a full stop is only allowed where the brand has one", () => {
  /**
   * The reason the two gaps are separate classes rather than one permissive
   * one. A sentence that ends on the first word of a brand and begins on the
   * second must not count as the brand being named - that is the flattering
   * direction, and it is the direction the suffix defect failed in too.
   */
  assert.equal(namesBrand("Improve the vibe. Retail buyers agree.", "Vibe Retail"), false);
  assert.equal(namesBrand("Sell more. Rock bottom prices.", "Sell More Rock"), false);
});

test("a name that is punctuation and one letter does not match everything", () => {
  /**
   * With full stops kept rather than removed, a degenerate name reaches the
   * pattern builder holding its separators, and an empty pattern would make
   * the expression `(^|[^a-z0-9])($|[^a-z0-9])` - true of almost any prose.
   */
  assert.equal(namesBrand("Any answer at all, really.", "."), false);
  assert.equal(namesBrand("Any answer at all, really.", "a."), false);
  assert.equal(namesBrand("Any answer at all, really.", "Ltd."), false);
});

test("a company suffix is folded away only at the end", () => {
  assert.ok(namesBrand("Acme is the one to use.", "Acme Ltd"));
  assert.ok(namesBrand("Acme is the one to use.", "Acme Co Ltd"));
  assert.ok(namesBrand("Smith is the one to use.", "Smith & Co., Ltd."));

  // The first defect. Each of these matched a common noun and reported the
  // brand as named.
  assert.equal(namesBrand("Read the magazine for more.", "Inc Magazine"), false);
  assert.equal(namesBrand("Try the shop on the corner.", "Company Shop"), false);
  assert.equal(namesBrand("Their edition prints sell out.", "Limited Edition Prints"), false);
  assert.ok(namesBrand("Co-op stocks it.", "Co-op"));
});

test("words may be run together, but not run into their neighbours", () => {
  assert.ok(namesBrand("NetAPorter carries it.", "Net-a-Porter"));
  assert.ok(namesBrand("Snow + Rock carries it.", "Snow+Rock"));
  assert.equal(namesBrand("The unacme approach.", "Acme"), false);
  assert.equal(namesBrand("Sell acmes by the dozen.", "Acme"), false);
});

test("brandKey folds the differences that are punctuation and nothing else", () => {
  assert.equal(brandKey("London Ski Co."), brandKey("London Ski Co"));
  assert.equal(brandKey("NET-A-PORTER"), brandKey("Net-a-Porter"));
  assert.equal(brandKey("Snow + Rock"), brandKey("Snow+Rock"));
  assert.equal(brandKey("Sportalm Kitzbühel"), brandKey("Sportalm Kitzbuhel"));
  // It deliberately does not merge on a prefix: "Moncler Grenoble" is a line,
  // not the house.
  assert.notEqual(brandKey("Moncler"), brandKey("Moncler Grenoble"));
});

test("the most-mentioned spelling is shown, and a tie does not shout", () => {
  assert.equal(pickDisplayName(new Map([["London Ski Co", 24], ["London Ski Co.", 12]])), "London Ski Co");
  assert.equal(pickDisplayName(new Map([["NET-A-PORTER", 6], ["Net-a-Porter", 6]])), "Net-a-Porter");
  assert.equal(pickDisplayName(new Map()), "");
});

/**
 * `displayNamesFor` is what stops one company holding two rows on its own
 * leaderboard.
 *
 * `scan_brands` is unique on (scan_id, engine, brand), so the spelling is part
 * of the conflict target: a second write under a second spelling inserts beside
 * the first instead of replacing it, and the company's mentions split across
 * the two rows. `scan_teaser` then groups by the raw text and counts
 * `distinct brand`, so the free result's "Nth of M brands" moves as well.
 *
 * Two writes on one scan is not hypothetical. A free pass that fails after the
 * leaderboard is written leaves those rows behind and the confirm route lets a
 * failed scan run again, and the gated pass extracts over its own engines with
 * no sight of what the free pass stored.
 */

test("a spelling already stored wins over this pass's own pick", () => {
  // The defect. This pass saw "London Ski Co." twelve times and nothing else,
  // so left alone it would write that - beside the "London Ski Co" an earlier
  // pass had already stored, splitting 24 and 12 across two rows.
  const variants = new Map([["londonskico", new Map([["London Ski Co.", 12]])]]);
  assert.equal(displayNamesFor(variants, ["London Ski Co"]).get("londonskico"), "London Ski Co");
});

test("an unrelated stored spelling does not steer a different brand", () => {
  const variants = new Map([["snowrock", new Map([["Snow + Rock", 9]])]]);
  const out = displayNamesFor(variants, ["London Ski Co", "Ellis Brigham"]);
  assert.equal(out.get("snowrock"), "Snow + Rock");
  // Only the keys this pass extracted are returned: a name on the table that
  // this pass did not see again must not be re-asserted as a current finding.
  assert.equal(out.size, 1);
});

test("stored spellings are matched through brandKey, not by exact text", () => {
  // The stored row and this pass's extraction differ by punctuation and case
  // alone, which is exactly what brandKey folds - so this is the same company
  // and the stored spelling is the one that ships.
  const variants = new Map([["netaporter", new Map([["NET-A-PORTER", 6]])]]);
  assert.equal(displayNamesFor(variants, ["Net-a-Porter"]).get("netaporter"), "Net-a-Porter");
});

test("a table already split converges rather than picking a third spelling", () => {
  // Rows written before this existed can hold both spellings. pickDisplayName
  // settles which of the stored ones wins, so repeated passes land on the same
  // answer instead of adding to the pile.
  const variants = new Map([["londonskico", new Map([["London Ski Company", 3]])]]);
  const stored = ["London Ski Co", "London Ski Co", "London Ski Co."];
  assert.equal(displayNamesFor(variants, stored).get("londonskico"), "London Ski Co");
});

test("with nothing stored it is pickDisplayName, unchanged", () => {
  const seen = new Map([["London Ski Co", 24], ["London Ski Co.", 12]]);
  const variants = new Map([["londonskico", seen]]);
  assert.equal(displayNamesFor(variants).get("londonskico"), pickDisplayName(seen));
  assert.equal(displayNamesFor(variants, []).get("londonskico"), "London Ski Co");
});

test("a stored name that folds to nothing is ignored rather than chosen", () => {
  // brandKey("---") is "", which is not a key any extraction produces. A row
  // like that must not become the display name for something else.
  const variants = new Map([["snowrock", new Map([["Snow+Rock", 4]])]]);
  assert.equal(displayNamesFor(variants, ["---", "  "]).get("snowrock"), "Snow+Rock");
});

/**
 * `namesSubject` - 24 September 2026. A live scan on rotaready.com read the
 * brand as "Rotaready Evo (The Access Group)" and scored 0 of 17 answers
 * named, while 9 of the 17 named "Rotaready". Written before the fix and run
 * against the tree without it.
 */
test("the subject is named under the name its domain spells", () => {
  const brand = "Rotaready Evo (The Access Group)";
  assert.ok(namesSubject("Rotaready | Restaurants, pubs, hotels & growing groups", brand, "rotaready.com"));
  assert.ok(namesSubject("I'd look closely at Deputy, Planday, RotaCloud and Rotaready.", brand, "rotaready.com"));
  assert.ok(namesSubject("Try Rotaready Evo for multi-site groups.", brand, "https://www.rotaready.com/"));
  // The old matcher, for the record of what failed.
  assert.equal(namesBrand("Rotaready | Restaurants", brand), false);
});

test("the bracketed parent is never the subject", () => {
  const brand = "Rotaready Evo (The Access Group)";
  assert.equal(namesSubject("The Access Group sells payroll and HR software.", brand, "rotaready.com"), false);
  assert.equal(namesSubject("Access Group payroll", brand, "rotaready.com"), false);
});

test("a domain-derived single word only counts with a capital", () => {
  // "Deputy" the product against "a deputy manager".
  assert.ok(namesSubject("Deputy is strong for shift swaps.", "Deputy Scheduling", "deputy.com"));
  assert.equal(namesSubject("Ask your deputy manager to check the rota.", "Deputy Scheduling", "deputy.com"), false);
});

test("the domain only shortens a name whose leading words spell it", () => {
  // Not anchored: the domain spells nothing at the front of the name.
  assert.equal(namesSubject("Moncler has a new line.", "Moncler Grenoble", "grenoble-outdoor.com"), false);
  // Anchored.
  assert.ok(namesSubject("Moncler has a new line.", "Moncler Grenoble", "moncler.com"));
  // A stem under four letters never shortens a name.
  assert.equal(namesSubject("Buy from Ace today.", "Ace Hardware Group", "ace.com"), false);
});

test("a tagline or bracket in the read name does not stop the name matching", () => {
  assert.ok(namesSubject("We recommend Acme for payroll.", "Acme | Payroll software", null));
  assert.ok(namesSubject("Fladgate is a strong choice.", "Fladgate (London)", "fladgate.com"));
});

test("subjectKeys covers every spelling the matcher accepts", () => {
  const keys = subjectKeys("Rotaready Evo (The Access Group)", "rotaready.com");
  assert.ok(keys.has("rotaready"));
  assert.ok(keys.has("rotareadyevo"));
  assert.ok(keys.has("rotareadyevotheaccessgroup"));
  assert.equal(keys.has("theaccessgroup"), false);
});

test("domainStem reads the name out of the host", () => {
  assert.equal(domainStem("rotaready.com"), "rotaready");
  assert.equal(domainStem("https://www.acme.co.uk/about"), "acme");
  assert.equal(domainStem("higgsllp.co.uk"), "higgsllp");
  assert.equal(domainStem("localhost"), null);
});

test("a name closed by a descriptor counts without it, anchored on the domain (Grace Foods, 29 Oct 2026)", () => {
  // The two answers on the live gracefoods.com scan that named it and were scored as not naming it.
  assert.ok(namesSubject("- **Grace** — the essential anchor brand: ackee, canned fish", "Grace Foods", "gracefoods.com"));
  assert.ok(namesSubject("Grace Tropical Rhythms Mango Carrot", "Grace Foods", "gracefoods.com"));
  assert.ok(subjectKeys("Grace Foods", "gracefoods.com").has("grace"));
  // A single word only with a capital.
  assert.equal(namesSubject("Most suppliers give a 30 day grace period.", "Grace Foods", "gracefoods.com"), false);
  // Not anchored: the domain does not start with the short name.
  assert.equal(namesSubject("Grace is a classic.", "Grace Foods", "caribbeanpantry.com"), false);
  assert.equal(namesSubject("Grace is a classic.", "Grace Foods"), false);
  // Several descriptors fold, a multi-word lead keeps its own words.
  assert.ok(namesSubject("Stock Island Spice for jerk.", "Island Spice Foods UK", "islandspicefoods.co.uk"));
  // Never under four letters, and never down to a descriptor.
  assert.equal(namesSubject("Buy from Ace today.", "Ace Group", "acegroup.com"), false);
  assert.equal(subjectKeys("Global Foods", "globalfoods.com").has("global"), false);
});

test("a trade mark on the stored name does not stop it matching (goodtrip, 22 Oct 2026)", () => {
  // A live alwaysmentioned order stored "goodtrip®", which matched only its own literal spelling.
  for (const prose of ["Try Goodtrip", "GoodTrip Clothing makes souvenir tees.", "Order from goodtrip.co.uk today."]) {
    assert.equal(namesSubject(prose, "goodtrip®", "goodtrip.co.uk"), true, prose);
    assert.equal(namesSubject(prose, "goodtrip®"), true, `${prose} (no domain)`);
  }
  assert.equal(namesSubject("Have a good trip!", "goodtrip®", "goodtrip.co.uk"), false);
  assert.equal(namesBrand("Acme Tools are cheap", "Acme™ Tools"), true);
  assert.equal(cleanBrandName("goodtrip®"), "goodtrip");
  assert.equal(cleanBrandName("Acme™ Tools ©"), "Acme Tools");
  assert.equal(cleanBrandName("Plain"), "Plain");
});
