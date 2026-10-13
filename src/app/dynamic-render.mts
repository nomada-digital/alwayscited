import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";


/**
 * Renders the routes `next build` does not prerender, so the sweeps can see
 * them.
 *
 * Every sweep in this tree walks `.next/server/app` for `*.html`. That set is
 * the *statically prerendered* pages, not the site: a route marked `ƒ` in the
 * build output has no file there at all. So `/blog` served the motion script
 * and `data-motion="on"` with zero motion classes for as long as it has
 * existed, and the motion census, the rows-inside-rows test, the tier-lockup
 * sweep and the href/h1/title/canonical/og sweeps all reported themselves
 * clear over a set that did not contain it. Every "all 22 pages" claim in the
 * worklog is true and narrower than it reads.
 *
 * The fix is not a list of dynamic routes typed here. That is this repo's own
 * defect species - a fixed rung against a list that can grow - and it would go
 * stale the first time somebody adds a route that reads `searchParams`. So the
 * unswept set is *derived*: every app page route in the build manifest that
 * did not get an `.html`. A new dynamic route joins the sweeps by existing.
 *
 * What still has to be declared is what a route needs in order to render at
 * all - a concrete value for a `[token]` segment, or the admission that it
 * needs a database this machine does not have. `STATES` holds that, and a
 * route missing from it is a hard failure rather than a silent omission.
 */

const ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..");
const BUILD = join(ROOT, ".next");
const PRERENDER = join(BUILD, "server", "app");

/** Where captured HTML lands. Inside `.next`, so it dies with the build. */
export const CAPTURE = join(BUILD, "dynamic");
export const CAPTURE_MANIFEST = join(CAPTURE, "captured.json");

export type Capture = {
  /** The URL rendered, which is also the label the sweeps report. */
  url: string;
  /** The app route it came from, as the build manifest names it. */
  route: string;
  status: number;
  /** The file under `CAPTURE`, or null when nothing renderable came back. */
  file: string | null;
  /** Why there is no file. Present only when `file` is null. */
  blocked?: string;
};

// ---------------------------------------------------------------- the set

/** `/about` -> `about.html`, `/` -> `index.html`. How Next names a prerender. */
function prerenderPath(route: string): string {
  const rel = route === "/" ? "index" : route.replace(/^\//, "");
  return join(PRERENDER, rel + ".html");
}

/**
 * Every page route in the build that has no prerendered HTML.
 *
 * Read from `app-path-routes-manifest.json` rather than by walking `src/app`,
 * because the manifest is what the build actually produced - a page excluded
 * by config would still be a file on disk.
 */
export function unsweptRoutes(): string[] {
  const manifest = JSON.parse(
    readFileSync(join(BUILD, "app-path-routes-manifest.json"), "utf8"),
  ) as Record<string, string>;

  return Object.entries(manifest)
    .filter(([key]) => key.endsWith("/page"))
    .map(([, route]) => route)
    // An API route renders no HTML and is not a page. `/page` already excludes
    // them (they end `/route`), but say so rather than lean on it.
    .filter((route) => !route.startsWith("/api/"))
    .filter((route) => !existsSync(prerenderPath(route)))
    .sort();
}

// ------------------------------------------------------------- the states

/**
 * What each dynamic route needs in order to render, and what to do when it
 * cannot.
 *
 * `urls` is the list of distinct rendered states worth sweeping - a route that
 * branches on `searchParams` is more than one page. An empty `urls` with a
 * `blocked` reason is a route this machine genuinely cannot render; it is
 * recorded in the manifest so it stays *visible* as a gap rather than being
 * quietly absent, which is how this whole class of blindness started.
 *
 * Deliberately not here: writing a 404 or a 401 body out as if it were the
 * page. A sweep walking `_not-found` markup under the name `/scan/[token]`
 * would report that route cleared while having read nothing of it - the same
 * false clear, one layer down.
 *
 * `discover` reads more states off the page once it has rendered. The filter
 * pills on `/blog` are one per post kind, so a new kind is a new state of that
 * page - and a list of kinds typed here would go stale the day somebody adds
 * one. Reading the rendered pills instead means the set follows the site.
 * Importing `config/posts.ts` was the obvious alternative and does not work:
 * it reaches for `@/config/og`, and bare node has no path alias.
 */
export type State = {
  urls: string[];
  discover?: (html: string) => string[];
  blocked?: string;
};

/** Every distinct `?kind=` the rendered filter pills link to. */
function blogKindStates(html: string): string[] {
  const found = new Set<string>();
  for (const [, href] of html.matchAll(/href="(\/blog\?kind=[^"&]*)"/g)) {
    found.add(href.replace(/&amp;/g, "&"));
  }
  return [...found];
}

export const STATES: Record<string, State> = {
  // The writing index. `kind` filters it; an unknown kind falls back to the
  // unfiltered list, so that state is swept too.
  "/blog": {
    urls: ["/blog", "/blog?kind=nonsense"],
    discover: blogKindStates,
  },

  // The funnel's entry point, and the largest single thing that was unswept.
  // `verify` is the notice a broken verification link lands on; both branches
  // of the Map are states of this page and neither had ever been rendered
  // anywhere a sweep could read it. `constructor` is here because a previous
  // object-literal lookup answered 500 to it.
  "/scan": {
    urls: ["/scan", "/scan?domain=example.com", "/scan?verify=failed", "/scan?verify=invalid", "/scan?verify=constructor"],
  },

  "/scan/[token]": {
    urls: [],
    blocked:
      "needs a scans row: without a database the route 404s, and the not-found page is already swept under its own name",
  },
  // 4 Oct 2026: case studies published from the Nomada agency hub, read from
  // its feed (lib/case-studies.ts). None published yet, so the route has no
  // URL to render; once one is live it is prerendered and swept as a page.
  "/case-studies/[id]": {
    urls: [],
    blocked: "renders only a study published on the agency hub; with none published it 404s, and the not-found page is swept under its own name",
  },
  "/coverage-check/[token]": {
    urls: [],
    blocked: "needs a campaign row and its token; 404s without a database",
  },
  "/admin/scans": {
    urls: [],
    blocked: "behind auth - answers 401 with 24 bytes and no HTML at all, and a credential is not ours to hold",
  },
  // 29 Sep 2026, T3: the client dashboard. The two pages a stranger reaches
  // render here; the two behind a session cannot.
  "/app/login": { urls: ["/app/login", "/app/login?link=expired"] },
  // 29 Sep 2026, R91: the order form. Tracked, a placements tier before a
  // sector is picked, one priced with an error back from the route, and one
  // past ten clusters (a call). No database and no Stripe call either way.
  "/checkout": {
    urls: [
      "/checkout?tier=alwaystracked",
      "/checkout?tier=alwaysmentioned",
      "/checkout?tier=alwayscited&sector=technology&clusters=3&market=uk&error=keyword",
      "/checkout?tier=alwaysmentioned&sector=technology&clusters=11",
    ],
  },
  // Stripe's success URL; the Session id is not read, so a made-up one renders the same page.
  // 1 Oct 2026, R148 pass 8: plan and from=scan pick the copy, so the from-scan state renders too.
  "/checkout/done": { urls: ["/checkout/done", "/checkout/done?session=cs_placeholder", "/checkout/done?session=cs_placeholder&plan=tracked&from=scan"] },
  "/app/auth": {
    urls: ["/app/auth", "/app/auth?token=0000000000000000000000000000000000000000000000000000000000000000"],
  },
  // With no session it redirects to /app/login, which the capture follows.
  "/app": { urls: ["/app"] },
  // Same: with no session a client slug redirects to /app/login. The signed-in
  // render needs a session cookie and a client row, which the capture has not.
  "/app/[client]": { urls: ["/app/example"] },
  // 30 Sep 2026, T6 part 1: the Clusters page, same session rule as the overview.
  "/app/[client]/clusters": { urls: ["/app/example/clusters"] },
  // 30 Sep 2026, T7 part 2b: one cluster, same session rule.
  "/app/[client]/clusters/[cluster]": { urls: ["/app/example/clusters/c1", "/app/example/clusters/c1?prompt=1"] },
  // 30 Sep 2026, R97 part 3 (T13): the placements screen, same session rule.
  "/app/[client]/placements": { urls: ["/app/example/placements", "/app/example/placements?cluster=c1"] },
  // 1 Oct 2026, R142 (BRIEF-4 P2): Settings, same session rule.
  "/app/[client]/settings": { urls: ["/app/example/settings"] },
  // 1 Oct 2026, R166 part 3b: a new client's setup page, same session rule.
  "/app/[client]/setup": { urls: ["/app/example/setup", "/app/example/setup?confirm=failed"] },
  // 1 Oct 2026, R143 (BRIEF-4 P3): Who is named, same session rule.
  "/app/[client]/named": { urls: ["/app/example/named", "/app/example/named?engine=chatgpt&all=1"] },
  // 1 Oct 2026, R144 (BRIEF-4 P4): Cited pages, same session rule.
  "/app/[client]/cited": { urls: ["/app/example/cited", "/app/example/cited?kind=others&all=1"] },
  // 1 Oct 2026, R145 (BRIEF-4 P5): Reports, same session rule.
  "/app/[client]/reports": { urls: ["/app/example/reports", "/app/example/reports?from=2026-08-01&to=2026-08-31"] },
  // 13 Oct 2026, DIY P4 (spec 10 section 3.3): AI visibility, same session rule. Its signed-in states are swept from
  // the HTML e2e/app/diy-results.spec.mts saves (section 6.10 item 2).
  "/app/[client]/ai": { urls: ["/app/example/ai", "/app/example/ai?missing=1&eng=chatgpt"] },
  // 2 Oct 2026, R173 pass 3, DS36: any address no /app/[client] page matches, same session rule.
  "/app/[client]/[...rest]": { urls: ["/app/example/nope"] },
  // 13 Oct 2026, DIY P3: Actions (internally the Plan), same session rule. The signed-in page is swept from
  // the HTML e2e/app/diy-plan.spec.mts saves (spec 10 section 6.10 item 2).
  "/app/[client]/plan": { urls: ["/app/example/plan", "/app/example/plan?view=list&status=done"] },
  // 13 Oct 2026, DIY P6: Google (tracked keywords, gaining ground, the footprint), same session rule. Its signed-in
  // states are swept from the HTML e2e/app/diy-google.spec.mts saves (spec 10 section 6.10 item 2).
  "/app/[client]/google": { urls: ["/app/example/google", "/app/example/google?view=all&intent=commercial"] },
  // 29 Sep 2026, T4: the overview drawn from the local parity fixture - the
  // only way the sweeps see the signed-in overview's markup at all. A 404 in
  // a checkout that has not run docs/parity/T4/make-fixture.py.
  "/app/parity": { urls: ["/app/parity"] },
  // 29 Sep 2026, T2: the same /admin Basic auth as /admin/scans.
  "/admin/tracking": {
    urls: [],
    blocked: "behind auth - answers 401 with 24 bytes and no HTML at all, and a credential is not ours to hold",
  },
  // 30 Sep 2026, R96 part 3: the placements log, same /admin Basic auth.
  "/admin/tracking/[client]/placements": {
    urls: [],
    blocked: "behind auth - answers 401 with 24 bytes and no HTML at all, and a credential is not ours to hold",
  },
  // 30 Sep 2026, R98 T10: weekly dashboard usage counts, same /admin Basic auth.
  "/admin/tracking/usage": {
    urls: [],
    blocked: "behind auth - answers 401 with 24 bytes and no HTML at all, and a credential is not ours to hold",
  },
  // 1 Oct 2026, R152: the funnel counts, same /admin Basic auth.
  "/admin/funnel": {
    urls: [],
    blocked: "behind auth - answers 401 with 24 bytes and no HTML at all, and a credential is not ours to hold",
  },
  // 1 Oct 2026, R159 part 2: the lifecycle email previews, same /admin Basic auth.
  "/admin/emails": {
    urls: [],
    blocked: "behind auth - answers 401 with 24 bytes and no HTML at all, and a credential is not ours to hold",
  },
};

// ------------------------------------------------------------ the capture

function fileFor(url: string): string {
  // One file per state, named so a human reading the directory can tell which
  // is which. Any character that is not safe in a filename becomes `_`.
  const slug = url.replace(/^\//, "").replace(/[^a-zA-Z0-9._-]+/g, "_") || "index";
  return slug + ".html";
}

export async function capture(port = 4311): Promise<Capture[]> {
  const unswept = unsweptRoutes();

  const undeclared = unswept.filter((route) => !(route in STATES));
  if (undeclared.length) {
    throw new Error(
      `These routes are dynamic and nothing says how to render them: ${undeclared.join(", ")}.\n` +
        `Add each to STATES in src/app/dynamic-render.mts - either the URLs that render it, or an ` +
        `empty list and the reason it cannot be rendered here. A dynamic route with no entry is ` +
        `invisible to every sweep in this tree, which is the defect this file exists to close.`,
    );
  }

  const { default: next } = await import("next");
  const app = next({ dev: false, dir: ROOT });
  await app.prepare();
  const handle = app.getRequestHandler();

  const server = createServer((req, res) => handle(req, res));
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", () => resolve()));

  rmSync(CAPTURE, { recursive: true, force: true });
  mkdirSync(CAPTURE, { recursive: true });

  const captured: Capture[] = [];
  try {
    for (const route of unswept) {
      const { urls, blocked, discover } = STATES[route]!;

      if (!urls.length) {
        // Rendered anyway, so the claim in `blocked` is measured rather than
        // remembered. A route that starts answering 200 has become sweepable
        // and must not stay on this list.
        const res = await fetch(`http://127.0.0.1:${port}${route.replace(/\[[^\]]+\]/g, "probe")}`);
        await res.text();
        if (res.status === 200) {
          throw new Error(
            `${route} is recorded as unrenderable ("${blocked}") but answered 200. It can be swept ` +
              `now - give it real URLs in STATES.`,
          );
        }
        captured.push({ url: route, route, status: res.status, file: null, blocked });
        continue;
      }

      // A queue rather than a loop over `urls`, so a state `discover` finds in
      // the markup is rendered on the same pass.
      const queue = [...urls];
      const seen = new Set<string>();
      let discovered = false;

      while (queue.length) {
        const url = queue.shift()!;
        if (seen.has(url)) continue;
        seen.add(url);

        const res = await fetch("http://127.0.0.1:" + port + url);
        const html = await res.text();
        if (res.status !== 200) {
          throw new Error(
            `${url} answered ${res.status}. A declared state of a shipped route must render; ` +
              `either fix the route or move it to a blocked entry with the reason.`,
          );
        }

        // Only off the first state. The pills are the same on every one of
        // them, and re-reading them each time only re-walks what `seen` drops.
        if (!discovered && discover) {
          discovered = true;
          queue.push(...discover(html));
        }

        const file = fileFor(url);
        writeFileSync(join(CAPTURE, file), html, "utf8");
        captured.push({ url, route, status: res.status, file });
      }
    }
  } finally {
    server.close();
    await app.close?.();
  }

  writeFileSync(CAPTURE_MANIFEST, JSON.stringify(captured, null, 2) + "\n", "utf8");
  return captured;
}

// -------------------------------------------------------------- the reader

export type Page = { page: string; html: string };

/** The prerendered pages, exactly as every sweep here has always read them. */
export function prerenderedPages(): Page[] {
  const out: Page[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".html")) {
        out.push({ page: relative(PRERENDER, full).split(sep).join("/"), html: readFileSync(full, "utf8") });
      }
    }
  };
  walk(PRERENDER);
  return out;
}

/** The captured dynamic states, labelled by URL so a failure names the state. */
export function capturedPages(): Page[] {
  if (!existsSync(CAPTURE_MANIFEST)) return [];
  const manifest = JSON.parse(readFileSync(CAPTURE_MANIFEST, "utf8")) as Capture[];
  return manifest
    .filter((c) => c.file)
    .map((c) => ({ page: c.url, html: readFileSync(join(CAPTURE, c.file!), "utf8") }));
}

/**
 * Every page a sweep should read: the prerender plus whatever `capture()` got.
 *
 * Callers check `existsSync(PRERENDER)` and skip when there is no build. They
 * do NOT skip on a missing capture - an absent capture silently narrows the
 * sweep back to where it started, so `dynamic-render.test.mts` fails on it
 * instead, in one place, with the command to fix it.
 */
export function sweptPages(): Page[] {
  return [...prerenderedPages(), ...capturedPages()];
}

/**
 * The HTML body, without the flight payload.
 *
 * A prerender is two documents and one of them lies about `$`: flight escapes
 * a leading `$` by prefixing another, so `$995/mo` appears there as
 * `$$995/mo`. This reads the body.
 */
export function bodyOf(html: string): string {
  const cut = html.indexOf("<script>self.__next_f");
  return cut === -1 ? html : html.slice(0, cut);
}

/**
 * A page as a reader sees it: tags stripped to nothing, scripts dropped whole.
 *
 * Lives here rather than beside the first sweep that needed it because it was
 * about to have a second copy, and two copies of one function is the species
 * this tree keeps paying for - the date formatter existed twice and the
 * untested copy was the one missing a guard. Three facts are baked in, each of
 * which cost a missed injection in `price-surfaces.test.mts` before it was
 * written down:
 *
 * - **Stripped to nothing, not to a space.** A price is three elements -
 *   `<span>from </span>$99<span>/mo</span>` - because the board sets the
 *   qualifiers smaller than the figure, so a strip emitting a space per element
 *   reads "from $99/mo" as "from $99 /mo". The same fact makes `TierName` read
 *   as two words, which cost `structured-data.test.mts` a false positive: the
 *   lockup sets the accent half in a nested span, so a strip that spaces
 *   elements apart splits a tier name into its stem and its accent and no
 *   sweep looking for the word can find it.
 * - **Scripts go entirely.** The JSON-LD carries the price and the tier names
 *   too, in one contiguous string, inside a `<script>` in the body. Stripping
 *   tags but keeping their contents lets the structured data answer for the
 *   visible card - so a claim could vanish off the page a buyer reads and a
 *   sweep would still pass, off the copy an engine reads.
 * - **Comments go before the tags do.** A JSX comment survives into the markup
 *   as `<!-- -->`, and React separates adjacent text nodes with one, so a
 *   sentence built by interpolation arrives split. Stripping comments after
 *   tags leaves the `--` behind in the text.
 */
export function pageText(html: string): string {
  return bodyOf(html)
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]*>/g, "");
}

/**
 * A page as a reader sees it, one BLOCK at a time.
 *
 * `pageText` strips tags to nothing, which it must - a price is three inline
 * spans and a tier name is two - and the documented cost is that block
 * boundaries collapse with them: two adjacent paragraphs arrive as "...on the
 * page.How it works...". Sweeps have so far paid that cost by splitting the
 * result on sentence punctuation, which works only while the copy has
 * punctuation. **A list does not.** `/compare`'s table and `/alwaystracked`'s
 * includes list carry no full stop until the paragraph after them, so the whole
 * table arrives as one run - and a run that long pairs any two words on the
 * page with each other. A rule asking whether one sentence says two things
 * therefore fires on a page where the two things are eleven rows apart. That is
 * the flattering direction's opposite and it is just as useless: three false
 * positives on true copy, each of which would have wanted its own exemption.
 *
 * So this splits on closing block tags FIRST, then strips what is left of each
 * fragment to nothing. Both properties survive - inline elements inside a
 * block still close up, blocks no longer run together - and it is the
 * granularity a "does one sentence claim both of these" rule actually wants.
 *
 * Lives here rather than beside the first sweep that needed it for the reason
 * `pageText` does: it was about to be a second copy of the same three facts.
 */
export function blocksOf(html: string): string[] {
  return bodyOf(html)
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    /** Block elements only. `</a>`, `</label>` and `</button>` are deliberately
     *  absent even though this site styles several anchors as cards: an inline
     *  link inside a claim would split the claim in two, and a rule blind to
     *  half a sentence is a worse failure than one that reads a card twice. */
    .split(/<\/(?:p|div|li|h[1-6]|td|th|tr|section|main|header|footer|figcaption|blockquote|ul|ol|dt|dd)>/i)
    .flatMap((fragment) =>
      fragment
        .replace(/<[^>]*>/g, "")
        .replace(/\s+/g, " ")
        .split(/(?<=[.?!])\s+|(?<=[.?!])(?=[A-Z])/),
    )
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * The copy in the HEAD: title, description, and every OG and Twitter string.
 *
 * **Every claim sweep on this site reads `pageText`, and `pageText` drops the
 * head by construction** - it strips whole tags, and a meta description lives
 * in an attribute. So the one piece of copy a reader sees *before* the page was
 * outside the denominator of every rule written to police what the pages say.
 *
 * That is measured rather than reasoned about. A meta description carrying
 * "Every price is published, from tracking alone up to alwayseverywhere" and
 * "White-labelled throughout." - two sentences those sweeps exist to forbid,
 * both of which have actually shipped on this site in body copy - was injected
 * into `compare.html`'s head on 20 Sep and `price-claims.test.mts` and
 * `white-label-claims.test.mts` both passed over it.
 *
 * (`privacy-claims.test.mts` reads source, SQL and the CSP rather than rendered
 * pages, so it never had this hole. It was in the first draft of that finding
 * and it was wrong - a sweep that does not read pages cannot be blind to part
 * of one.)
 *
 * Image alts are included: AGENTS.md governs the tier names in alt text, so an
 * alt is copy in the sense that matters here. `og:url` and the image
 * dimensions are not - they are addresses and numbers, and `page-head` already
 * owns them.
 */
export function headClaims(html: string): string[] {
  const end = html.indexOf("</head>");
  const head = end === -1 ? html : html.slice(0, end);
  const out: string[] = [];
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head);
  if (title) out.push(title[1]!);
  const re =
    /<meta\s+(?:name|property)="(?:description|og:title|og:description|og:image:alt|twitter:title|twitter:description|twitter:image:alt)"\s+content="([^"]*)"/gi;
  for (const m of head.matchAll(re)) out.push(m[1]!);
  return out.map(decodeEntities).map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
}

/**
 * The copy in the STRUCTURED DATA: every prose string a `ld+json` block
 * publishes.
 *
 * `headClaims` exists because `pageText` drops the head by construction. This
 * exists for the layer out from that, and the construction is even plainer:
 * `pageText` and `blocksOf` both open with
 *
 *     .replace(/<script[\s\S]*?<\/script>/g, "")
 *
 * so **no claim sweep on this site has ever read a line of its own structured
 * data**. That cut is right and must stay - `price-surfaces.test.mts` records
 * why, because schema carries the same claim in one contiguous run and would
 * otherwise satisfy a requirement rule on behalf of a card that has stopped
 * printing the number. The fix is not to stop dropping scripts. It is to hand
 * the dropped strings to the rules that forbid things, separately.
 *
 * **Prohibitions only**, for the reason written beside `headClaims`' use: a
 * requirement satisfied by chrome can never fire, and every page carries the
 * same Organization node. Widening a prohibition is safe because a false claim
 * in a schema block is still a false claim - and on this site it is the worse
 * one, since JSON-LD is the surface an answer engine reads and answer engines
 * are what this product is about.
 *
 * What is included is prose only. `@type`, `@id`, `@context`, anything that
 * parses as a URL, and the short enum-like values are addresses and vocabulary
 * rather than copy; `structured-data.test.mts` and `page-head.test.mts` own
 * those. Numbers are excluded here too - `price-schema.test.mts` reads the
 * offer figures against `pricing.ts`, which is a stronger check than any
 * pattern over their text would be.
 */
export function schemaClaims(html: string): string[] {
  const out: string[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (typeof value !== "string") {
        visit(value);
        continue;
      }
      if (key.startsWith("@")) continue;
      if (/^https?:\/\/|^#|^mailto:/.test(value)) continue;
      if (value.length < 12) continue;
      out.push(value);
    }
  };
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      visit(JSON.parse(m[1]!));
    } catch {
      // A block that does not parse is `structured-data.test.mts`'s finding,
      // and it asserts exactly that. Throwing here would report one defect
      // twice, from a rule that is not about it - and an exception thrown by
      // a test is not a caught defect.
    }
  }
  return out.map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
}

/** Attribute values arrive escaped - React writes an apostrophe as `&#x27;`,
 *  which splits "client's" into two tokens and would let an entity hide a word
 *  a rule is looking for. The five named entities plus numeric escapes are the
 *  whole set React emits into an attribute.
 *
 *  Exported because the escaping is asymmetric across the two machine-readable
 *  surfaces and that asymmetry has already produced a false reading here: a
 *  head attribute is entity-escaped and a JSON-LD string is not, so comparing
 *  the two raw reports `og:description` and a schema `description` as different
 *  when the source types one literal. This is the existing cut rather than a
 *  new one - a stripper that differs in one case blinds the sweep that trusted
 *  it, which is why the private copies elsewhere stay private and this one is
 *  shared instead of retyped. */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export const BUILD_DIR = BUILD;
export const PRERENDER_DIR = PRERENDER;

// Run as a script: `node src/app/dynamic-render.mts`.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const captured = await capture();
  for (const c of captured) {
    console.log(
      c.file
        ? `  rendered  ${c.url}  ->  ${c.file}`
        : `  BLOCKED   ${c.url}  (${c.status})  ${c.blocked}`,
    );
  }
  const n = captured.filter((c) => c.file).length;
  console.log(`\n${n} dynamic states captured, ${captured.length - n} route(s) blocked.`);
  process.exit(0);
}
