/**
 * The placement row's two new lines (13 Oct 2026, DIY P2; spec 10 section
 * 4.11). Illustrative: Tallyroo and every site shown are made up.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { originMap } from "./origins.ts";
import { NOT_CITED, NO_PROMPT, TOO_EARLY, firstCitedBy, firstCitedLine, placementPromptOf, promptLine } from "./placement-lines.ts";

const ENGINES = ["google_aio", "chatgpt", "gemini", "perplexity", "claude"];
const LABEL: Record<string, string> = { google_aio: "Google AI Overview", chatgpt: "ChatGPT", gemini: "Gemini", perplexity: "Perplexity", claude: "Claude" };
const label = (e: string) => LABEL[e] ?? e;
const KEY = "thesmallbizstack.com/best-accounting-apps";
const cite = (run_date: string, engine: string, url = "https://thesmallbizstack.com/best-accounting-apps") => ({ run_date, engine, url });

test("first cited: the earliest day per engine, from go-live, on the page's own url_key, earliest first", () => {
  const cites = [
    cite("2026-10-15", "chatgpt"),
    cite("2026-10-12", "perplexity"),
    cite("2026-10-13", "perplexity"),
    cite("2026-10-01", "gemini"), // before go-live
    cite("2026-10-12", "google_aio", "https://www.thesmallbizstack.com/best-accounting-apps/?utm=x"), // the same page, written differently
    cite("2026-10-11", "claude", "https://thesmallbizstack.com/invoicing-guide"), // another page on the site
  ];
  const first = firstCitedBy(cites, KEY, "2026-10-04", ENGINES);
  assert.deepEqual(first, [
    { engine: "google_aio", day: "2026-10-12" },
    { engine: "perplexity", day: "2026-10-12" },
    { engine: "chatgpt", day: "2026-10-15" },
  ]);
  assert.equal(firstCitedLine(first, { liveOn: "2026-10-04", today: "2026-10-20", rangeFrom: "2026-09-01", label }), "First cited: Google AI Overview 12 Oct, Perplexity 12 Oct, ChatGPT 15 Oct");
  assert.deepEqual(firstCitedBy(cites, KEY, "2026-10-04", ["chatgpt"]), [{ engine: "chatgpt", day: "2026-10-15" }], "only the tier's engines");
});

test("not cited: too early to read under 21 days, then not cited yet", () => {
  assert.equal(firstCitedLine([], { liveOn: "2026-10-04", today: "2026-10-24", rangeFrom: "2026-09-01", label }), TOO_EARLY);
  assert.equal(firstCitedLine([], { liveOn: "2026-10-04", today: "2026-10-25", rangeFrom: "2026-09-01", label }), NOT_CITED);
  assert.equal(TOO_EARLY, "Too early to read");
  assert.equal(NOT_CITED, "Not cited yet");
});

test("a range that starts after go-live cannot see the first citation, so it says so", () => {
  const first = [{ engine: "perplexity", day: "2026-10-12" }];
  assert.equal(firstCitedLine(first, { liveOn: "2026-08-12", today: "2026-10-20", rangeFrom: "2026-10-01", label }), "First cited in this range: Perplexity 12 Oct");
  assert.equal(firstCitedLine([], { liveOn: "2026-08-12", today: "2026-10-20", rangeFrom: "2026-10-01", label }), "Not cited in this range");
});

const origins = originMap([
  { id: "pq-old", source: "nomada", origin_kind: "placement", origin_ref: "p1", allowance: "placement" },
  { id: "pq-new", source: "nomada", origin_kind: "placement", origin_ref: "p1", allowance: "placement" },
  { id: "pq-other", source: "nomada", origin_kind: "placement", origin_ref: "p2", allowance: "placement" },
  { id: "q1", source: "client" },
]);

test("the placement's own prompt: a live one before a stopped one", () => {
  const prompts = [
    { id: "pq-old", text: "old prompt", added_on: "2026-08-01", stopped_on: "2026-09-01" },
    { id: "pq-new", text: "new prompt", added_on: "2026-09-05", stopped_on: null },
    { id: "q1", text: "a client prompt", added_on: "2026-06-10", stopped_on: null },
  ];
  assert.equal(placementPromptOf("p1", origins, prompts)?.id, "pq-new");
  assert.equal(placementPromptOf("p1", origins, prompts.slice(0, 1))?.id, "pq-old");
  assert.equal(placementPromptOf("p9", origins, prompts), null);
});

test("the prompt line: added, first asked tomorrow, stopped, and each reason for none", () => {
  const base = { kind: "guest_post", live: true, today: "2026-10-04" };
  assert.equal(promptLine({ ...base, prompt: { id: "x", text: "best invoicing apps for freelancers", added_on: "2026-10-04", stopped_on: null } }), "Prompt added 4 Oct: “best invoicing apps for freelancers”");
  assert.equal(promptLine({ ...base, prompt: { id: "x", text: "best invoicing apps for freelancers", added_on: "2026-10-05", stopped_on: null } }), "Prompt added: “best invoicing apps for freelancers”, first asked tomorrow");
  assert.equal(promptLine({ ...base, prompt: { id: "x", text: "t prompt here", added_on: "2026-08-01", stopped_on: "2026-10-02" } }), "Prompt “t prompt here” stopped from 2 Oct");
  assert.equal(promptLine({ ...base, prompt: { id: "x", text: "t prompt here", added_on: "2026-08-01", stopped_on: "2026-10-05" } }), "Prompt added 1 Aug: “t prompt here”", "a stop still pending is asked today");
  assert.equal(promptLine({ ...base, kind: "on_site", prompt: null }), "No prompt: on-site work adds none");
  assert.equal(promptLine({ ...base, kind: "link_insertion", prompt: null }), "No prompt: a link in an existing article adds none by default");
  // 13 Oct 2026 review: why a guest post has none is not stored, so the line does not guess (the allowance being full now
  // says nothing of why this one has none).
  assert.equal(promptLine({ ...base, prompt: null }), "No prompt added from this article");
  assert.equal(NO_PROMPT, "No prompt added from this article");
  assert.equal(promptLine({ ...base, live: false, prompt: null }), null, "nothing is due from a placement not live");
  for (const kind of ["guest_post", "on_site", "link_insertion", "coverage"]) {
    assert.doesNotMatch(promptLine({ ...base, kind, prompt: null }) ?? "", /nomada|caused|drove|thanks to|because of|delivered|resulted in/i, kind);
  }
});
