import assert from "node:assert/strict";
import { test } from "node:test";

import { createClient } from "@supabase/supabase-js";

import { SHELL_READ, SHELL_READ_UNPAID, readShell } from "./shell.ts";

/**
 * The shell's one read (13 Oct 2026, dashboard speed work), run through the
 * real supabase-js with its fetch answered here: what is asked of PostgREST -
 * one request, its embeds and the filters on each - and what is made of the
 * answer: AG-1's scope, the order, BL-2's banner, and a failure that throws
 * rather than reading as no clients.
 */

type Answer = { status: number; body: unknown };

/** A supabase-js client whose requests are recorded and answered in turn from `answers`. Nothing leaves the process. */
function stub(answers: Answer[]) {
  const urls: URL[] = [];
  const db = createClient("http://shell.test", "not-a-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input: string | URL | Request) => {
        urls.push(new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url));
        const a = answers.shift() ?? { status: 500, body: { message: "no answer left in the test" } };
        return new Response(JSON.stringify(a.body), { status: a.status, headers: { "content-type": "application/json" } });
      },
    },
  });
  return { db, urls };
}

const client = (id: string, account: string, created: string, extra: Record<string, unknown> = {}) => ({
  id,
  account_id: account,
  slug: id.toLowerCase(),
  domain: `${id.toLowerCase()}.example`,
  brand_name: id,
  market: "UK",
  tier: "tracked",
  started_on: "2026-09-01",
  question_limit: 50,
  keyword_limit: 10,
  cluster_limit: 10,
  trial_ends_at: null,
  trial_cancelled_at: null,
  status: "active",
  created_at: created,
  ...extra,
});

/** Two accounts: a1 holds A and B, a2 holds Z. The member is limited to A on a1 and sees all of a2. */
const twoAccounts = () => [
  { id: "m1", account_id: "a1", role: "viewer", dashboard_member_clients: [{ client_domain_id: "A" }], accounts: { client_domains: [client("B", "a1", "2026-09-03T00:00:00+00:00"), client("A", "a1", "2026-09-01T00:00:00+00:00", { payment_status: "past_due", payment_retry_at: "2026-10-15T00:00:00Z", payment_invoice_url: null, payment_ended_at: null })] } },
  { id: "m2", account_id: "a2", role: "owner", dashboard_member_clients: [], accounts: { client_domains: [client("Z", "a2", "2026-09-02T00:00:00.5+00:00")] } },
];

test("one request: live memberships, each with its live scope and its account's clients with a slug", async () => {
  const { db, urls } = stub([{ status: 200, body: twoAccounts() }]);
  await readShell(db, "lead@client.example");
  assert.equal(urls.length, 1, "the shell is one read");
  const u = urls[0]!;
  assert.equal(u.pathname, "/rest/v1/dashboard_members");
  assert.equal(u.searchParams.get("select"), SHELL_READ.replace(/\s/g, ""), "supabase-js sends the select with its spaces taken out");
  assert.equal(u.searchParams.get("email"), "eq.lead@client.example");
  assert.equal(u.searchParams.get("removed_at"), "is.null", "a removed membership sees nothing");
  assert.equal(u.searchParams.get("dashboard_member_clients.removed_at"), "is.null", "a removed scope row neither limits nor grants");
  assert.equal(u.searchParams.get("accounts.client_domains.slug"), "not.is.null", "a client with no slug is not on /app");
  assert.match(SHELL_READ, /accounts\(client_domains!client_domains_account_id_fkey\(/, "the client embed is held to its foreign key");
  assert.match(SHELL_READ, /payment_status, payment_retry_at, payment_invoice_url, payment_ended_at\)\)$/, "the banner's columns are in the one read");
});

test("AG-1: a limited member sees only their clients on that account, every client on an unlimited one, oldest first", async () => {
  const { db } = stub([{ status: 200, body: twoAccounts() }]);
  const got = await readShell(db, "lead@client.example");
  assert.deepEqual(
    got.map((c) => `${c.id}:${c.role}`),
    ["A:viewer", "Z:owner"],
    "B is on a1 but outside the scope; Z is on a2, where the member has no scope rows",
  );
  assert.equal(got[0]!.payment_status, "past_due", "the banner's state rides on the client");
  assert.equal(got[1]!.payment_status, null);
  for (const c of got) assert.ok(!("account_id" in c), "account_id never leaves the shell");
  const unlimited = stub([{ status: 200, body: [{ ...twoAccounts()[0], dashboard_member_clients: [] }] }]);
  assert.deepEqual((await readShell(unlimited.db, "staff@agency.example")).map((c) => c.id), ["A", "B"], "no scope rows: every client on the account, oldest first");
  const stray = stub([{ status: 200, body: [{ ...twoAccounts()[1], accounts: { client_domains: [client("Q", "a9", "2026-09-01T00:00:00+00:00")] } }] }]);
  assert.deepEqual(await readShell(stray.db, "x@y.example"), [], "a client row on an account the member is not on is never shown");
});

test("no live membership is no clients, in the same one request", async () => {
  const { db, urls } = stub([{ status: 200, body: [] }]);
  assert.deepEqual(await readShell(db, "nobody@example.com"), []);
  assert.equal(urls.length, 1);
});

test("BL-2: a failed read with the payment columns is made again without them; the clients still show, without the banner", async () => {
  const warn = console.warn;
  const warned: string[] = [];
  console.warn = (m: string) => void warned.push(m);
  try {
    const { db, urls } = stub([
      { status: 400, body: { code: "42703", message: "column client_domains_1.payment_retry_at does not exist" } },
      { status: 200, body: twoAccounts() },
    ]);
    const got = await readShell(db, "lead@client.example");
    assert.equal(urls.length, 2);
    assert.equal(urls[1]!.searchParams.get("select"), SHELL_READ_UNPAID.replace(/\s/g, ""));
    assert.ok(!SHELL_READ_UNPAID.includes("payment_"), "the second read names no payment column");
    assert.equal(urls[1]!.searchParams.get("dashboard_member_clients.removed_at"), "is.null", "the second read keeps the scope's filter");
    assert.deepEqual(got.map((c) => c.id), ["A", "Z"], "the same clients, the same scope");
    assert.ok(got.every((c) => !("payment_status" in c)), "no banner state from a read that failed");
    assert.match(warned.join("\n"), /payment state not read, no payment banner: column client_domains_1\.payment_retry_at does not exist/);
  } finally {
    console.warn = warn;
  }
});

test("a membership read that fails throws, both times, and is never read as no clients", async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    const { db, urls } = stub([
      { status: 500, body: { message: "canceling statement due to statement timeout" } },
      { status: 500, body: { message: "canceling statement due to statement timeout" } },
    ]);
    await assert.rejects(readShell(db, "lead@client.example"), /could not read memberships: canceling statement due to statement timeout/);
    assert.equal(urls.length, 2, "one read, then the one without payment columns, then the throw");
    const scopeless = stub([
      { status: 400, body: { code: "PGRST200", message: "Could not find a relationship between 'dashboard_members' and 'dashboard_member_clients' in the schema cache" } },
      { status: 400, body: { code: "PGRST200", message: "Could not find a relationship between 'dashboard_members' and 'dashboard_member_clients' in the schema cache" } },
    ]);
    await assert.rejects(readShell(scopeless.db, "lead@client.example"), /could not read memberships/, "a scope that cannot be read never widens what a member sees");
  } finally {
    console.warn = warn;
  }
});
