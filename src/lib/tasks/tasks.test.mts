import assert from "node:assert/strict";
import test from "node:test";

import { extractTarget, norm, verdict } from "./check.ts";
import { taskEmail } from "./email.ts";
import { TEMPLATES, buildCustom, buildFromTemplate, ownPageUrl, readSteps } from "./templates.ts";

const ctx = { slug: "mortalentboutique-com", domain: "mortalentboutique.com", dashboard: "https://dashboards.alwayscited.com/mortalentboutique-com", accessEmail: "team@nomadadigital.co.uk" };

test("page checks only fetch the customer's own https pages", () => {
  assert.ok(ownPageUrl("https://www.mortalentboutique.com/", "mortalentboutique.com"));
  assert.ok(ownPageUrl("https://mortalentboutique.com/a#x", "mortalentboutique.com")?.endsWith("/a"));
  assert.equal(ownPageUrl("http://mortalentboutique.com/", "mortalentboutique.com"), null);
  assert.equal(ownPageUrl("https://evil.com/", "mortalentboutique.com"), null);
  assert.equal(ownPageUrl("https://mortalentboutique.com.evil.com/", "mortalentboutique.com"), null);
  assert.equal(ownPageUrl("https://a@mortalentboutique.com/", "mortalentboutique.com"), null);
  assert.equal(ownPageUrl("https://mortalentboutique.com:8443/", "mortalentboutique.com"), null);
});

test("heading task carries the exact before and after, and checks itself", () => {
  const t = buildFromTemplate("page_heading", { url: "https://www.mortalentboutique.com/", target: "h1", before: "Senior household staff for UHNW homes", after: "Boutique private staff recruitment for UHNW homes" }, ctx);
  assert.ok(typeof t !== "string");
  if (typeof t === "string") return;
  assert.equal(t.kind, "page_check");
  assert.match(t.title, /main heading \(H1\) on your homepage/);
  assert.ok(t.steps.some((s) => s.text.includes("Senior household staff for UHNW homes")));
  assert.ok(t.steps.some((s) => s.text.includes("Boutique private staff recruitment for UHNW homes")));
  assert.equal(typeof buildFromTemplate("page_heading", { url: "https://evil.com/", before: "a", after: "b" }, ctx), "string");
  assert.equal(typeof buildFromTemplate("page_heading", { url: "https://www.mortalentboutique.com/", before: "a", after: "a" }, ctx), "string");
});

test("every template builds without input that is not needed", () => {
  for (const id of ["connect_gsc", "connect_ga4", "chatgpt_listing", "internal_links"]) {
    const t = buildFromTemplate(id, {}, ctx);
    assert.ok(typeof t !== "string", id);
    if (typeof t !== "string") { assert.ok(t.steps.length >= 3); assert.ok(t.why.length > 10); }
  }
  assert.equal(TEMPLATES.length, 5);
  assert.equal(typeof buildFromTemplate("nope", {}, ctx), "string");
  const gsc = buildFromTemplate("connect_gsc", {}, ctx);
  assert.ok(typeof gsc !== "string" && gsc.kind === "connect_gsc" && gsc.steps[0]?.href?.endsWith("/integrations"));
  const links = buildFromTemplate("internal_links", {}, ctx);
  assert.ok(typeof links !== "string" && links.steps[0]?.href?.endsWith("/prompts"));
});

test("custom tasks are bounded and links must be https", () => {
  const ok = buildCustom({ title: "Send us your logo", why: "For the report.", steps: "Find the file\nEmail it | https://example.com/x" });
  assert.ok(typeof ok !== "string" && ok.steps.length === 2 && ok.steps[1]?.href === "https://example.com/x");
  assert.equal(typeof buildCustom({ title: "x", steps: "a" }), "string");
  assert.equal(typeof buildCustom({ title: "Fine title", steps: "" }), "string");
  assert.equal(typeof buildCustom({ title: "Fine title", steps: "a | javascript:alert(1)" }), "string");
});

test("stored steps keep only safe links and images", () => {
  const s = readSteps([{ text: "a", href: "javascript:x" }, { text: "b", href: "https://a.test" }, { text: "c", img: "//evil.com/x.png" }, { text: "d", img: "/tasks/x.png" }, { nope: 1 }]);
  assert.deepEqual(s.map((x) => [x.href ?? null, x.img ?? null]), [[null, null], ["https://a.test", null], [null, null], [null, "/tasks/x.png"]]);
});

test("the live check reads the h1 and the title", () => {
  const html = `<html><head><title>MOR &amp; Co | Home</title></head><body><h1 class="x">Boutique private staff <em>recruitment</em> for UHNW homes</h1></body></html>`;
  assert.equal(extractTarget(html, "h1"), "Boutique private staff recruitment for UHNW homes");
  assert.equal(extractTarget(html, "title"), "MOR & Co | Home");
  assert.equal(verdict(html, "h1", "Boutique private staff recruitment for UHNW homes").ok, true);
  assert.equal(verdict(html, "h1", "Boutique  Private Staff Recruitment for UHNW homes ").ok, true);
  const old = verdict(`<h1>Senior household staff for UHNW homes</h1>`, "h1", "Boutique private staff recruitment for UHNW homes");
  assert.equal(old.ok, false);
  assert.match(old.note, /still reads "Senior household staff/);
  assert.equal(verdict("<p>none</p>", "h1", "x").ok, false);
  assert.equal(norm("It’s – fine"), "it's - fine");
});

test("the notification says how many, links to the tasks and is signed by the lead", () => {
  const one = taskEmail({ n: 1, slug: "a-b", firstName: "Michael", lead: "Kev" });
  assert.equal(one.subject, "We've added a task to your dashboard");
  const four = taskEmail({ n: 4, slug: "a-b", firstName: null, lead: "Kev" });
  assert.equal(four.subject, "We've added 4 tasks to your dashboard");
  assert.match(four.text, /^Hi there,/);
  assert.match(four.text, /https:\/\/dashboards\.alwayscited\.com\/a-b\/tasks/);
  assert.match(four.html, /Open your tasks/);
  assert.match(four.text, /Cheers\nKev$/);
  assert.equal(four.fromName, "Kev @ alwayscited");
  assert.ok(!/<script/i.test(taskEmail({ n: 2, slug: "x", firstName: "<script>", lead: "<b>" }).html));
});
