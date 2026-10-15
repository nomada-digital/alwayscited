import assert from "node:assert/strict";
import { test } from "node:test";

import { decodeEntities, stripNonProse, toProse } from "./prose.ts";

/**
 * Every case here is something that has actually gone wrong in this file or
 * its neighbours, or is the reason a line in it is written the way it is.
 *
 * It runs at all because prose.ts imports nothing. crawl.ts opens with
 * `import "server-only"` and cannot be loaded here, which is why this function
 * had never once been executed outside a live scan.
 */

test("an entity is decoded exactly once", () => {
  // The defect. `&amp;lt;` is how a page writes the literal text "&lt;", which
  // is what any page showing a code sample contains. The old sequential
  // replaces turned it into "<": the prose claimed a tag the page did not have.
  assert.equal(decodeEntities("&amp;lt;"), "&lt;");
  assert.equal(decodeEntities("&amp;gt;"), "&gt;");
  assert.equal(decodeEntities("&amp;amp;"), "&amp;");
  assert.equal(decodeEntities("&amp;quot;"), "&quot;");
  assert.equal(decodeEntities("&amp;#39;"), "&#39;");
});

test("the seven the old implementation knew still decode", () => {
  assert.equal(decodeEntities("a&amp;b"), "a&b");
  assert.equal(decodeEntities("&lt;div&gt;"), "<div>");
  assert.equal(decodeEntities("&quot;quoted&quot;"), '"quoted"');
  assert.equal(decodeEntities("it&#39;s"), "it's");
  assert.equal(decodeEntities("it&apos;s"), "it's");
  assert.equal(decodeEntities("a&nbsp;b"), "a b");
});

test("the punctuation a CMS emits reaches the model as characters", () => {
  // These survived as literal "&rsquo;" before, in the one string the brand
  // read is given to name the company from.
  assert.equal(decodeEntities("Smith&rsquo;s"), "Smith’s");
  assert.equal(decodeEntities("&ldquo;best&rdquo;"), "“best”");
  assert.equal(decodeEntities("2019&ndash;2024"), "2019–2024");
  assert.equal(decodeEntities("more&hellip;"), "more…");
  assert.equal(decodeEntities("&pound;2,495"), "£2,495");
  assert.equal(decodeEntities("Acme&trade;"), "Acme™");
});

test("accented letters, which is the market this crawls", () => {
  assert.equal(decodeEntities("Kitzb&uuml;hel"), "Kitzbühel");
  assert.equal(decodeEntities("Caf&eacute;"), "Café");
  assert.equal(decodeEntities("Fran&ccedil;ois"), "François");
  assert.equal(decodeEntities("&Oslash;rsted"), "Ørsted");
});

test("numeric entities, decimal and hex, are what covers the tail", () => {
  assert.equal(decodeEntities("Smith&#8217;s"), "Smith’s");
  assert.equal(decodeEntities("Smith&#x2019;s"), "Smith’s");
  assert.equal(decodeEntities("Smith&#X2019;s"), "Smith’s");
  assert.equal(decodeEntities("&#38;"), "&");
  assert.equal(decodeEntities("&#128512;"), "\u{1f600}");
});

test("a numeric entity in the C1 range means the windows-1252 character", () => {
  // Nothing legitimate lives at U+0080-U+009F. Every browser applies this, so a
  // page author testing in one cannot know they wrote something invalid.
  // Decoded literally these are control characters in the prompt.
  assert.equal(decodeEntities("Smith&#146;s"), "Smith’s");
  assert.equal(decodeEntities("&#147;best&#148;"), "“best”");
  assert.equal(decodeEntities("2019&#150;2024"), "2019–2024");
});

test("what is not an entity is left as the page wrote it", () => {
  // Dropping these would edit the page's own prose. AT&T is the ordinary case:
  // a bare ampersand is not an entity and is extremely common in a company name.
  assert.equal(decodeEntities("AT&T"), "AT&T");
  assert.equal(decodeEntities("Tom & Jerry"), "Tom & Jerry");
  assert.equal(decodeEntities("&notanentity;"), "&notanentity;");
  assert.equal(decodeEntities("100% & rising"), "100% & rising");
  assert.equal(decodeEntities("&amp"), "&amp");
  assert.equal(decodeEntities("&#;"), "&#;");
  // A surrogate half and a code point past the last plane are not characters.
  assert.equal(decodeEntities("&#xD800;"), "&#xD800;");
  assert.equal(decodeEntities("&#1114112;"), "&#1114112;");
  assert.equal(decodeEntities("&#0;"), "&#0;");
});

test("a name the entity table inherits is not an entity either", () => {
  // The table used to be an object literal read with NAMED[body], so every
  // name on Object.prototype answered. `?? raw` could not catch it, because a
  // function is not nullish: the prose handed to the brand read came back
  // carrying "function Object() { [native code] }" where the page had written
  // an entity we do not know. Same shape as the /scan?verify= crash.
  assert.equal(decodeEntities("&constructor;"), "&constructor;");
  assert.equal(decodeEntities("&toString;"), "&toString;");
  assert.equal(decodeEntities("&valueOf;"), "&valueOf;");
  assert.equal(decodeEntities("&hasOwnProperty;"), "&hasOwnProperty;");
  assert.equal(decodeEntities("&isPrototypeOf;"), "&isPrototypeOf;");
  assert.equal(
    toProse("<p>Read the &constructor; guide</p>"),
    "Read the &constructor; guide",
  );
});

test("tags come out before entities go in", () => {
  // The other half of the ordering. Decoding first would turn this page's own
  // escaped text into a tag, and the tag strip would then delete it along with
  // the prose after it - the page's text eating the page's text.
  assert.equal(toProse("<p>Use &lt;script&gt; carefully</p>"), "Use <script> carefully");
  assert.equal(toProse("<p>A &lt;b&gt; tag and more prose</p>"), "A <b> tag and more prose");
});

test("script, style, noscript, svg and comments carry nothing into the prose", () => {
  assert.equal(toProse("<script>var brand='Wrong Co'</script><p>Right Co</p>"), "Right Co");
  assert.equal(toProse("<style>.a{content:'Wrong Co'}</style><p>Right Co</p>"), "Right Co");
  assert.equal(toProse("<noscript>Wrong Co</noscript><p>Right Co</p>"), "Right Co");
  assert.equal(toProse("<svg><title>Wrong Co</title></svg><p>Right Co</p>"), "Right Co");
  assert.equal(toProse("<!-- Wrong Co --><p>Right Co</p>"), "Right Co");
  assert.equal(toProse("<SCRIPT>Wrong Co</SCRIPT><p>Right Co</p>"), "Right Co");
});

test("whitespace is collapsed after the decode, not before", () => {
  // A run of &nbsp; is whitespace the page wrote. Collapsing before the decode
  // left every one of them in the prose as a separate non-breaking space.
  assert.equal(toProse("<p>a&nbsp;&nbsp;&nbsp;b</p>"), "a b");
  assert.equal(toProse("<p>  spaced   out  </p>"), "spaced out");
  assert.equal(toProse("<p>line\n\nbreak</p>"), "line break");
});

test("a tag boundary is still a word boundary", () => {
  // Tags become a space rather than nothing, or two sentences in adjacent
  // elements join into one word that is in no dictionary and no company name.
  assert.equal(toProse("<li>Ski hire</li><li>Boot fitting</li>"), "Ski hire Boot fitting");
});

test("an empty or tag-only document is empty prose, not a crash", () => {
  // readSite tests `html === null` rather than falsiness precisely because ""
  // is a page that answered. This is the function that has to produce it.
  assert.equal(toProse(""), "");
  assert.equal(toProse("<html><head></head><body></body></html>"), "");
});

test("a block cut off before it closes carries nothing into the prose (15 Oct 2026)", () => {
  // The defect: the crawl's cut landed inside an open <style>, the pair
  // pattern needs the closing tag, and the CSS reached the brand read.
  assert.equal(toProse("<p>Right Co</p><style>.a{width:100%}.b{display:flex"), "Right Co");
  assert.equal(toProse("<p>Right Co</p><script>var a = 'Wrong Co'"), "Right Co");
  assert.equal(toProse("<p>Right Co</p><noscript>Wrong Co"), "Right Co");
  assert.equal(toProse("<p>Right Co</p><!-- Wrong Co"), "Right Co");
  // A closed block before an open one: only the open one runs to the end.
  assert.equal(toProse("<style>.x{}</style><p>Right Co</p><style>.y{"), "Right Co");
  // svg closes itself as often as not, so an unclosed one is not a cut.
  assert.equal(toProse('<svg viewBox="0 0 1 1"/><p>Right Co</p>'), "Right Co");
});

test("a page-builder homepage keeps its copy and its links once the CSS is stripped", () => {
  // The shape that found it: hundreds of KB of inline style and script ahead
  // of the title, the nav and every word of copy. Synthetic - no real domain
  // in a fixture.
  const css = "<style>" + ".a{width:100%;height:100%;display:block}".repeat(9_000) + "</style>";
  const js = "<script>" + "window.x=function(){return 1};".repeat(4_000) + "</script>";
  const page =
    "<html><head>" + css + js + css + "<title>Example Studio | Creative Agency</title></head>" +
    '<body><nav><a href="/aboutus">about us</a><a href="/services">services</a></nav>' +
    "<h1>We build brands and create entertainment</h1></body></html>";
  assert.ok(page.length > 600_000, "the page is the size that broke it");
  assert.ok(page.indexOf("<title>") > 200 * 1024, "the title sits past the old raw cap");

  const kept = stripNonProse(page);
  assert.ok(kept.length < 2_000, "what is kept is the page, not its CSS");
  assert.match(kept, /href="\/aboutus"/, "links survive the strip, so the crawl can follow them");
  assert.equal(
    toProse(page),
    "Example Studio | Creative Agency about us services We build brands and create entertainment",
  );
});
