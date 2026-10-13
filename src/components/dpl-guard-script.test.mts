import assert from "node:assert/strict";
import { test } from "node:test";

import { DPL_GUARD_MS, DPL_ID, dplGuardScript } from "./dpl-guard-script.ts";

/**
 * The deployment-id guard, executed (13 Oct 2026; see ./dpl-guard-script.ts).
 *
 * Run as a string against a fake <html> that implements only what the script
 * touches, as motion-script.test.mts does, so a change that reaches for
 * something else fails here rather than in a browser.
 */

const ID = "dpl_4LJusMAE2BvZRDDyaMdmRTXNxwJU";

type Run = {
  attrs: Map<string, string>;
  /** Removes the attribute as an outside script would, then flushes observers. */
  strip(): void;
  /** Fires the scheduled disconnect. */
  expire(): void;
  timeouts: number[];
  observed: { attributeFilter?: string[] } | null;
};

function run(script: string, initial: Record<string, string>): Run {
  const attrs = new Map(Object.entries(initial));
  let callback: (() => void) | null = null;
  let connected = false;
  let observed: Run["observed"] = null;
  const timers: Array<() => void> = [];
  const timeouts: number[] = [];
  const html = {
    getAttribute: (k: string) => (attrs.has(k) ? attrs.get(k)! : null),
    setAttribute: (k: string, v: string) => {
      attrs.set(k, v);
    },
  };
  class FakeObserver {
    constructor(cb: () => void) {
      callback = cb;
    }
    observe(target: unknown, o: { attributeFilter?: string[] }) {
      assert.equal(target, html);
      observed = o;
      connected = true;
    }
    disconnect() {
      connected = false;
    }
  }
  const fn = new Function("document", "MutationObserver", "setTimeout", script);
  fn({ documentElement: html }, FakeObserver, (f: () => void, ms: number) => {
    timers.push(f);
    timeouts.push(ms);
  });
  return {
    attrs,
    strip() {
      attrs.delete("data-dpl-id");
      if (connected && callback) callback();
    },
    expire() {
      for (const t of timers) t();
    },
    timeouts,
    get observed() {
      return observed;
    },
  };
}

test("no usable id renders nothing: unset, false (a build without one), or not a deployment id", () => {
  assert.equal(dplGuardScript(undefined), null);
  assert.equal(dplGuardScript(false), null);
  assert.equal(dplGuardScript(""), null);
  assert.equal(dplGuardScript("dpl_x"), null);
  assert.equal(dplGuardScript(`dpl_abcdefgh"</script><script>alert(1)//`), null);
  assert.ok(DPL_ID.test(ID));
});

test("the attribute already there is left as it is", () => {
  const r = run(dplGuardScript(ID)!, { "data-dpl-id": ID, lang: "en-GB" });
  assert.equal(r.attrs.get("data-dpl-id"), ID);
  assert.equal(r.attrs.get("lang"), "en-GB");
});

test("stripped before the script ran: put back", () => {
  const r = run(dplGuardScript(ID)!, { lang: "en-GB" });
  assert.equal(r.attrs.get("data-dpl-id"), ID);
});

test("stripped after the script ran, inside the window: put back, watching that attribute only", () => {
  const r = run(dplGuardScript(ID)!, { "data-dpl-id": ID });
  assert.deepEqual(r.observed?.attributeFilter, ["data-dpl-id"]);
  r.strip();
  assert.equal(r.attrs.get("data-dpl-id"), ID);
  r.strip();
  assert.equal(r.attrs.get("data-dpl-id"), ID);
});

test("after the window it stops watching", () => {
  const r = run(dplGuardScript(ID)!, { "data-dpl-id": ID });
  assert.deepEqual(r.timeouts, [DPL_GUARD_MS]);
  r.expire();
  r.strip();
  assert.equal(r.attrs.has("data-dpl-id"), false);
});

test("a browser without MutationObserver still gets the attribute put back once", () => {
  const attrs = new Map<string, string>();
  const html = { getAttribute: (k: string) => attrs.get(k) ?? null, setAttribute: (k: string, v: string) => void attrs.set(k, v) };
  const fn = new Function("document", "MutationObserver", "setTimeout", dplGuardScript(ID)!);
  assert.doesNotThrow(() => fn({ documentElement: html }, undefined, () => {}));
  assert.equal(attrs.get("data-dpl-id"), ID);
});
