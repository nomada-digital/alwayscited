import assert from "node:assert/strict";
import { test } from "node:test";

import { CRAWLERS, crawlerAccess, purposeLine, raisesBlocking, robotsEdit, robotsState } from "./robots.ts";

/**
 * Crawler access (13 Oct 2026, DIY P8; spec 10 section 6.4): a crawler's own
 * group against `*`, the longest match, an Allow and Disallow tie, a
 * robots.txt answering 4xx or 5xx; which crawlers may raise a Blocking item;
 * and the lines to change.
 */

const verdict = (txt: string, paths: string[], name: string, status = 200) => crawlerAccess({ status, txt }, paths)!.find((c) => c.name === name)!;

test("the crawlers shown: robots-agents.ts's list less * and anthropic-ai", () => {
  assert.deepEqual([...CRAWLERS], ["Googlebot", "Bingbot", "GPTBot", "ClaudeBot", "Google-Extended", "PerplexityBot"]);
});

test("a crawler's own group wins over *, and a rule from * is marked inherited", () => {
  const txt = "User-agent: *\nDisallow: /pricing\n\nUser-agent: Googlebot\nDisallow: /admin\n";
  assert.deepEqual(verdict(txt, ["/", "/pricing"], "Googlebot"), { name: "Googlebot", state: "allowed", inherited: false, line: null, blocked: [] });
  const bing = verdict(txt, ["/", "/pricing"], "Bingbot");
  assert.equal(bing.state, "partial");
  assert.equal(bing.inherited, true);
  assert.equal(bing.line, "Disallow: /pricing");
  assert.deepEqual(bing.blocked, ["/pricing"]);
});

test("the longest match decides, and an Allow wins a tie", () => {
  const txt = "User-agent: GPTBot\nDisallow: /docs\nAllow: /docs/public\nDisallow: /p\nAllow: /p\n";
  assert.equal(verdict(txt, ["/docs/public/a"], "GPTBot").state, "allowed", "the longer Allow wins");
  assert.equal(verdict(txt, ["/docs/private"], "GPTBot").state, "blocked");
  assert.equal(verdict(txt, ["/p"], "GPTBot").state, "allowed", "a tie goes to Allow");
  assert.equal(verdict("User-agent: GPTBot\nDisallow: /\n", ["/", "/x"], "GPTBot").state, "blocked");
});

test("a robots.txt answering 4xx is no robots.txt: every crawler allowed, the status kept; a 5xx or no answer is could not read", () => {
  assert.deepEqual(robotsState({ status: 404, txt: "<html>not found</html>" }), { kind: "none", status: 404 });
  assert.ok(crawlerAccess({ status: 404, txt: "User-agent: *\nDisallow: /\n" }, ["/"])!.every((c) => c.state === "allowed"), "a 404 page's body is not read as rules");
  assert.deepEqual(robotsState({ status: 503, txt: "x" }), { kind: "unreadable", status: 503 });
  assert.equal(crawlerAccess({ status: 503, txt: "x" }, ["/"]), null);
  assert.equal(crawlerAccess({ status: null, txt: null }, ["/"]), null);
});

test("only a crawler whose verified source says it serves search or answers raises a Blocking item: Googlebot at launch, never Google-Extended", () => {
  assert.equal(raisesBlocking("Googlebot"), true);
  for (const name of ["GPTBot", "ClaudeBot", "PerplexityBot", "Bingbot", "Google-Extended"]) assert.equal(raisesBlocking(name), false, name);
  assert.equal(purposeLine("Googlebot"), "pages.bots.googlebot");
  assert.equal(purposeLine("GPTBot"), null, "no purpose shown without a verified source");
});

test("the lines to change: the deciding line out of its group, or Allows beside it, never a new group", () => {
  const v = verdict("User-agent: Googlebot\nDisallow: /pricing\n", ["/", "/pricing"], "Googlebot");
  assert.equal(robotsEdit(v), "# In the User-agent: Googlebot group, remove this line:\nDisallow: /pricing\n# or keep it, and add these lines in the same group:\nAllow: /pricing");
  assert.equal(robotsEdit(verdict("User-agent: *\nDisallow: /p\n", ["/p"], "Googlebot")), "# In the User-agent: * group, remove this line:\nDisallow: /p\n# or keep it, and add these lines in the same group:\nAllow: /p");
  assert.equal(robotsEdit(verdict("", ["/"], "Googlebot")), null);
});
