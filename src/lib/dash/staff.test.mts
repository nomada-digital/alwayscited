import assert from "node:assert/strict";
import { test } from "node:test";

import { hubCustomerView, isStaffEmail } from "./staff.ts";

test("only a Nomada staff address goes to the hub's view; a slug that is not one goes nowhere", () => {
  assert.equal(isStaffEmail("danny@nomadadigital.co.uk"), true);
  assert.equal(isStaffEmail("Danny@NomadaDigital.co.uk"), true);
  assert.equal(isStaffEmail("info@alistairmacphotography.com"), false);
  assert.equal(isStaffEmail("x@nomadadigital.co.uk.evil.com"), false);
  assert.equal(isStaffEmail(null), false);
  assert.equal(hubCustomerView("alistairmacphotography-com"), "https://dashboards.nomadadigital.co.uk/ac/alistairmacphotography-com#customer");
  assert.equal(hubCustomerView("../admin"), null);
});
