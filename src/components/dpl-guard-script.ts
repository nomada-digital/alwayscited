/**
 * Keeps the deployment id on <html> until Next has read it (13 Oct 2026).
 *
 * Vercel builds with a deployment id. Next's server writes it to
 * `<html data-dpl-id>`; the browser's copy of Next reads that attribute once,
 * when its runtime starts, deletes it, and from then on compares it with the
 * `x-nextjs-deployment-id` header on every navigation response. A mismatch
 * means "the site was redeployed under you", and Next answers it with a full
 * page load instead of a client-side navigation
 * (node_modules/next/dist/docs/01-app/03-api-reference/05-config/
 * 01-next-config-js/deploymentId.md, "How it works").
 *
 * In Danny's Chrome on 13 Oct the attribute was gone before Next read it: his
 * navigation requests carried no `x-deployment-id` header, every response's
 * header therefore mismatched, and every dashboard click was a full reload of
 * about 2.3 s. The same pages in a clean Chromium, and in one with his Wingify
 * extension loaded, sent the header and navigated in place. Something else in
 * that browser - most likely one of its other extensions - removes the
 * attribute; which one was not identified. The cure does not need to know.
 *
 * This runs inline in <head>, before Next's runtime evaluates: Next's chunks
 * are `async`, and its entry only evaluates once they have all arrived. It
 * puts the attribute back if it is missing, and for ten seconds puts it back
 * whenever anything removes it - a MutationObserver callback runs at the next
 * microtask checkpoint, so before any later script. Next's own delete is
 * restored too, which is harmless: <html> carries suppressHydrationWarning,
 * and Next has its copy by then.
 *
 * The id is checked against DPL_ID before it is written into a script, so a
 * value that is not a plain id renders nothing rather than markup.
 */

/** What a Vercel deployment id looks like: `dpl_` and letters or digits. */
export const DPL_ID = /^dpl_[A-Za-z0-9]{8,64}$/;

/** How long the guard watches, in ms. Next's runtime starts well inside it. */
export const DPL_GUARD_MS = 10_000;

/** The inline script for this deployment, or null when there is no usable id. */
export function dplGuardScript(id: unknown): string | null {
  if (typeof id !== "string" || !DPL_ID.test(id)) return null;
  return `(function(){
var r=document.documentElement,id=${JSON.stringify(id)};
function put(){if(r.getAttribute('data-dpl-id')!==id)r.setAttribute('data-dpl-id',id)}
put();
try{var mo=new MutationObserver(put);mo.observe(r,{attributes:true,attributeFilter:['data-dpl-id']});setTimeout(function(){mo.disconnect()},${DPL_GUARD_MS})}catch(e){}
})();`;
}
