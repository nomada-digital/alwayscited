import assert from "node:assert/strict";
import { test } from "node:test";

import { anchorWarning, crossAnchorWarnings, formSplit, nextForm, samePage, sharedTargets, targetWarning } from "./placement-target.ts";

const primary = { id: "k1", keyword: "ai seo agency", form: "primary" as const };
const plural = { id: "k2", keyword: "ai seo agencies", form: "plural" as const };
const p = (target_keyword_id: string | null, status = "live") => ({ target_keyword_id, status });

test("placements alternate between the forms, primary first on a tie (cited: 3 placements + 2 insertions)", () => {
  const made: ReturnType<typeof p>[] = [];
  const picked: string[] = [];
  for (let i = 0; i < 5; i++) {
    const f = nextForm([primary, plural], made)!;
    picked.push(f.keyword);
    made.push(p(f.id));
  }
  assert.deepEqual(picked, ["ai seo agency", "ai seo agencies", "ai seo agency", "ai seo agencies", "ai seo agency"]);
  assert.deepEqual(formSplit([primary, plural], made), [{ keyword: "ai seo agency", count: 3 }, { keyword: "ai seo agencies", count: 2 }]);
});

test("a removed placement does not count toward the split", () => {
  assert.equal(nextForm([primary, plural], [p("k1", "removed"), p("k2")])!.id, "k1");
  assert.equal(nextForm([primary], [p("k1"), p("k1")])!.id, "k1", "no pair: always the primary");
  assert.equal(nextForm([], []), null);
});

test("an anchor without its target keyword form is warned about, never blocked", () => {
  assert.equal(anchorWarning("AI SEO agency", "ai seo agency"), null);
  assert.equal(anchorWarning("the best AI-SEO agency in the US", "ai seo agency"), null);
  assert.match(anchorWarning("AI SEO agencies", "ai seo agency") ?? "", /ai seo agency/, "a plural anchor does not contain the singular form");
  assert.match(anchorWarning("click here", "ai seo agencies") ?? "", /does not contain/);
  assert.equal(anchorWarning("", "ai seo agency"), null);
  assert.equal(anchorWarning("AI SEO agency", null), null);
});

test("a placement linking elsewhere than the cluster's target page is warned about", () => {
  assert.equal(targetWarning("https://www.nomadadigital.co.uk/", "https://nomadadigital.co.uk"), null);
  assert.match(targetWarning("https://nomadadigital.co.uk/", "https://www.nomadadigital.co.uk/blog/best-seo-agency-for-b2b") ?? "", /not the cluster's target page/);
  assert.equal(targetWarning(null, "https://a.com/"), null);
  assert.ok(samePage("https://A.com/x/?utm=1#top", "a.com/x"));
});

test("two clusters sharing a target page are flagged (brief 2b conflict check)", () => {
  const out = sharedTargets([
    { name: "B2B SEO agency", target: "https://www.nomadadigital.co.uk/" },
    { name: "B2B search marketing agency", target: "https://nomadadigital.co.uk" },
    { name: "Other", target: "https://nomadadigital.co.uk/blog/x" },
    { name: "None", target: null },
  ]);
  assert.equal(out.length, 1);
  assert.match(out[0], /B2B SEO agency and B2B search marketing agency share/);
  assert.deepEqual(sharedTargets([{ name: "A", target: "https://a.com/" }]), []);
});

test("an internal link using another cluster's keyword as anchor is flagged (the /services/seo case)", () => {
  const out = crossAnchorWarnings(
    { url: "https://www.nomadadigital.co.uk/services/seo", cluster: "B2B search marketing agency" },
    [{ anchor: "B2B SEO agency", href: "https://www.nomadadigital.co.uk/" }],
    [{ cluster: "B2B SEO agency", target: "https://www.nomadadigital.co.uk/blog/best-seo-agency-for-b2b", keywords: ["b2b seo agency", "b2b seo agencies"] }],
  );
  assert.equal(out.length, 1);
  assert.match(out[0], /uses "B2B SEO agency", B2B SEO agency's keyword, as anchor text and points it at https:\/\/www.nomadadigital.co.uk\//);
});
