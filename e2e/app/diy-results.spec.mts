/**
 * DIY P4 (13 Oct 2026; spec 10 section 7.5): the rebuilt Overview and the AI
 * visibility page, on the tracking fixture, signed in.
 *
 *   npm run build && node --test e2e/app/diy-results.spec.mts
 *
 * One `next start` per fixture state, each on its own port (3631-3634), so
 * the states run side by side; VERCEL_ENV=development is set, never left to a
 * pulled .env.local. Playwright from ~/code/.parity, axe from the repo's own
 * axe-core, as the other e2e/app specs.
 *
 * It holds: the headline's variant text, the What it means bullets and the
 * Since last check lines with every link resolving; the "Download CSV" label;
 * /ai in its default view, the missing lens, ChatGPT like-for-like, and before
 * the first check; every evidence link opening an answer within three
 * clicks; axe with no serious or critical finding; no sideways scroll at 390
 * and 320; JS off; and the writes the pages carry (the upgrade prompt's
 * hide and ask) with JS off. It saves each page's screen at 1280x900 and 390x844 and
 * its HTML to test-results/diy/p4/, for the builder to look at and the gating
 * census to sweep (section 6.10 item 2).
 *
 * Review of P4 (13 Oct 2026): U1's Hide and Ask now come back to /ai, on the
 * view they were posted from (they landed on Clusters, and this spec asserted
 * it); a grouped change line opens its prompts and one of them its answer
 * panel, followed to the `#answer-` section rather than to any page; the
 * headline's answer count opens /ai; and the "Prompts you are named in"
 * figure's link opens a lens whose count it states.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const require = createRequire(path.join(os.homedir(), "code/.parity/package.json"));
const AXE = readFileSync(path.join(ROOT, "node_modules", "axe-core", "axe.min.js"), "utf8");
const OUT = path.join(ROOT, "test-results", "diy", "p4");
const HOME = "/app/tallyroo";

type Locator = { count(): Promise<number>; first(): Locator; nth(i: number): Locator; click(): Promise<void>; getAttribute(n: string): Promise<string | null>; innerText(): Promise<string> };
type Page = {
  goto(url: string, o?: object): Promise<{ status(): number } | null>;
  url(): string;
  content(): Promise<string>;
  evaluate<R>(fn: () => R | Promise<R>): Promise<R>;
  evaluate<R, A>(fn: (a: A) => R | Promise<R>, a: A): Promise<R>;
  addScriptTag(o: { content: string }): Promise<unknown>;
  locator(sel: string): Locator;
  screenshot(o: { path: string; fullPage?: boolean }): Promise<unknown>;
  waitForURL(url: RegExp, o?: object): Promise<void>;
  waitForFunction<A>(fn: (a: A) => unknown, a?: A, o?: object): Promise<unknown>;
};
type Context = { newPage(): Promise<Page>; close(): Promise<void> };
type Browser = { newContext(o: object): Promise<Context>; close(): Promise<void> };
const { chromium } = require("playwright") as { chromium: { launch(): Promise<Browser> } };

const STATES = { default: 3631, new: 3632, partial: 3633 } as const;
type State = keyof typeof STATES;
const servers: ChildProcess[] = [];
// localhost, not 127.0.0.1: the routes' 303s are built for the request's host (app-redirect.ts dashUrl), which says localhost.
const base = (s: State) => `http://localhost:${STATES[s]}`;
let browser: Browser;

async function up(state: State): Promise<void> {
  const child = spawn(process.execPath, [path.join(ROOT, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(STATES[state])], {
    cwd: ROOT,
    env: { ...process.env, TRACKING_FIXTURE: "1", TRACKING_FIXTURE_STATE: state, VERCEL_ENV: "development", NODE_ENV: "production" },
    stdio: "ignore",
  });
  servers.push(child);
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${base(state)}/app/login`)).status === 200) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`the ${state} fixture server did not start on ${STATES[state]}`);
}

before(async () => {
  mkdirSync(OUT, { recursive: true });
  await Promise.all((Object.keys(STATES) as State[]).map(up));
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  for (const s of servers) s.kill();
});

async function open(state: State, url: string, o: { width?: number; height?: number; js?: boolean } = {}) {
  const ctx = await browser.newContext({ viewport: { width: o.width ?? 1280, height: o.height ?? 900 }, javaScriptEnabled: o.js ?? true, ...(o.width && o.width < 600 ? { isMobile: true, hasTouch: true } : {}) });
  const page = await ctx.newPage();
  const res = await page.goto(`${base(state)}${url}`, { waitUntil: "networkidle", timeout: 120_000 });
  return { ctx, page, status: res?.status() ?? 0 };
}

const text = (page: Page, sel: string) => page.evaluate((s) => [...document.querySelectorAll(s)].map((e) => (e.textContent ?? "").replace(/\s+/g, " ").trim()), sel);
const hrefs = (page: Page, sel: string) => page.evaluate((s) => [...document.querySelectorAll<HTMLAnchorElement>(s)].map((a) => a.getAttribute("href") ?? ""), sel);

/** Every link resolves: a 200 on the same server, with the answer panel it names when it names one. */
async function resolves(state: State, links: string[]) {
  assert.ok(links.length, "no links to follow");
  for (const href of links) {
    const url = new URL(href, `${base(state)}${HOME}`);
    const res = await fetch(url, { redirect: "manual" });
    assert.equal(res.status, 200, `${href} answered ${res.status}`);
    if (url.hash.startsWith("#answer-")) assert.ok((await res.text()).includes(`id="${url.hash.slice(1)}"`), `${href}: no answer panel with that anchor`);
  }
}

async function axe(page: Page): Promise<string[]> {
  await page.addScriptTag({ content: AXE });
  return page.evaluate(async () => {
    // @ts-expect-error injected
    const r = await window.axe.run(document, { resultTypes: ["violations"] });
    return (r.violations as { id: string; impact: string; nodes: { target: string[] }[] }[])
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => `${v.impact} ${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(", ")}`);
  });
}

/** The page's screen at 1280 and 390, and its HTML once, for the census and for a person to look at. */
async function shoot(state: State, url: string, name: string) {
  for (const [w, h] of [
    [1280, 900],
    [390, 844],
  ] as const) {
    const { ctx, page } = await open(state, url, { width: w, height: h });
    await page.screenshot({ path: path.join(OUT, `${name}-${w}.png`), fullPage: true });
    if (w === 1280) writeFileSync(path.join(OUT, `${name}.html`), await page.content(), "utf8");
    await ctx.close();
  }
}

describe("the Overview", () => {
  test("default: the compared headline, three bullets, Since last check with links that resolve, Download CSV", async () => {
    const { ctx, page, status } = await open("default", HOME);
    assert.equal(status, 200);
    const [head] = await text(page, '[data-headline="compared"]');
    assert.match(head ?? "", /^Named in [\d,]+ of [\d,]+ AI answers to your \d+ prompts in the last 28 days \(\d+%\)[.,] .*(up from|down from|the same as) \d+% in the 28 days before\. \d+ of \d+ cluster keywords (is|are) on Google's page 1/);
    // The answer count is a link to every prompt behind it (DB-2).
    const count = await page.evaluate(() => {
      const a = document.querySelector<HTMLAnchorElement>("[data-headline] a[data-headline-count]");
      return a ? { text: (a.textContent ?? "").trim(), href: a.getAttribute("href") ?? "" } : null;
    });
    assert.ok(count && /^[\d,]+ of [\d,]+ AI answers$/.test(count.text), JSON.stringify(count));
    assert.match(count!.href, /\/app\/tallyroo\/ai\?from=/);
    await resolves("default", [count!.href]);
    const bullets = await page.evaluate(() => [...document.querySelectorAll("[data-meaning] li")].map((li) => li.getAttribute("data-kind")));
    assert.deepEqual(bullets, ["engines", "google", "change"]);
    assert.match((await text(page, '[data-meaning] li[data-kind="engines"]'))[0]!, /names you in the (most answers|largest share of its answers) \([\d,]+ of [\d,]+\); .+ in the (fewest|smallest) \([\d,]+ of [\d,]+\)\.$/);
    assert.match((await text(page, '[data-meaning] li[data-kind="google"]'))[0]!, /^Closest to page 1: '.+' at \d+(st|nd|rd|th)\.$/);
    assert.match((await text(page, '[data-meaning] li[data-kind="change"]'))[0]!, /^'.+': named in \d+ answers?, was \d+, same prompts\.$/);
    // Lines are the list's own items; a grouped line's prompts are a list inside it.
    const since = await text(page, "[data-since] > li");
    assert.ok(since.length >= 1 && since.length <= 8, `${since.length} lines`);
    for (const l of since) assert.doesNotMatch(l, /\b(caused|drove|because of|thanks to|resulted in|delivered|in your place)\b/i);
    // A grouped line ("Gemini stopped naming you for 8 prompts.") carries its prompts, each a link to its answer panel.
    const grouped = await page.evaluate(() =>
      [...document.querySelectorAll("[data-since] > li")]
        .filter((li) => li.querySelector("[data-since-items]"))
        .map((li) => ({ n: Number(/for (\d+) prompts\.$/.exec((li.firstElementChild?.nextElementSibling?.firstElementChild?.textContent ?? "").trim())?.[1] ?? -1), links: [...li.querySelectorAll<HTMLAnchorElement>("[data-since-items] a")].map((a) => a.getAttribute("href") ?? "") })),
    );
    for (const g of grouped) {
      assert.equal(g.links.length, g.n, "a grouped line lists every prompt it counts");
      for (const h of g.links) assert.match(h, /\/clusters\/c\d+\?.*day=\d{4}-\d{2}-\d{2}.*engine=\w+#answer-\w+$/, h);
    }
    // And no line links to a whole engine on /ai, which cannot show which prompts changed.
    assert.ok(!(await hrefs(page, "[data-since] a")).some((h) => /\/ai\?.*eng=/.test(h)), "a change line links to /ai?eng=");
    await resolves("default", [...(await hrefs(page, "[data-since] a")), ...(await hrefs(page, "[data-meaning] a"))]);
    const body = await page.evaluate(() => document.body.innerText);
    assert.match(body, /Download CSV/);
    assert.doesNotMatch(body, /Download report/);
    assert.deepEqual(await axe(page), []);
    await ctx.close();
    await shoot("default", HOME, "overview-default");
  });

  test("new: before the first check - the pending headline, no change list, no CSV", async () => {
    const { ctx, page, status } = await open("new", HOME);
    assert.equal(status, 200);
    const body = await page.evaluate(() => document.body.innerText);
    assert.match(body, /Your first check runs tomorrow at /);
    assert.doesNotMatch(body, /Since last check|Download CSV/);
    assert.deepEqual(await axe(page), []);
    await ctx.close();
    await shoot("new", HOME, "overview-new");
  });

  test("partial: the change list opens on the partial check, and a missing read is never a change", async () => {
    const { ctx, page } = await open("partial", HOME);
    const since = await page.evaluate(() => [...document.querySelectorAll("[data-since] > li")].map((li) => ({ kind: li.getAttribute("data-kind"), text: (li.textContent ?? "").trim() })));
    assert.equal(since[0]?.kind, "check");
    assert.match(since[0]!.text, /^Your check on 29 Sep was partial: Google AI Overviews did not answer \d+ prompts\.$/);
    // Today's Google AI Overviews reads failed: none of them is read as a change, so no line's evidence is one of them.
    const links = await hrefs(page, "[data-since] a");
    assert.ok(!links.some((h) => h.includes("day=2026-09-29") && h.includes("engine=google_aio")), "a failed read was read as a change");
    assert.ok(await page.evaluate(() => !!document.querySelector('[data-headline="compared"]')), "the headline still reads");
    await resolves("partial", await hrefs(page, "[data-since] a"));
    assert.deepEqual(await axe(page), []);
    await ctx.close();
    await shoot("partial", HOME, "overview-partial");
  });

  test("JS off: the headline, bullets and change list are the server's", async () => {
    const { ctx, page } = await open("default", HOME, { js: false });
    assert.ok((await text(page, '[data-headline="compared"]'))[0]);
    // Drawn, not only in the document: a streamed page sits in a hidden div until script swaps it in.
    assert.ok(await page.evaluate(() => (document.querySelector("[data-since]")?.getBoundingClientRect().height ?? 0) > 0), "the change list is not drawn with JS off");
    assert.equal((await text(page, "[data-meaning] li")).length, 3);
    assert.ok((await text(page, "[data-since] > li")).length >= 1);
    await ctx.close();
  });

  test("no sideways scroll at 390 and 320", async () => {
    for (const state of ["default", "partial", "new"] as const) {
      for (const width of [390, 320]) {
        const { ctx, page } = await open(state, HOME, { width, height: 844 });
        const w = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: innerWidth }));
        assert.ok(w.scroll <= w.inner, `${state} at ${width}: ${w.scroll} wide`);
        await ctx.close();
      }
    }
  });
});

describe("AI visibility", () => {
  test("a slug the member is not on is a 404, before anything streams", async () => {
    const res = await fetch(`${base("default")}/app/nope/ai`, { redirect: "manual" });
    assert.equal(res.status, 404);
  });

  test("default: four figures, the chart, the table, the heat map and how it was measured; rows open their answers", async () => {
    const { ctx, page, status } = await open("default", `${HOME}/ai`);
    assert.equal(status, 200);
    const figs = await page.evaluate(() => [...document.querySelectorAll("[data-figure^='ai-']")].map((e) => e.getAttribute("data-figure")));
    assert.deepEqual(figs, ["ai-named", "ai-prompts", "ai-engine", "ai-cited"]);
    assert.match((await text(page, "#ai-prompts-h"))[0]!, /^\d+ prompts$/);
    const rows = await page.evaluate(() => document.querySelectorAll("[data-prompt]").length);
    assert.ok(rows >= 40 && rows <= 100, `${rows} rows`);
    assert.ok(await page.evaluate(() => !!document.querySelector("#ai-chart svg")), "no chart");
    assert.ok(await page.evaluate(() => !!document.querySelector('[aria-label="Daily checks by cluster"]')), "no heat map");
    // Review of P4 (13 Oct 2026): the API caveat is back, in /app's words.
    assert.match((await text(page, "#ai-measured-h + p"))[0]!, /^\d+ prompts on four engines, checked daily\. Google AI Overviews, ChatGPT and Gemini are read through their consumer interface; Perplexity is asked through its API, not read from its app, so its answers can differ from what a person sees there\. No modelled figures/);
    // No recorded origin draws no chip, never "Setup". 13 Oct 2026, DIY P5: the shell wires P2's origins in, so a row
    // draws its recorded origin's chip (origins.json: q1-1 by its legacy source scan and q1-2 setup, q1-3 and q1-5
    // you, q1-4 and q2-1 nomada digital) and every other row none - the fact this line held moved with the wiring.
    const chips = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll("[data-prompt]")].flatMap((r) => { const o = r.querySelector("[data-origin]")?.getAttribute("data-origin"); return o ? [[r.getAttribute("data-prompt"), o]] : []; })));
    // 13 Oct 2026, DIY P7: q1-5 was added from a pursued page in wave 2 (src/lib/diy/fixtures/origins.opportunity.json), so its chip is Opportunity.
    assert.deepEqual(chips, { "q1-1": "setup", "q1-2": "setup", "q1-3": "client", "q1-4": "nomada", "q1-5": "opportunity", "q2-1": "nomada" });
    // The chip's words run into the next cell's figure in textContent ("Origin: Setup0 of 4"), so the words are matched whole.
    assert.equal((await text(page, "[data-prompt]")).filter((t) => /Origin: Setup/.test(t)).length, 2, "Setup on a row with no recorded origin");
    // Every row link resolves; the never-named upgrade prompt shows with its reason.
    await resolves("default", await hrefs(page, "[data-prompt] a"));
    assert.match(await page.evaluate(() => document.querySelector('[aria-label="Upgrade"]')?.textContent ?? ""), /Shown because \d+ of your \d+ prompts named you in none of their [\d,]+ answers this period\./);
    assert.deepEqual(await axe(page), []);
    await ctx.close();
    await shoot("default", `${HOME}/ai`, "ai-default");
  });

  test("an evidence link opens an answer in three clicks or fewer", async () => {
    const { ctx, page } = await open("default", `${HOME}/ai`);
    let clicks = 0;
    await page.locator("[data-prompt] a").first().click();
    clicks++;
    await page.waitForURL(/\/clusters\/c\d+\?/, { timeout: 15_000 });
    await page.waitForFunction(() => /^(Latest answers|Answers on )/.test(document.querySelector("#ans-h")?.textContent ?? ""), undefined, { timeout: 15_000 });
    assert.ok(clicks <= 3);
    await ctx.close();
    // From the Overview's change list, with JS on and off: a grouped line's prompts open (one click), one of them its
    // answer (two) - the section the link names, on the day and engine of the change, drawn on the one-cluster page.
    for (const js of [true, false]) {
      const o = await open("default", HOME, { js });
      let n = 0;
      const summary = o.page.locator("[data-since] [data-since-items] summary").first();
      if (await summary.count()) {
        await summary.click();
        n++;
      }
      const link = o.page.locator('[data-since] a[href*="#answer-"]').first();
      assert.ok(await link.count(), "no change line opens an answer");
      const href = (await link.getAttribute("href"))!;
      await link.click();
      n++;
      const [, engine] = /#answer-(\w+)$/.exec(href)!;
      const [, day] = /[?&]day=(\d{4}-\d{2}-\d{2})/.exec(href)!;
      await o.page.waitForURL(/\/clusters\/c\d+\?/, { timeout: 15_000 });
      await o.page.waitForFunction((id: string) => !!document.getElementById(id), `answer-${engine}`, { timeout: 15_000 });
      const panel = await o.page.evaluate((id: string) => {
        const el = document.getElementById(id);
        return { drawn: (el?.getBoundingClientRect().height ?? 0) > 0, head: (document.querySelector("#ans-h")?.textContent ?? "").trim() };
      }, `answer-${engine}`);
      assert.ok(panel.drawn, `js ${js}: the answer panel is not drawn`);
      assert.match(panel.head, /^(Latest answers|Answers on )/, `js ${js}: ${panel.head}`);
      assert.ok(n <= 3, `${n} clicks`);
      assert.ok(day, href);
      await o.ctx.close();
    }
  });

  test("?missing=1: only prompts that name others and never you", async () => {
    const { ctx, page } = await open("default", `${HOME}/ai?missing=1`);
    const head = (await text(page, "#ai-prompts-h"))[0]!;
    const m = /^(\d+) prompts? names? others and never you$/.exec(head);
    assert.ok(m, head);
    const rows = await page.evaluate(() => [...document.querySelectorAll("[data-prompt]")].map((r) => r.getAttribute("data-missing")));
    assert.equal(rows.length, Number(m[1]));
    assert.ok(rows.every((x) => x === "1"));
    assert.deepEqual(await axe(page), []);
    await ctx.close();
    await shoot("default", `${HOME}/ai?missing=1`, "ai-missing");
  });

  test("the 'Prompts you are named in' figure's link opens a lens with the count it states, on any engine filter", async () => {
    for (const url of [`${HOME}/ai`, `${HOME}/ai?eng=chatgpt`, `${HOME}/ai?eng=chatgpt&q=invoic`]) {
      const { ctx, page } = await open("default", url);
      const fig = await page.evaluate(() => {
        const box = document.querySelector("[data-figure='ai-prompts']");
        const a = box?.querySelector<HTMLAnchorElement>("a");
        return { foot: (box?.children[2]?.textContent ?? "").trim(), link: a ? { text: (a.firstChild?.textContent ?? "").trim(), href: a.getAttribute("href") ?? "" } : null };
      });
      assert.ok(fig.link, `${url}: no link`);
      const never = Number(/^(\d+) never name you/.exec(fig.foot)?.[1]);
      const want = fig.link!.text === "See them" ? never : Number(/^See the (\d+) naming others$/.exec(fig.link!.text)?.[1]);
      assert.ok(Number.isInteger(want) && want > 0 && want <= never, `${url}: "${fig.foot}" / "${fig.link!.text}"`);
      assert.doesNotMatch(fig.link!.href, /[?&](eng|q)=/, "the figure counts every engine and no search");
      await page.goto(new URL(fig.link!.href, `${base("default")}${HOME}/ai`).toString(), { waitUntil: "networkidle" });
      const head = (await text(page, "#ai-prompts-h"))[0]!;
      assert.equal(Number(/^(\d+) prompts? names? others and never you$/.exec(head)?.[1]), want, `${url}: the lens reads "${head}"`);
      await ctx.close();
    }
  });

  test("?eng=chatgpt&lfl=1: the chart's chips and switch are links in the URL's state; the table counts ChatGPT only", async () => {
    const { ctx, page } = await open("default", `${HOME}/ai?eng=chatgpt&lfl=1`);
    const on = await page.evaluate(() => [...document.querySelectorAll("#ai-chart a[aria-current='true']")].map((a) => (a.textContent ?? "").trim()).sort());
    assert.deepEqual(on, ["ChatGPT", "Like-for-like only"]);
    const counts = await text(page, "[data-prompt] [role=cell]:nth-child(3) > span:first-child");
    assert.ok(counts.length >= 40);
    for (const c of counts) assert.match(c, /^(0 of 1|1 of 1|0 of 0|-)$/, c);
    await ctx.close();
    // JS off, the same.
    const off = await open("default", `${HOME}/ai?eng=chatgpt&lfl=1`, { js: false });
    assert.deepEqual(await off.page.evaluate(() => [...document.querySelectorAll("#ai-chart a[aria-current='true']")].map((a) => (a.textContent ?? "").trim()).sort()), ["ChatGPT", "Like-for-like only"]);
    assert.ok(await off.page.evaluate(() => (document.querySelector("#ai-chart")?.getBoundingClientRect().height ?? 0) > 0), "the chart is not drawn with JS off");
    await off.ctx.close();
  });

  test("new: before the first check, the prompts start tomorrow", async () => {
    const { ctx, page, status } = await open("new", `${HOME}/ai`);
    assert.equal(status, 200);
    assert.match(await page.evaluate(() => document.body.innerText), /Your prompts start tomorrow/);
    assert.deepEqual(await axe(page), []);
    await ctx.close();
    await shoot("new", `${HOME}/ai`, "ai-new");
  });

  test("JS off: the figures, the table and the filters are the server's", async () => {
    const { ctx, page } = await open("default", `${HOME}/ai?cluster=c1&sort=named&dir=desc`, { js: false });
    const rows = await page.evaluate(() => [...document.querySelectorAll("[data-prompt]")].filter((r) => r.getBoundingClientRect().height > 0).length);
    assert.equal(rows, 5, "the c1 cluster's five prompts, drawn");
    assert.equal(await page.evaluate(() => document.querySelectorAll("[data-figure^='ai-']").length), 4);
    await ctx.close();
  });

  test("JS off: the upgrade prompt's hide posts and comes back to /ai, on its view, with its toast (303)", async () => {
    const from = `${HOME}/ai?sort=named&dir=desc&angle=category`;
    const { ctx, page } = await open("default", from, { js: false });
    await page.locator('[aria-label="Upgrade"] button[aria-label="Hide for 30 days"]').click();
    await page.waitForURL(/\/app\/tallyroo\/ai\?.*hid=1/, { timeout: 15_000 });
    const back = new URL(page.url());
    assert.equal(back.pathname, `${HOME}/ai`);
    assert.deepEqual([back.searchParams.get("sort"), back.searchParams.get("dir"), back.searchParams.get("angle"), back.searchParams.get("filter")], ["named", "desc", "category", null], back.search);
    assert.match(await page.evaluate(() => document.querySelector("[data-ai-notice]")?.textContent ?? ""), /^Hidden for 30 days, until \d{1,2} \w{3}\. Only you stop seeing it\.$/);
    await ctx.close();
  });

  test("JS off: the upgrade prompt's ask posts and comes back to /ai with its toast (the fixture sends nothing)", async () => {
    const { ctx, page } = await open("default", `${HOME}/ai?missing=1`, { js: false });
    const ask = page.locator('[aria-label="Upgrade"] form[action*="/ask"] button[type="submit"]');
    assert.ok(await ask.count(), "no Ask on the upgrade prompt");
    await ask.first().click();
    await page.waitForURL(/\/app\/tallyroo\/ai\?.*ask=refused/, { timeout: 15_000 });
    assert.equal(new URL(page.url()).searchParams.get("missing"), "1");
    assert.equal(await page.evaluate(() => document.querySelector("[data-ai-notice]")?.textContent ?? ""), "That ask did not send. Try again later.");
    const landed = page.url();
    await ctx.close();
    // axe needs script: the page it landed on, with JS on.
    const on = await open("default", new URL(landed).pathname + new URL(landed).search);
    assert.deepEqual(await axe(on.page), []);
    await on.ctx.close();
  });

  test("no sideways scroll at 390 and 320", async () => {
    for (const url of [`${HOME}/ai`, `${HOME}/ai?missing=1`, `${HOME}/ai?eng=chatgpt&lfl=1`]) {
      for (const width of [390, 320]) {
        const { ctx, page } = await open("default", url, { width, height: 844 });
        const w = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: innerWidth }));
        assert.ok(w.scroll <= w.inner, `${url} at ${width}: ${w.scroll} wide`);
        await ctx.close();
      }
    }
  });
});
