import assert from "node:assert/strict";
import { test } from "node:test";

import { blocks } from "./hub-post-blocks.ts";

// A synthetic hub post body, in the shape the hub's editor writes.
const BODY = [
  "Opening paragraph with **bold** and a [link](/how-it-works).",
  "[[toc]]",
  "## What a citation is worth",
  "Line one\nline two of the same paragraph.",
  "- first\n- second",
  "1. one\n2. two",
  "> a quoted line",
  "### A detail",
  "## What a citation is worth",
  "[[figure]]",
  "[[faqs]]",
  "[[cta]]",
].join("\n\n");

test("a hub post's text becomes the blocks the shared post components render", () => {
  const { blocks: b, sections } = blocks(BODY);
  assert.deepEqual(b.map((x) => x.k), ["p", "toc", "h2", "p", "ul", "ol", "quote", "h3", "h2", "figure", "faqs", "cta"]);
  assert.deepEqual(b[3], { k: "p", text: "Line one line two of the same paragraph." }, "lines in one paragraph join");
  assert.deepEqual(b[4], { k: "ul", items: ["first", "second"] });
  assert.deepEqual(b[5], { k: "ol", items: ["one", "two"] });
  assert.deepEqual(sections, [
    { id: "what-a-citation-is-worth", label: "What a citation is worth" },
    { id: "what-a-citation-is-worth-2", label: "What a citation is worth" },
  ], "h2s are the contents, with unique ids");
});

test("a heading never takes the FAQ section's id, and an empty body is no blocks", () => {
  assert.equal(blocks("## Questions").sections[0]!.id, "questions-2");
  assert.deepEqual(blocks("\n\n  \n").blocks, []);
});
