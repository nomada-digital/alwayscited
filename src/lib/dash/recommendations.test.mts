import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { MAX_SHOWN, MAX_UPGRADES, loadRecommendations, newCount, pick, safeHref, upgradeCards, type Pricing } from "./recommendations.ts";
import { mondayOf, sampleRecommendations } from "./recommendations-sample.ts";

/**
 * The weekly recommendations (22 Nov 2026): what a customer is shown, when, and what the upgrade cards may say.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

const row = (o: Record<string, unknown> = {}) => ({
  id: `r-${Math.random().toString(36).slice(2)}`,
  week_of: "2026-11-16",
  position: 1,
  kind: "content",
  title: "A title",
  why: "A reason.",
  evidence: {},
  how: ["Step one"],
  href: null,
  offer: null,
  status: "new",
  released_at: "2026-11-16T09:00:00Z",
  ...o,
});

test("released only: a row with no released_at is never picked, whatever the read returned", () => {
  const p = pick([row({ id: "a" }), row({ id: "b", released_at: null }), row({ id: "c", released_at: null, week_of: "2026-11-23" })]);
  assert.deepEqual(p.items.map((r) => r.id), ["a"]);
  assert.equal(p.week, "2026-11-16", "an unreleased newer week does not become the week");
  assert.deepEqual(pick([row({ released_at: null })]), { week: null, items: [], upgrades: [] });
});

test("the newest released week leads in position order; earlier weeks follow only while new; capped at five", () => {
  const p = pick([
    row({ id: "old-new", week_of: "2026-11-09", position: 1 }),
    row({ id: "old-done", week_of: "2026-11-09", position: 2, status: "done" }),
    row({ id: "old-dismissed", week_of: "2026-11-09", position: 3, status: "dismissed" }),
    row({ id: "c2", position: 2 }),
    row({ id: "c1", position: 1 }),
    row({ id: "c-dismissed", position: 3, status: "dismissed" }),
    row({ id: "c-done", position: 4, status: "done" }),
  ]);
  assert.deepEqual(p.items.map((r) => r.id), ["c1", "c2", "c-done", "old-new"]);
  const many = pick(Array.from({ length: 9 }, (_, i) => row({ id: `m${i}`, position: i + 1 })));
  assert.equal(many.items.length, MAX_SHOWN);
  assert.equal(newCount(p.items), 3);
});

test("upgrade rows are kept out of the list and capped at two, from the newest week", () => {
  const offer = { tier: "cited", what: "We would do it" };
  const p = pick([row({ id: "u1", kind: "upgrade", offer }), row({ id: "u2", kind: "upgrade", offer, position: 2 }), row({ id: "u3", kind: "upgrade", offer, position: 3 }), row({ id: "old-u", kind: "upgrade", offer, week_of: "2026-11-09" }), row({ id: "x" })]);
  assert.deepEqual(p.items.map((r) => r.id), ["x"]);
  assert.deepEqual(p.upgrades.map((r) => r.id), ["u1", "u2"]);
  assert.equal(p.upgrades.length, MAX_UPGRADES);
  assert.deepEqual(pick([row({ kind: "upgrade", offer: null })]).upgrades, [], "an upgrade row with no offer cannot be drawn");
});

test("a malformed stored row is dropped or cleaned, never drawn raw", () => {
  const p = pick([
    row({ id: "bad-kind", kind: "nonsense" }),
    row({ id: "bad-status", status: "weird" }),
    row({ id: "no-title", title: "  " }),
    null,
    "text",
    row({ id: "ok", href: "javascript:alert(1)", evidence: { engines: ["chatgpt", "nope"], answers: -3, url: "javascript:x", competitors: ["A", 4], prompts: "not a list" }, how: "not a list" }),
  ]);
  assert.deepEqual(p.items.map((r) => r.id), ["ok"]);
  const r = p.items[0]!;
  assert.equal(r.href, null);
  assert.deepEqual(r.evidence, { engines: ["chatgpt"], competitors: ["A"] });
  assert.deepEqual(r.how, []);
  assert.equal(safeHref("https://example.com/a"), "https://example.com/a");
  assert.equal(safeHref("data:text/html,x"), null);
});

type Call = [string, ...unknown[]];
function fakeDb(result: { data?: unknown[] | null; error?: { message: string; code?: string } | null } | "throws") {
  const calls: Call[] = [];
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "not", "order", "limit"]) q[m] = (...a: unknown[]) => { calls.push([m, ...a]); return q; };
  q.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => (result === "throws" ? Promise.reject(new Error("network")) : Promise.resolve({ data: result.data ?? null, error: result.error ?? null })).then(res, rej);
  return { db: { from: (t: string) => { calls.push(["from", t]); return q; } } as never, calls };
}

test("the read is scoped to the client and asks for released rows only", async () => {
  const { db, calls } = fakeDb({ data: [row({ id: "a" })] });
  const r = await loadRecommendations(db, "client-1");
  assert.deepEqual(calls.find((c) => c[0] === "from"), ["from", "customer_recommendations"]);
  assert.deepEqual(calls.find((c) => c[0] === "eq"), ["eq", "client_domain_id", "client-1"]);
  assert.deepEqual(calls.find((c) => c[0] === "not"), ["not", "released_at", "is", null]);
  assert.equal(r.ok && r.items.length, 1);
  const sel = String(calls.find((c) => c[0] === "select")![1]);
  assert.ok(!/\bsource_key\b|\bclient_domain_id\b/.test(sel), "named columns only, no ids a customer does not need");
});

test("fallback: a missing table, a failed read or a thrown one is not-ok, never an empty list", async () => {
  for (const result of [{ error: { code: "42P01", message: 'relation "customer_recommendations" does not exist' } }, { error: { code: "PGRST205", message: "Could not find the table" } }, { error: { message: "boom" } }, "throws"] as const) {
    const warn = console.warn;
    console.warn = () => undefined;
    try {
      assert.deepEqual(await loadRecommendations(fakeDb(result).db, "c"), { ok: false });
    } finally {
      console.warn = warn;
    }
  }
  assert.deepEqual(await loadRecommendations(fakeDb({ data: [] }).db, "c"), { ok: true, week: null, items: [], upgrades: [] }, "an empty table that read fine is an empty state");
});

const FAKE: Pricing = { priceLabel: (t) => `LABEL-${t}`, href: (t) => `/go/${t}` };
const upg = (o: Record<string, unknown> = {}) => pick([row({ kind: "upgrade", offer: { tier: "cited", what: "Do the thing" }, ...o })]).upgrades;

test("upgrade cards: only for tier tracked, and the price and link are only what the pricing supplies", () => {
  const u = upg();
  assert.deepEqual(upgradeCards(u, "tracked", FAKE), [{ id: u[0]!.id, what: "Do the thing", why: "A reason.", priceLabel: "LABEL-cited", href: "/go/cited" }]);
  for (const tier of ["cited", "mentioned", "everywhere", "", "TRACKED"]) assert.deepEqual(upgradeCards(u, tier, FAKE), [], tier);
  const three = pick([1, 2, 3].map((n) => row({ kind: "upgrade", position: n, offer: { tier: "mentioned", what: `W${n}` } }))).upgrades;
  assert.equal(upgradeCards(three, "tracked", FAKE).length, 2);
});

test("upgrade cards: a price figure in a stored row is never shown - only the supplied label is", () => {
  const u = upg({ offer: { tier: "cited", what: "Do the thing", price: "$1", priceLabel: "$1/mo" }, evidence: { price: 5 } });
  const card = upgradeCards(u, "tracked", FAKE)[0]!;
  assert.equal(card.priceLabel, "LABEL-cited");
  assert.ok(!JSON.stringify(card).includes("$1"));
});

test("the upgrade component reads its price and link from pricing.ts, and no price is typed in the new files", () => {
  const comp = read("src", "components", "dash", "BuildForYou.tsx");
  assert.match(comp, /from "@\/config\/pricing"/);
  assert.match(comp, /\.priceLabel/);
  assert.match(comp, /checkoutUrlFor/);
  assert.match(comp, /contactUrlFor/);
  assert.match(comp, /basePrice === null/, "a tier priced as a call goes to the contact form");
  for (const f of [["src", "components", "dash", "BuildForYou.tsx"], ["src", "app", "dashboards", "[client]", "recommendations", "page.tsx"], ["src", "lib", "dash", "recommendations.ts"], ["src", "lib", "dash", "recommendations-sample.ts"], ["supabase", "migrations", "20261122000000_customer_recommendations.sql"]]) {
    const src = read(...f);
    assert.ok(!/[$£€]\s?\d/.test(src), `${f.join("/")} types a price`);
    assert.ok(!/\b\d+\s?\/\s?(mo|month)\b/i.test(src), `${f.join("/")} types a monthly figure`);
  }
});

test("the page gates the upgrade card on the client's tier and never lists upgrade rows in the main list", () => {
  const page = read("src", "app", "dashboards", "[client]", "recommendations", "page.tsx");
  assert.match(page, /<BuildForYou upgrades=\{recs\.upgrades\} tier=\{ws\.client\.tier\}/);
  assert.match(page, /EngineLogo/, "engine logos come from the real component");
  assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(page), "no emoji");
  assert.equal(pick([row({ kind: "upgrade", offer: { tier: "cited", what: "x" } })]).items.length, 0);
});

test("the empty and unreadable states say what they mean", () => {
  const page = read("src", "app", "dashboards", "[client]", "recommendations", "page.tsx");
  assert.match(page, /Your first recommendations arrive after your first full week of readings, once we have reviewed them\./);
  assert.match(page, /could not be read/);
});

test("the nav has a Recommendations item straight after Opportunities, counting new items", () => {
  const shell = read("src", "components", "dash", "Shell.tsx");
  const i = shell.indexOf('label: "Opportunities"');
  const j = shell.indexOf('label: "Recommendations"');
  assert.ok(i > 0 && j > i);
  assert.ok(!shell.slice(i, j).includes('label: "Integrations"'), "placed directly after Opportunities");
  assert.match(shell.slice(j, j + 160), /n: recommendations \|\| null/);
});

test("copy census: no em or en dashes, no capitalised brand names, no supplier names, no urgency words", () => {
  const s = sampleRecommendations("2026-11-22");
  const files = [
    read("src", "app", "dashboards", "[client]", "recommendations", "page.tsx"),
    read("src", "components", "dash", "BuildForYou.tsx"),
    read("src", "lib", "dash", "recommendations.ts"),
    read("src", "lib", "dash", "recommendations-sample.ts"),
    read("supabase", "migrations", "20261122000000_customer_recommendations.sql"),
    JSON.stringify([...s.items, ...s.upgrades]),
  ];
  for (const t of files) {
    assert.ok(!/[–—]/.test(t), "a dash that is not a hyphen");
    assert.ok(!/\b(Alwayscited|AlwaysCited|Alwaystracked|AlwaysTracked|Alwaysmentioned|Alwayseverywhere|AlwaysMentioned|AlwaysEverywhere)\b/.test(t), "a capitalised brand");
  }
  // What a customer reads: the page, the card and the sample rows (not the loader, whose imports name a client library).
  for (const t of [files[0]!, files[1]!, files[5]!]) assert.ok(!/\b(Windsor|Ahrefs|Semrush|Supabase|Vercel|Stripe|Resend|Anthropic|Fatgrid|DataForSEO|SerpApi|Haiku)\b/i.test(t.replace(/^import .*$/gm, "")), "a supplier or vendor name");
  const copy = JSON.stringify([...s.items, ...s.upgrades]) + files[1]!;
  assert.ok(!/\b(hurry|limited|last chance|act now|don't miss|only \d+ left|expires?|deadline|today only|before it'?s too late)\b/i.test(copy), "pressure wording");
});

test("sample: five recommendations of five kinds, two quiet upgrades with a tier and no price, all released and new", () => {
  const s = sampleRecommendations("2026-11-22");
  assert.equal(s.week, "2026-11-16");
  assert.deepEqual(s.items.map((r) => r.kind), ["schema", "profile", "on_page_answer", "listing", "content"]);
  assert.equal(s.upgrades.length, 2);
  for (const u of s.upgrades) assert.ok(u.offer && ["cited", "mentioned", "everywhere"].includes(u.offer.tier));
  const p = pick([...s.items, ...s.upgrades]);
  assert.equal(p.items.length, 5);
  assert.equal(p.upgrades.length, 2);
  assert.ok(s.items.find((r) => r.kind === "on_page_answer")!.evidence.engines!.length > 1, "engines evidence on the on-page answer");
  assert.equal(mondayOf("2026-11-16"), "2026-11-16");
  assert.equal(mondayOf("2026-11-22"), "2026-11-16");
});

test("migration: additive, the contract's columns, rls on with no policy, the week index", () => {
  const sql = read("supabase", "migrations", "20261122000000_customer_recommendations.sql");
  assert.match(sql, /create table if not exists customer_recommendations/);
  assert.match(sql, /unique \(client_domain_id, week_of, source_key\)/);
  assert.match(sql, /create index if not exists \S+ on customer_recommendations \(client_domain_id, week_of\)/);
  assert.match(sql, /alter table customer_recommendations enable row level security/);
  assert.ok(!/create policy|drop |truncate|delete from|alter column|rename/i.test(sql.replace(/^--.*$/gm, "")));
});
