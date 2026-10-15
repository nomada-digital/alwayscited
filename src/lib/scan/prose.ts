/**
 * HTML to the prose the brand read is given, and nothing else.
 *
 * Extracted from crawl.ts for the reason email-render.ts was extracted from
 * verify-email.ts: crawl.ts opens with `import "server-only"`, so nothing in it
 * loads under `node --test`, and every claim ever made about this function was
 * a claim about its source read back rather than about its output. This file
 * imports nothing at all, so the test can run it.
 *
 * The same argument that justified reading the declared charset applies here.
 * That comment is worth repeating because it is the whole reason this file
 * exists: the prose is the only thing the model is given to name the company
 * from, so a character mangled on the way through is not a rendering blemish,
 * it is the input to the one judgement this step makes.
 */

/**
 * Named entities, decoded because an HTML parser would.
 *
 * Not the full HTML5 table, which is 2231 entries and would be most of this
 * file to carry a long tail this crawler does not meet. What is here is the
 * punctuation and the accented letters that appear in ordinary British and
 * European marketing prose - the market crawl.ts says this scans - plus the
 * five that are structural.
 *
 * Numeric entities are handled generically below, which is what actually
 * covers the tail: a CMS that emits `&rsquo;` usually emits `&#8217;` on the
 * next page.
 *
 * A Map rather than an object, and that is the second defect this table has
 * carried. `NAMED[body]` read the prototype chain as well as the table, and
 * the entity grammar below accepts any run of letters - so `&constructor;` on
 * a page resolved to Object, `&toString;` and `&valueOf;` to their functions,
 * and the `?? raw` fallback never fired because a function is not nullish. The
 * prose handed to the brand read then contained the text
 * "function Object() { [native code] }" where the page had written an entity
 * it does not recognise, which the paragraph at the top of this file is
 * exactly about: this string is the only thing the model is given to name the
 * company from.
 *
 * A Map has no inherited keys, so the lookup can only answer with something
 * written here. CP1252 below is keyed by number and cannot reach a prototype
 * member, which are all named, so it is left as it is.
 */
const NAMED: ReadonlyMap<string, string> = new Map(Object.entries({
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  // Punctuation a word processor produces and a CMS pastes through.
  lsquo: "‘",
  rsquo: "’",
  sbquo: "‚",
  ldquo: "“",
  rdquo: "”",
  bdquo: "„",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  bull: "•",
  middot: "·",
  prime: "′",
  Prime: "″",
  // Symbols that carry meaning in a price or a company name.
  pound: "£",
  euro: "€",
  cent: "¢",
  yen: "¥",
  copy: "©",
  reg: "®",
  trade: "™",
  deg: "°",
  times: "×",
  frac12: "½",
  frac14: "¼",
  frac34: "¾",
  // Accented letters. British and European sites, per crawl.ts.
  agrave: "à",
  aacute: "á",
  acirc: "â",
  atilde: "ã",
  auml: "ä",
  aring: "å",
  aelig: "æ",
  ccedil: "ç",
  egrave: "è",
  eacute: "é",
  ecirc: "ê",
  euml: "ë",
  igrave: "ì",
  iacute: "í",
  icirc: "î",
  iuml: "ï",
  ntilde: "ñ",
  ograve: "ò",
  oacute: "ó",
  ocirc: "ô",
  otilde: "õ",
  ouml: "ö",
  oslash: "ø",
  ugrave: "ù",
  uacute: "ú",
  ucirc: "û",
  uuml: "ü",
  yacute: "ý",
  yuml: "ÿ",
  szlig: "ß",
  Agrave: "À",
  Aacute: "Á",
  Acirc: "Â",
  Atilde: "Ã",
  Auml: "Ä",
  Aring: "Å",
  AElig: "Æ",
  Ccedil: "Ç",
  Egrave: "È",
  Eacute: "É",
  Ecirc: "Ê",
  Euml: "Ë",
  Ntilde: "Ñ",
  Ograve: "Ò",
  Oacute: "Ó",
  Ocirc: "Ô",
  Otilde: "Õ",
  Ouml: "Ö",
  Oslash: "Ø",
  Ugrave: "Ù",
  Uacute: "Ú",
  Ucirc: "Û",
  Uuml: "Ü",
}));

/**
 * Windows-1252 code points for the C1 range, which is what `&#147;` means.
 *
 * Nothing legitimate lives at U+0080-U+009F, so a numeric entity pointing
 * there is a page that meant the cp1252 byte - a curly quote, an en dash, an
 * ellipsis. Every browser applies this mapping and a page author testing in one
 * has no way to know they wrote something invalid. Decoding it literally puts a
 * control character in the prompt where the page showed a quotation mark.
 */
const CP1252: Readonly<Record<number, string>> = {
  0x80: "€", 0x82: "‚", 0x83: "ƒ", 0x84: "„", 0x85: "…",
  0x86: "†", 0x87: "‡", 0x88: "ˆ", 0x89: "‰", 0x8a: "Š",
  0x8b: "‹", 0x8c: "Œ", 0x8e: "Ž", 0x91: "‘", 0x92: "’",
  0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—",
  0x98: "˜", 0x99: "™", 0x9a: "š", 0x9b: "›", 0x9c: "œ",
  0x9e: "ž", 0x9f: "Ÿ",
};

/** A code point as text, or the entity left alone if it is not one. */
function fromCodePoint(n: number, raw: string): string {
  if (CP1252[n]) return CP1252[n];
  // Surrogates and anything past the last plane are not characters, and
  // String.fromCodePoint throws on them rather than returning something.
  if (n === 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return raw;
  try {
    return String.fromCodePoint(n);
  } catch {
    return raw;
  }
}

/**
 * Decode HTML entities, each one exactly once.
 *
 * One pass is the point of this function and it is the defect it was written
 * to fix. crawl.ts ran seven `.replace()` calls in sequence with `&amp;` first,
 * so the output of that replacement was scanned by the six after it: a page
 * displaying the literal text `&lt;` - which is written `&amp;lt;` in the
 * source, and is what any page showing a code sample contains - decoded to `&`
 * on the first pass and then to `<` on the seventh. The prose handed to the
 * model said the page contained a tag where the page in fact showed the text of
 * one.
 *
 * A single regex cannot do that, because the replacement is never re-examined.
 * It is the same ordering fault as the userinfo strip in domain.ts and it was
 * found by looking for that one again.
 *
 * An entity this does not know is left exactly as it arrived rather than
 * dropped, so the prose still reads as the page's own text.
 */
export function decodeEntities(input: string): string {
  return input.replace(
    /&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/g,
    (raw, body: string) => {
      if (body[0] === "#") {
        const hex = body[1] === "x" || body[1] === "X";
        const n = parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
        return Number.isNaN(n) ? raw : fromCodePoint(n, raw);
      }
      return NAMED.get(body) ?? raw;
    },
  );
}

/**
 * Strip scripts, styles and tags, leaving readable prose.
 *
 * The order here is load-bearing in the other direction from the decode above:
 * tags come out BEFORE entities go in. Decoding first would turn a page's
 * `&lt;script&gt;` into a tag that the strip below then removes along with
 * whatever prose followed it - the page's own text deleting the page's own
 * text. Keep the decode last.
 */
/**
 * The markup with every block that carries no prose taken out: script, style,
 * noscript, svg and comments. Tags and their text stay, so links survive it.
 *
 * Exported because crawl.ts runs it while the page is still streaming in, and
 * caps what is kept rather than what was read (15 Oct 2026).
 *
 * The defect, thelabjamaica.com on 15 Oct 2026. A Wix homepage is 800KB, and
 * its first 300KB is inline CSS and JavaScript. The crawl kept the first 200KB
 * of bytes, which ended inside an open `<style>`. The pair patterns below need
 * the closing tag, so that block was never removed: 3,473 characters of CSS
 * reached the brand read as the company's prose, cleared the too_thin check,
 * and the title, the nav and every word of copy sat past the cut.
 *
 * So a block opened and never closed is dropped to the end of the string. A
 * page cut mid-script is a page whose remainder is script, and keeping it is
 * the one wrong answer. svg is left out of that rule: `<svg ... />` closes
 * itself, and treating it as open would throw away the rest of the page.
 */
export function stripNonProse(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(?:script|style|noscript)\b[\s\S]*$/i, " ")
    .replace(/<!--[\s\S]*$/, " ");
}

export function toProse(html: string): string {
  return decodeEntities(stripNonProse(html).replace(/<[^>]+>/g, " "))
    // Collapsed after the decode, because `&nbsp;` and `&#10;` are whitespace
    // the page wrote and a run of them should read as one space like any other.
    .replace(/\s+/g, " ")
    .trim();
}
