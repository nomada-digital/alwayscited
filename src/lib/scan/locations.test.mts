import assert from "node:assert/strict";
import test from "node:test";

import { placeFrom, placeIn, placeLabel, whereFor } from "./locations.ts";

const UK = 2826;
test("a keyword that names a place is read for that place", () => {
  assert.equal(placeIn("craft cms agency york", "UK")?.place.code, 1007266);
  assert.equal(placeIn("craft cms agency yorkshire", "UK")?.place.code, 1007266, "Yorkshire is read from York");
  assert.equal(placeIn("web design leeds", "UK")?.place.code, 1006864);
  assert.equal(placeIn("Wedding Photographer in Sheffield", "UK")?.place.code, 1007064);
  assert.equal(placeIn("north yorkshire web agency", "UK")?.word, "north yorkshire");
});
test("a place is a whole word, new york is not York, and only the UK market reads places", () => {
  assert.equal(placeIn("yorkie training", "UK"), null);
  assert.equal(placeIn("new york craft cms agency", "UK"), null);
  assert.equal(placeIn("craft cms agency uk", "UK"), null);
  assert.equal(placeIn("craft cms agency york", "US"), null);
});
test("precedence: the keyword's own override, then a named place, then the client's default, then the country", () => {
  const york = { code: 1007266, name: "York,England,United Kingdom" };
  const leeds = { code: 1006864, name: "Leeds,West Yorkshire,England,United Kingdom" };
  assert.deepEqual(whereFor({ keyword: "craft cms agency york", market: "UK", countryCode: UK, override: leeds, clientDefault: york }).source, "keyword");
  assert.equal(whereFor({ keyword: "craft cms agency york", market: "UK", countryCode: UK, clientDefault: leeds }).code, 1007266);
  assert.equal(whereFor({ keyword: "craft cms agency", market: "UK", countryCode: UK, clientDefault: leeds }).code, 1006864);
  assert.deepEqual(whereFor({ keyword: "craft cms agency", market: "UK", countryCode: UK }), { code: UK, name: null, source: "market" });
});
test("labels and settings", () => {
  assert.equal(placeLabel("York,England,United Kingdom"), "York");
  assert.equal(placeLabel(null), null);
  assert.equal(placeFrom({ code: 1007266 })?.name, "York,England,United Kingdom");
  assert.equal(placeFrom({ name: "Leeds" })?.code, 1006864);
  assert.equal(placeFrom({ name: "Atlantis" }), null);
});
