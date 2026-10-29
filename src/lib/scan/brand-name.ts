import { normalizeDomain } from "./domain.ts";

/**
 * Brand name matching.
 *
 * Engines spell the same brand differently, and the leaderboard is keyed on
 * raw text, so the same company arrives several times and splits its own
 * score. On the first live scan the subject appeared twice - "London Ski Co"
 * at 24 mentions from three engines and "London Ski Co." at 12 from ChatGPT -
 * which understated the client by a third and cost them five places.
 *
 * Worse, the subject was matched with `trim().toLowerCase()`, so the spelling
 * with the full stop was not recognised as the subject at all and was filed as
 * a competitor on the client's own report.
 *
 * brandKey folds the differences that are punctuation and nothing else:
 * case, accents, spacing, ampersands, hyphens, full stops. Everything that
 * survives is a letter or a digit.
 *
 *   "London Ski Co."      -> londonskico
 *   "London Ski Co"       -> londonskico
 *   "NET-A-PORTER"        -> netaporter
 *   "Net-a-Porter"        -> netaporter
 *   "Snow + Rock"         -> snowrock
 *   "Snow+Rock"           -> snowrock
 *   "Sportalm Kitzbühel"  -> sportalmkitzbuhel
 *   "Sportalm Kitzbuhel"  -> sportalmkitzbuhel
 *
 * What it deliberately does NOT do is merge on prefixes. "Sportalm" stays
 * separate from "Sportalm Kitzbühel", and "Amundsen" from "Amundsen Sports",
 * because the same rule would merge "Snow Peak" into "Snow+Rock" and merge
 * "Moncler Grenoble" - a distinct line - into "Moncler". Under-merging leaves
 * two honest rows; over-merging invents a number nobody can check.
 */
export function brandKey(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Pick which spelling to show for a set of variants that share a key.
 *
 * Most-mentioned wins, because that is how the engines mostly wrote it. The
 * tie-breaks matter more than they look: without the all-caps rule a 6-6 tie
 * between "NET-A-PORTER" and "Net-a-Porter" resolves alphabetically and the
 * report shouts at the reader.
 */
export function pickDisplayName(variants: Map<string, number>): string {
  const rows = [...variants.entries()];
  rows.sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    const aShout = a[0] === a[0].toUpperCase() && /[A-Z]/.test(a[0]);
    const bShout = b[0] === b[0].toUpperCase() && /[A-Z]/.test(b[0]);
    if (aShout !== bShout) return aShout ? 1 : -1;
    if (b[0].length !== a[0].length) return b[0].length - a[0].length;
    return a[0].localeCompare(b[0]);
  });
  return rows[0]?.[0] ?? "";
}

/**
 * One spelling per brand key for a whole scan, preferring one already stored.
 *
 * `pickDisplayName` chooses from the variants in front of it, which is right
 * within a single extraction and not enough across two. The population differs
 * between passes, so the same company can win under one spelling now and
 * another later - and `scan_brands` is unique on (scan_id, engine, brand), so
 * the spelling is part of the conflict target. A second write under a second
 * spelling therefore INSERTS rather than replaces, and the company appears
 * twice on its own leaderboard with its mentions split between the two rows.
 *
 * That is the defect this file's header opens with - "London Ski Co" at 24 and
 * "London Ski Co." at 12, understating the client by a third and costing five
 * places - reappearing one level up, between writes instead of within one.
 *
 * Two routes to it, and they are not equally live. The reachable one today is
 * a re-run: a free pass that fails after the leaderboard is written leaves
 * those rows behind, and the confirm route lets a failed scan be run again by
 * design, so the retry re-extracts freshly read prose and may well land on the
 * other spelling.
 *
 * The second is the gated pass, which extracts over its own engines only and so
 * picks without sight of what the free pass stored. That one is dormant rather
 * than live - `GATED_ENGINES` is empty, so no gated pass runs - but it is armed
 * by an `app_settings` row rather than by a deploy, because `scan_engines_gated`
 * is read from the table and edited by hand in the Supabase editor. Worth
 * closing now rather than when somebody turns the engines back on and the
 * leaderboard quietly starts double-counting.
 *
 * Preferring the stored spelling fixes both at the write, which is what makes
 * it worth doing here rather than merging in each reader: `scan_teaser` groups
 * by the raw text in SQL and `buildUnlockPayload` keys a Map on it, so a fix in
 * one reader would leave the other disagreeing with it. One spelling per key on
 * the way in keeps both correct and needs no migration.
 *
 * Which stored spelling wins, when the table already holds more than one, is
 * settled by `pickDisplayName` over the stored set - so this is stable rather
 * than merely first-seen, and a row set that is already split converges instead
 * of picking a third spelling.
 */
export function displayNamesFor(
  variants: Map<string, Map<string, number>>,
  stored: Iterable<string> = [],
): Map<string, string> {
  const storedByKey = new Map<string, Map<string, number>>();
  for (const name of stored) {
    const trimmed = name.trim();
    const key = brandKey(trimmed);
    if (!key) continue;
    const seen = storedByKey.get(key) ?? new Map<string, number>();
    // Counted, not collected, so pickDisplayName's tie-breaks decide a split
    // set the same way they decide a fresh one.
    seen.set(trimmed, (seen.get(trimmed) ?? 0) + 1);
    storedByKey.set(key, seen);
  }

  const out = new Map<string, string>();
  for (const [key, seen] of variants) {
    const already = storedByKey.get(key);
    out.set(key, already ? pickDisplayName(already) : pickDisplayName(seen));
  }
  return out;
}

/** ®, ™, © and ℠: marks a site prints beside its name and an answer never does. */
const MARKS = /[®™©℠]/g;

/**
 * The name without its trade marks - 22 Oct 2026.
 *
 * A brand read off its own site as "goodtrip®" was matched as the literal
 * "goodtrip®", so "Try Goodtrip", "GoodTrip Clothing" and "goodtrip.co.uk"
 * all read as not naming it: the mark is not a separator, so it stayed inside
 * the pattern, and the single word could not take the domain-stem alias
 * either. Stripped here, before matching, and where the name is stored.
 */
export function cleanBrandName(name: string): string {
  return name.replace(MARKS, "").replace(/\s+/g, " ").trim();
}

/** Folded away only at the end of a name. See namesBrand. */
const COMPANY_SUFFIX = /\s+(ltd|limited|inc|llc|plc|gmbh|co|company)$/;

/** A trailing full stop is punctuation around the name, never part of it. */
const TRAILING_STOP = /\.+$/;

/**
 * A connector left dangling by the fold above, as in "Smith & Co., Ltd." ->
 * "smith &". No name ends in one; this only ever appears because the word it
 * joined has just been folded away.
 */
const DANGLING_CONNECTOR = /\s*(?:&|\+|\band)$/;

/** The gap between two words of a brand: zero or more, because engines run names together. */
const GAP = "[\\s\\-]*";

/**
 * What separates two words inside a brand, kept rather than discarded so the
 * pattern can be built with the separators the name actually uses.
 */
const SEPARATORS = /([\s\-.+&]+)/;

/**
 * One gap in the pattern, built from the gap in the name.
 *
 * A full stop is optional where the name has one: engines write "Booking.com"
 * and "Booking com" and "bookingcom", and the name is read off the site rather
 * than off the answer, so neither spelling can be assumed.
 *
 * An ampersand or a plus is required where the name has one, with the spaces
 * around it optional - which is what makes this agree with `brandKey` on its
 * own worked example, "Snow + Rock" and "Snow+Rock" being one company.
 *
 * What none of them do is widen a plain space. A gap that accepted a full stop
 * everywhere would match "Vibe Retail" against "improve the vibe. Retail
 * buyers agree", and a false positive here tells a buyer an engine named them
 * when it did not - the direction the suffix defect below already failed in
 * once.
 */
function gapFor(run: string): string {
  if (run.includes(".")) return `${GAP}\\.?${GAP}`;
  const symbol = run.includes("+") ? "\\+" : run.includes("&") ? "&" : null;
  return symbol ? `${GAP}${symbol}${GAP}` : GAP;
}

/**
 * The brand as a regular expression source.
 *
 * Words therefore never contain a separator; the escape is for everything
 * else a name can hold - "Which?", "Yahoo!".
 */
function brandPattern(name: string): string {
  const parts = name.split(SEPARATORS);
  let out = "";
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    out += i % 2 === 0 ? part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : gapFor(part);
  }
  return out;
}

/**
 * Does the answer name the brand?
 *
 * Word-boundary matched, case insensitive, with company suffixes folded away.
 * Runs against prose only, never URLs.
 *
 * A suffix is only folded where it actually is one - at the end. It used to be
 * stripped wherever it appeared, which quietly turned three kinds of brand
 * into a common noun and then counted that noun as the brand being named:
 * "Inc Magazine" matched any answer containing "magazine", "Company Shop" any
 * answer containing "shop", and "Limited Edition Prints" matched a rival's
 * "edition prints". named_in is the number this product sells and the one in
 * the subject line of the report email, and every one of those errors pushed
 * it the flattering way - telling a buyer an engine named them when it had
 * not. It also mangled a legitimately hyphenated name: "Co-op" became "-op".
 *
 * **A full stop inside the name is kept, and that is the second defect this
 * function has had.** Every full stop used to be replaced by a space before
 * the pattern was built, so "Booking.com" became the two words "booking" and
 * "com" joined by a gap that matches whitespace and hyphens and nothing else -
 * and the name then did not match its own spelling. Not a near miss: an engine
 * writing "Booking.com" exactly as the site spells it was recorded as not
 * having named the brand, on every answer, for every brand with a full stop in
 * it. That is a large class here, because the brand is read off the site and
 * ".com" is a name a company chooses. The damage ran both ways from one
 * boolean: visibility read zero, and `deriveOpportunities` treats "cited for
 * an answer the brand was absent from" as an opportunity, so the placement
 * list filled up with every page on the report.
 *
 * Applied repeatedly, so "Acme Co Ltd" loses both and still reads as "acme",
 * and "Smith & Co., Ltd." loses the trailing stop between each fold.
 * Whitespace is collapsed first, so a name padded or double-spaced by the
 * model reaches the suffix test in the shape the test expects.
 */
export function namesBrand(prose: string, brand: string): boolean {
  if (!prose || !brand) return false;

  let stripped = cleanBrandName(brand)
    .toLowerCase()
    // A comma always separates. A full stop does not, so it survives to
    // brandPattern - which is what tells "Booking.com" from "Acme Inc.".
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^the\s+/, "")
    .replace(TRAILING_STOP, "")
    .trim();

  for (let prev = ""; stripped !== prev; ) {
    prev = stripped;
    stripped = stripped
      .replace(COMPANY_SUFFIX, "")
      .trim()
      .replace(TRAILING_STOP, "")
      .replace(DANGLING_CONNECTOR, "")
      .trim();
  }

  /**
   * Counted in letters and digits, not characters.
   *
   * With full stops no longer removed, a name that is punctuation and one
   * letter - or punctuation alone - reaches here holding its separators, and
   * an empty pattern makes the expression below `(^|[^a-z0-9])($|[^a-z0-9])`,
   * which matches almost any prose. The guard is what stops a degenerate name
   * reading as named everywhere.
   */
  if (stripped.replace(/[^a-z0-9]/g, "").length < 2) return false;

  return new RegExp(`(^|[^a-z0-9])${brandPattern(stripped)}($|[^a-z0-9])`, "i").test(
    prose.toLowerCase(),
  );
}

/**
 * Second-level labels that sit under a country code and are part of the
 * suffix, not the name: "acme.co.uk" is Acme, not "co".
 */
const SECOND_LEVEL = new Set(["co", "com", "org", "net", "ac", "gov", "ltd", "plc", "me", "edu"]);

/**
 * The name a domain spells, as a brand key, or null:
 * "rotaready.com" -> "rotaready", "www.acme.co.uk" -> "acme".
 */
export function domainStem(domain: string | null | undefined): string | null {
  if (!domain) return null;
  const labels = normalizeDomain(domain).split(".").filter(Boolean);
  if (labels.length < 2) return null;
  let i = labels.length - 2;
  if (labels.length >= 3 && labels[labels.length - 1].length === 2 && SECOND_LEVEL.has(labels[i])) i -= 1;
  return brandKey(labels[i]) || null;
}

/**
 * The read name with the parts that are not the brand taken off: anything in
 * brackets, and anything after a " | " or a spaced dash.
 *
 *   "Rotaready Evo (The Access Group)" -> "Rotaready Evo"
 *   "Acme | Payroll software"          -> "Acme"
 */
function coreName(brand: string): string {
  return brand
    .replace(/\s*[([][^)\]]*[)\]]/g, " ")
    .split(/\s+[|\u2013\u2014-]\s+/)[0]
    .replace(/\s+/g, " ")
    .trim();
}

export type BrandAlias = {
  name: string;
  /**
   * Only counted where the answer writes it with a capital. Set on the one
   * alias that is a single word taken off the domain, because a single word
   * can also be an ordinary noun: "Deputy" the product, "a deputy manager".
   */
  capitalOnly: boolean;
};

/**
 * Every spelling of the subject an answer can use - 24 September 2026.
 *
 * The brand is read off the site by a model, and the model writes what the
 * site says: "Rotaready Evo (The Access Group)". Matching that whole phrase
 * recorded a live scan as named in 0 of 17 answers when 9 of the 17 named
 * "Rotaready" - ChatGPT listed it first - so the one number this product sells
 * told a brand it was invisible when it was in half its answers.
 *
 * So the subject is a small set, not one string:
 *
 *   1. the read name, as before;
 *   2. the core name - the read name without brackets or a tagline;
 *   3. the leading words of the core name that spell the domain, when there
 *      are fewer of them than the whole: "Rotaready Evo" on rotaready.com
 *      gives "Rotaready". Anchored on the domain, which is why this does not
 *      break the no-prefix rule in `brandKey`'s header - "Moncler Grenoble"
 *      only folds to "Moncler" when the site it was read off is moncler.com.
 *
 * What it never does is take the bracketed parent on its own. "The Access
 * Group" is not the brand, and counting it would flatter the subject every
 * time an engine named the group for something else.
 */
export function brandAliases(raw: string, domain?: string | null): BrandAlias[] {
  const brand = cleanBrandName(raw);
  const out: BrandAlias[] = [];
  const seen = new Set<string>();
  const add = (name: string, capitalOnly: boolean) => {
    const key = brandKey(name);
    if (key.length < 2 || seen.has(key)) return;
    seen.add(key);
    out.push({ name, capitalOnly });
  };

  add(brand.trim(), false);
  const core = coreName(brand);
  add(core, false);

  const stem = domainStem(domain);
  if (stem && stem.length >= 4) {
    const words = core.split(" ");
    for (let n = 1; n < words.length; n++) {
      const lead = words.slice(0, n).join(" ");
      if (brandKey(lead) === stem) {
        add(lead, n === 1);
        break;
      }
    }
  }

  const short = withoutDescriptor(core, stem);
  if (short) add(short, !short.includes(" "));
  return out;
}

/**
 * Words that say what kind of company a name is rather than which one, when
 * they close it: "Grace Foods", "Acme Group", "Tropic Drinks UK".
 */
const DESCRIPTOR = new Set([
  "food", "foods", "drinks", "beverages", "brand", "brands", "products", "group", "holdings", "international",
  "global", "trading", "industries", "enterprises", "uk", "usa", "us", "online", "shop", "store", "official",
]);

/**
 * The name without the descriptor words that close it - 29 Oct 2026.
 *
 * The scan of gracefoods.com read the brand as "Grace Foods" and scored 0 of 8,
 * while two answers named it the way buyers do: "**Grace** - the essential
 * anchor brand" and "Grace Tropical Rhythms". The domain rule above could not
 * help, because there the domain spells the whole name, not its leading words.
 *
 * Anchored on the domain as that rule is, so this is not the prefix merge
 * `brandKey`'s header refuses: the short name must be where the domain starts,
 * which "Grace" is on gracefoods.com and "Moncler" is not on grenoble.com. Four
 * letters or more, never a descriptor itself, and a single word only counts
 * with a capital ("grace period" is not the brand).
 */
function withoutDescriptor(core: string, stem: string | null): string | null {
  if (!stem) return null;
  const words = core.split(" ").filter(Boolean);
  let n = words.length;
  while (n > 1 && DESCRIPTOR.has(brandKey(words[n - 1]))) n -= 1;
  if (n === words.length) return null;
  const lead = words.slice(0, n).join(" ");
  const key = brandKey(lead);
  if (key.length < 4 || DESCRIPTOR.has(key) || !stem.startsWith(key)) return null;
  return lead;
}

/** The brand keys that are the subject, so it stays off its own leaderboard. */
export function subjectKeys(brand: string, domain?: string | null): Set<string> {
  return new Set(brandAliases(brand, domain).map((a) => brandKey(a.name)));
}

/**
 * Does the answer name the subject under any of its spellings? What
 * `readAndStore` calls; `namesBrand` stays the one-spelling matcher it is
 * built on.
 */
export function namesSubject(prose: string, brand: string, domain?: string | null): boolean {
  if (!prose || !brand) return false;
  return brandAliases(brand, domain).some((a) =>
    a.capitalOnly ? namesWithCapital(prose, a.name) : namesBrand(prose, a.name),
  );
}

/** `namesBrand` for one word, counted only where the prose capitalises it. */
function namesWithCapital(prose: string, word: string): boolean {
  if (!namesBrand(prose, word)) return false;
  const pattern = new RegExp(`(^|[^a-z0-9])(${brandPattern(word.toLowerCase())})(?=$|[^a-z0-9])`, "gi");
  for (const m of prose.matchAll(pattern)) {
    const first = m[2][0];
    if (first && first !== first.toLowerCase()) return true;
  }
  return false;
}

/**
 * The generated questions that name the subject (30 Sep 2026). A question that
 * names the brand always names it, so it measures nothing a buyer does - and
 * copied into tracking, it inflates the named rate. The same matcher as
 * "named"; `generateQuestions` asks again once, then drops what is left.
 */
export function brandedQuestions<T extends { question: string }>(questions: readonly T[], brand: string, domain?: string | null): T[] {
  return questions.filter((q) => namesSubject(q.question, brand, domain));
}

export function withoutBrand<T extends { question: string }>(questions: readonly T[], brand: string, domain?: string | null): T[] {
  return questions.filter((q) => !namesSubject(q.question, brand, domain));
}
