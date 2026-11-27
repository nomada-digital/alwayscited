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
  const york = { code: 1007266, name: "York,York,England,United Kingdom" };
  const leeds = { code: 1006864, name: "Leeds,West Yorkshire,England,United Kingdom" };
  assert.deepEqual(whereFor({ keyword: "craft cms agency york", market: "UK", countryCode: UK, override: leeds, clientDefault: york }).source, "keyword");
  assert.equal(whereFor({ keyword: "craft cms agency york", market: "UK", countryCode: UK, clientDefault: leeds }).code, 1007266);
  assert.equal(whereFor({ keyword: "craft cms agency", market: "UK", countryCode: UK, clientDefault: leeds }).code, 1006864);
  assert.deepEqual(whereFor({ keyword: "craft cms agency", market: "UK", countryCode: UK }), { code: UK, name: null, source: "market" });
});
test("labels and settings", () => {
  assert.equal(placeLabel("York,York,England,United Kingdom"), "York");
  assert.equal(placeLabel(null), null);
  assert.equal(placeFrom({ code: 1007266 })?.name, "York,York,England,United Kingdom");
  assert.equal(placeFrom({ name: "Leeds" })?.code, 1006864);
  assert.equal(placeFrom({ name: "Atlantis" }), null);
});

test("every place's stored name is the one DataForSEO lists for its code (checked 27 Nov 2026)", async () => {
  const { UK_PLACES } = await import("./locations.ts");
  const real: Record<number, string> = {
    1006524: "Birmingham,West Midlands,England,United Kingdom", 1006553: "Bradford,Bradford,England,United Kingdom", 1006565: "Brighton,England,United Kingdom",
    1006567: "Bristol,England,United Kingdom", 1006598: "Cambridge,Cambridge,England,United Kingdom", 1006766: "Harrogate,England,United Kingdom",
    1006864: "Leeds,West Yorkshire,England,United Kingdom", 1006867: "Leicester,Leicester,England,United Kingdom", 1006884: "Liverpool,England,United Kingdom",
    1006886: "London,England,United Kingdom", 1006912: "Manchester,Manchester,England,United Kingdom", 1006948: "Newcastle upon Tyne,Newcastle upon Tyne,England,United Kingdom",
    1006964: "Norwich,Norwich,England,United Kingdom", 1006965: "Nottingham,Nottingham,England,United Kingdom", 1006976: "Oxford,Oxford,England,United Kingdom",
    1007064: "Sheffield,South Yorkshire,England,United Kingdom", 1007188: "Wakefield,Wakefield,England,United Kingdom", 1007266: "York,York,England,United Kingdom",
    1007274: "Belfast,Northern Ireland,United Kingdom", 1007326: "Edinburgh,Scotland,United Kingdom", 1007336: "Glasgow,Scotland,United Kingdom", 1007416: "Cardiff,Wales,United Kingdom",
  };
  for (const [word, p] of Object.entries(UK_PLACES)) assert.equal(p.name, real[p.code], `${word} (${p.code})`);
});
