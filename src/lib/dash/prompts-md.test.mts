import assert from "node:assert/strict";
import { test } from "node:test";

import { promptsFileName, promptsMarkdown } from "./prompts-md.ts";

test("the Markdown file holds the title, the intro and every prompt verbatim under its own heading", () => {
  const md = promptsMarkdown({ title: "Household staff agency: homepage + internal links", intro: "Do 1 then 2.", prompts: [{ title: "Prompt 1: homepage", body: 'Change "A" to: B\n\n2. Next' }, { title: "Prompt 2", body: "Second" }] });
  assert.match(md, /^# Household staff agency: homepage \+ internal links\n\nDo 1 then 2\.\n\n## Prompt 1: homepage\n\n```text\nChange "A" to: B\n\n2\. Next\n```\n\n## Prompt 2\n\n```text\nSecond\n```\n$/);
});

test("a prompt that contains a code fence cannot close the file's own fence", () => {
  const md = promptsMarkdown({ title: "T", intro: null, prompts: [{ title: "P", body: "a\n```\nb\n```" }] });
  assert.match(md, /````text\na\n```\nb\n```\n````\n$/);
});

test("the file name is the title in lower-case words", () => {
  assert.equal(promptsFileName("Household staff agency: homepage + internal links"), "household-staff-agency-homepage-internal-links.md");
  assert.equal(promptsFileName("!!!"), "prompts.md");
});
