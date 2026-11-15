import assert from "node:assert/strict";
import { test } from "node:test";

import { pageOne, pageOneOverall, shareOfVoice } from "./share.ts";

const a = (run_date: string, engine: string, named: boolean, brands: string[], question_id = "q1") => ({ run_date, question_id, engine, answered: true, named, brands });

test("share of voice counts the customer by named and others by the extracted brands, with the changes", () => {
  const answers = [
    a("2026-11-15", "chatgpt", true, ["Ledgerline", "Booksy"]),
    a("2026-11-15", "gemini", false, ["Ledgerline"]),
    a("2026-11-14", "claude", false, ["Ledgerline", "Tallyroo"]),
    a("2026-11-14", "perplexity", true, []),
    a("2026-11-07", "chatgpt", false, ["Ledgerline"]),
    a("2026-11-07", "gemini", false, ["Booksy"]),
  ];
  const [all] = shareOfVoice(answers, { clusters: [], subject: new Set(["tallyroo"]), you: "Tallyroo" });
  const you = all!.rows.find((r) => r.you)!;
  const led = all!.rows.find((r) => r.name === "Ledgerline")!;
  assert.equal(all!.answers, 4);
  assert.equal(you.share, 0.5);
  assert.equal(led.share, 0.75);
  assert.equal(you.d7, 0.5);
  assert.equal(led.d7, 0.25);
  assert.equal(you.engines.chatgpt, 1);
  assert.equal(you.engines.gemini, 0);
  assert.equal(all!.rank, 2);
  assert.equal(all!.of, 3);
});

test("share of page 1 weights the top 10 by click-through and gives the AI Overview its own slot", () => {
  const p = pageOne([{ rank: 1, domain: "www.tallyroo.com" }, { rank: 2, domain: "ledgerline.com" }], ["tallyroo.com", "booksy.example", "google.co.uk"], "tallyroo.com");
  assert.ok(Math.abs(p.total - (0.28 + 0.16 + 0.16)) < 1e-9);
  assert.ok(Math.abs(p.you - (0.28 + 0.08)) < 1e-9);
  const none = pageOne([{ rank: 3, domain: "ledgerline.com" }], null, "tallyroo.com");
  assert.equal(none.you, 0);
  const overall = pageOneOverall([p, none], "tallyroo.com");
  assert.equal(overall[0]!.you, true);
  assert.ok(Math.abs(overall.reduce((s, r) => s + r.share, 0) - 1) < 1e-9);
});
