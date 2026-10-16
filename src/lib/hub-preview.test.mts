import assert from "node:assert/strict";
import { test } from "node:test";

import { previewPath } from "./hub-preview.ts";

const KEY = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

test("a hub draft link is rewritten to its preview route, and nothing else is", () => {
  assert.equal(previewPath("/blog/what-a-citation-is-worth", KEY), `/blog-preview/what-a-citation-is-worth/${KEY}`);
  assert.equal(previewPath("/blog/x", KEY.toUpperCase()), `/blog-preview/x/${KEY}`);
  assert.equal(previewPath("/blog/what-a-citation-is-worth", null), null, "no key, no rewrite");
  assert.equal(previewPath("/blog/what-a-citation-is-worth", "not-a-key"), null);
  assert.equal(previewPath("/blog", KEY), null, "the index is not a post");
  assert.equal(previewPath("/blog/a/b", KEY), null);
  assert.equal(previewPath("/blog/Bad_Slug", KEY), null);
  assert.equal(previewPath("/case-studies/x", KEY), null);
});
