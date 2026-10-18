import assert from "node:assert/strict";
import { test } from "node:test";

import { type ActivationInput, activationShown, activationSteps } from "./activation.ts";
import { checkTime } from "./check-time.ts";
import { YOUNG_RANGE_DAYS } from "./date-range.ts";
import { addDays } from "./figures.ts";

/**
 * ON-3 (9 Oct 2026, launch blocker LB8): the Overview's activation checklist.
 * Who sees it, what each step reads as done, and what it says to whom - an
 * owner is sent to invite, anyone else told who can - with the check times
 * check-time.ts words, never typed.
 */

const today = "2026-10-09";
const now = Date.parse("2026-10-09T12:00:00Z");

test("shown in the trial or the first weeks, never to an ended client", () => {
  const at = (o: Partial<Parameters<typeof activationShown>[0]>) => activationShown({ status: "active", startedOn: "2026-06-01", today, trialEndsAt: null, now, ...o });
  assert.equal(at({}), false, "an older client off any trial");
  assert.equal(at({ trialEndsAt: "2026-10-20T10:00:00Z" }), true, "in its trial");
  assert.equal(at({ trialEndsAt: "2026-10-01T10:00:00Z" }), false, "a trial that has ended");
  assert.equal(at({ startedOn: addDays(today, -(YOUNG_RANGE_DAYS - 1)) }), true, "inside its first weeks");
  assert.equal(at({ startedOn: addDays(today, -YOUNG_RANGE_DAYS) }), false, "the day the first weeks are over");
  assert.equal(at({ startedOn: addDays(today, 1) }), true, "day zero");
  assert.equal(at({ startedOn: null }), true, "not started");
  assert.equal(at({ status: "ended", trialEndsAt: "2026-10-20T10:00:00Z", startedOn: today }), false, "ended is read-only, and has nothing left to do");
});

const base: ActivationInput = {
  slug: "acme",
  role: "owner",
  market: "UK",
  today,
  startedOn: "2026-10-05",
  confirmed: true,
  setupNeeded: true,
  firstRead: true,
  livePrompts: 5,
  members: [
    { email: "owner@example.com", role: "owner" },
    { email: "ed@example.com", role: "editor" },
  ],
  reportOpened: true,
};

test("gone once every step is done; otherwise four steps in order, each linked to where it is done", () => {
  assert.equal(activationSteps(base), null);
  const s = activationSteps({ ...base, reportOpened: false })!;
  assert.deepEqual(s.map((x) => [x.id, x.done]), [["setup", true], ["first", true], ["invite", true], ["report", false]]);
  assert.deepEqual(s.map((x) => x.href), ["/app/acme/setup", "/app/acme/clusters", "/app/acme/settings#set-team", "/app/acme/reports"]);
});

test("setup: confirmed, or set up by hand before the setup page; an editor finishes it, a viewer is told who does", () => {
  const not = { ...base, confirmed: false, reportOpened: false };
  assert.equal(activationSteps(not)![0]!.done, false);
  assert.equal(activationSteps(not)![0]!.link, "Go to setup");
  assert.equal(activationSteps({ ...not, role: "editor" })![0]!.link, "Go to setup");
  assert.match(activationSteps({ ...not, role: "viewer" })![0]!.detail, /An owner or editor/);
  assert.equal(activationSteps({ ...not, confirmed: null, setupNeeded: false })![0]!.done, true, "set up by hand");
  assert.equal(activationSteps({ ...not, confirmed: null })![0]!.done, false, "an unread confirm is not a done one");
});

test("the first check: what is read, or when it runs, in the client's zone; with no prompt, nothing is promised", () => {
  const waiting = { ...base, firstRead: false };
  const day0 = activationSteps({ ...waiting, startedOn: addDays(today, 1) })![1]!;
  assert.equal(day0.detail, `The first check runs tomorrow at ${checkTime(addDays(today, 1), "UK")}.`);
  assert.equal(day0.link, "Go to Clusters");
  const later = activationSteps(waiting)![1]!;
  assert.equal(later.detail, `The next check runs tomorrow at ${checkTime(addDays(today, 1), "UK")}.`);
  const none = activationSteps({ ...waiting, livePrompts: 0 })![1]!;
  assert.match(none.detail, /^Nothing is checked until a cluster has prompts\./);
  assert.deepEqual([none.href, none.link], ["/app/acme/setup", "Add prompts"]);
  assert.equal(activationSteps({ ...waiting, market: "US", startedOn: addDays(today, 1) })![1]!.detail, `The first check runs tomorrow at ${checkTime(addDays(today, 1), "US")}.`);
});

test("invite: more than one person on this client; an owner is sent to invite, anyone else told which owner can", () => {
  const alone = { ...base, members: [{ email: "owner@example.com", role: "owner" }], reportOpened: false };
  const own = activationSteps(alone)![2]!;
  assert.deepEqual([own.done, own.href, own.link], [false, "/app/acme/settings#set-invite", "Invite someone"]);
  const viewer = activationSteps({ ...alone, role: "viewer", members: [{ email: "owner@example.com", role: "owner" }, { email: "v@example.com", role: "viewer" }] })![2]!;
  assert.equal(viewer.done, true, "the viewer is the teammate");
  const editor = activationSteps({ ...alone, role: "editor", members: [{ email: "ed@example.com", role: "editor" }] })![2]!;
  assert.equal(editor.detail, "Only an owner can invite.");
  assert.equal(editor.href, "/app/acme/settings#set-team");
  const scoped = activationSteps({ ...alone, role: "editor", members: [{ email: "boss@example.com", role: "owner" }] })![2]!;
  assert.equal(scoped.detail, "Only an owner can invite: ask boss@example.com.");
});

// 18 Oct 2026, brief 2d: "census: the Overview draws the list only for a client it is for" retired with /app -
// it held the /app Overview page and components/app/Activation.tsx, both gone; every /app address 308s to the
// dashboards host, which draws no activation checklist. activation.ts's own rules above still hold.
