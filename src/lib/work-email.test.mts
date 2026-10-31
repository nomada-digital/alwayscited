import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { isWorkEmail, parseBlockedExtra, WORK_EMAIL_REFUSAL } from "./work-email.ts";

/**
 * Work email only, on every public submission (Danny, 8 Oct 2026): the
 * validator as a table, then the census of which handlers call it.
 */

// ------------------------------------------------------------- the function

const REFUSED = [
  // consumer
  "test@gmail.com", "a@googlemail.com", "a@icloud.com", "a@me.com", "a@mac.com", "a@aol.com", "a@aim.com",
  "a@msn.com", "a@proton.me", "a@protonmail.com", "a@pm.me", "a@mail.com", "a@zoho.com", "a@zohomail.com",
  "a@tutanota.com", "a@tuta.io", "a@fastmail.com", "a@hey.com", "a@duck.com", "a@qq.com", "a@163.com",
  "a@126.com", "a@naver.com", "a@mail.ru", "a@ymail.com", "a@rocketmail.com", "a@web.de",
  // a provider under any country suffix
  "a@hotmail.com", "a@hotmail.co.uk", "a@outlook.com", "a@outlook.com.br", "a@live.com", "a@live.co.uk",
  "a@live.com.au", "a@yahoo.com", "a@yahoo.fr", "a@yahoo.co.jp", "a@gmx.de", "a@gmx.net", "a@yandex.ru",
  // UK and US ISP mail
  "a@btinternet.com", "a@sky.com", "a@virginmedia.com", "a@talktalk.net", "a@ntlworld.com",
  "a@blueyonder.co.uk", "a@comcast.net", "a@verizon.net", "a@att.net", "a@sbcglobal.net", "a@cox.net",
  "a@charter.net", "a@earthlink.net",
  // disposable
  "a@mailinator.com", "a@guerrillamail.com", "a@sharklasers.com", "a@10minutemail.com", "a@temp-mail.org",
  "a@yopmail.com", "a@trashmail.com", "a@getnada.com", "a@dispostable.com", "a@maildrop.cc",
  // case and whitespace do not get a personal address through
  "Test@GMAIL.com", "  name@Hotmail.co.uk  ",
  // not an address at all
  "", "name", "name@company", "a@b@company.com",
];

const ACCEPTED = [
  "name@company.co.uk",
  "name@sub.company.com",
  "NAME@Company.CO.UK",
  "  name@company.com  ",
  "danny@nomadadigital.co.uk",
  // a company's own subdomain that happens to start with a provider's name
  "name@outlook.company.com",
  "name@live.company.co.uk",
  // web.com is a company, so `web` is not a provider rule; web.de is listed whole
  "name@web.com",
  // a provider name inside a longer label is a different domain
  "name@gmailer.com",
  "name@yahooligans-agency.com",
];

test("personal, ISP and disposable addresses are refused", () => {
  for (const a of REFUSED) assert.equal(isWorkEmail(a), false, a);
});

test("a company address is accepted, whatever its case or padding", () => {
  for (const a of ACCEPTED) assert.equal(isWorkEmail(a), true, a);
});

test("a domain on the app_settings list is refused on top of the built-in list", () => {
  assert.equal(isWorkEmail("name@acme-mail.com"), true);
  assert.equal(isWorkEmail("name@acme-mail.com", ["acme-mail.com"]), false);
  assert.equal(isWorkEmail("NAME@Acme-Mail.com", parseBlockedExtra(" Acme-Mail.com, ,other.org")), false);
  assert.equal(isWorkEmail("name@company.com", parseBlockedExtra("acme-mail.com")), true);
});

test("the stored list parses from comma-separated text, and fails safe on anything else", () => {
  assert.deepEqual(parseBlockedExtra(""), []);
  assert.deepEqual(parseBlockedExtra("a.com, B.com ,a.com,@c.org"), ["a.com", "b.com", "c.org"]);
  assert.deepEqual(parseBlockedExtra(["x.com", 3, " Y.com"]), ["x.com", "y.com"]);
  assert.deepEqual(parseBlockedExtra(null), []);
  assert.deepEqual(parseBlockedExtra(42), []);
});

test("the refusal is Danny's sentence, with a hyphen and not a dash", () => {
  assert.equal(WORK_EMAIL_REFUSAL, "Use your work email - we don't accept Gmail, Outlook or other personal addresses.");
  assert.doesNotMatch(WORK_EMAIL_REFUSAL, /[–—]/);
});

// ------------------------------------------------------------- the census

/**
 * Every public handler that takes an email from a visitor calls isWorkEmail,
 * with the app_settings extra list.
 *
 * The population is derived, not listed: a route handler or a "use server"
 * file under src/app that reads an email off the request. The /app and /admin
 * trees are outside it by path - the dashboard login and team invites are for
 * members, who keep signing in with whatever address they have, and /admin is
 * Danny's. Checkout is the one exemption: a buyer can pay with any address.
 */
const APP = new URL("../app/", import.meta.url).pathname;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const HANDLERS = walk(APP)
  .filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f))
  .map((f) => ({ file: f.slice(APP.length), source: code(readFileSync(f, "utf8")) }))
  .filter(({ file }) => !/^(app|api\/app|admin)\//.test(file))
  .filter(({ file, source }) => /(^|\/)route\.ts$/.test(file) || /^\s*["']use server["']/.test(source))
  .filter(({ source }) => /isPlausibleEmail|get\(\s*["']email["']\s*\)|\b(body|input)\.email\b/.test(source));

// 22 Oct 2026: api/hub/offer takes no visitor's address - the agency hub sends its own client's login, server to
// server behind HUB_OFFER_SECRET, to prefill that client's Checkout - so the work-email rule has nothing to judge.
// 31 Oct 2026: api/checkout/offer/[token] is a checkout, as api/checkout is - the client on a signed agreement chooses
// the address they will sign in with, and only someone holding their private link reaches it.
const EXEMPT = ["api/checkout/route.ts", "api/hub/offer/route.ts", "api/checkout/offer/[token]/route.ts"];

const KNOWN = [
  "contact/actions.ts",
  "actions/waitlist.ts",
  "api/walkthrough/route.ts",
  "api/scan/[token]/walkthrough/route.ts",
  "api/scan/[token]/email-report/route.ts",
];

test("the census finds the handlers it is about", () => {
  // The floor. A matcher that stops matching reports a clean tree.
  assert.ok(HANDLERS.length >= 6, `only ${HANDLERS.length} email handlers were found`);
  const found = HANDLERS.map((h) => h.file);
  for (const k of [...KNOWN, ...EXEMPT]) assert.ok(found.includes(k), `the census cannot see ${k}`);
});

test("every public email handler refuses a personal address, except checkout", () => {
  const missing = HANDLERS.filter(({ file }) => !EXEMPT.includes(file))
    .filter(({ source }) => !/isWorkEmail\([^)]*await workEmailBlockedExtra\(\)\s*\)/.test(source))
    .map(({ file }) => file);
  assert.deepEqual(missing, [], "these take a visitor's email without isWorkEmail(email, await workEmailBlockedExtra())");
});

test("checkout keeps taking any plausible address, and does not promise a work email", () => {
  for (const file of EXEMPT) {
    const h = HANDLERS.find((x) => x.file === file);
    assert.ok(h, file);
    assert.doesNotMatch(h.source, /isWorkEmail/, `${file} is exempt and must not refuse a personal address`);
  }
  const SRC = new URL("../", import.meta.url).pathname;
  for (const f of ["components/checkout/CheckoutOrder.tsx", "lib/checkout/session.ts", "app/api/checkout/route.ts"]) {
    const s = readFileSync(join(SRC, f), "utf8");
    assert.doesNotMatch(s, /isWorkEmail/, f);
    assert.doesNotMatch(code(s), /work email/i, `${f} says "work email" on a door that takes any address`);
  }
});

test("the forms with script run the same check before they post", () => {
  const SRC = new URL("../", import.meta.url).pathname;
  for (const f of ["components/scan/RequestScanForm.tsx", "components/scan/WalkthroughForm.tsx", "components/scan/ScanFlow.tsx"]) {
    assert.match(code(readFileSync(join(SRC, f), "utf8")), /isWorkEmail\(/, f);
  }
});
