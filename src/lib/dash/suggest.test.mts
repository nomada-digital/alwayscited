import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { code } from "../source-read.mts";

/**
 * Suggest a change on the customer view (10 Nov 2026): agency staff on a view-as link only. A customer must never see
 * the button or reach the hub through it, so both doors are pinned here by their source.
 */
const read = (p: string) => code(readFileSync(new URL(p, import.meta.url), "utf8"));

test("the button is drawn only on a view-as page, never for a customer or a demo link", () => {
  const shell = read("../../components/dash/Shell.tsx");
  assert.match(shell, /\{viewAs \? <ViewAsSuggest slug=\{ws\.client\.slug\} \/> : null\}/);
  assert.equal(shell.match(/<ViewAsSuggest\b/g)?.length, 1, "drawn in one place");
});

test("the route sends nothing without a live view-as token for this client, and the staff email comes from the token", () => {
  const lib = read("./suggest.ts");
  assert.match(lib, /const view = viewPath\(p\.path\);\s*if \(!view \|\| view\.slug !== slug\) return \{ ok: false, status: 403/);
  assert.match(lib, /const v = await viewAs\(view\.token, slug\);\s*if \(!v\) return \{ ok: false, status: 403/);
  assert.match(lib, /by: v\.by,/, "who suggested it is the token's staff member, never a posted field");
  assert.doesNotMatch(lib, /dashEmail|sessionEmail/, "a customer's session is not a way in");
  assert.match(lib, /"\/view\/<token>\/"/, "the token never leaves in the URL");
  assert.match(lib, /HUB_SUGGEST = "https:\/\/qpsrvmnmtozvailsyqqz\.supabase\.co\/functions\/v1\/ac-suggest"/);
});
