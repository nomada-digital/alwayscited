/**
 * Links' own layout rules (13 Oct 2026, DIY P10): layout only, no colour
 * (palette.test.mts reads every hex in the tree). A React 19 hoisted
 * stylesheet, as Opportunities draws its own (OppStyle), so the page needs no
 * edit to globals.css.
 *
 * - A list row is three columns on a desktop and a stacked card below 860px,
 *   with nothing to scroll sideways at 320px; a long address wraps in its box.
 * - The figures strip wraps.
 * - The compare table and the 13-week table keep their columns and scroll
 *   inside their own box on a phone, never the page.
 */
const CSS = `
.lk-row { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1.6fr) minmax(150px, auto); gap: 8px 20px; align-items: start; }
@media (max-width: 860px) { .lk-row { grid-template-columns: minmax(0, 1fr); } }
.lk-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-start; justify-content: flex-end; }
@media (max-width: 860px) { .lk-actions { justify-content: flex-start; } }
.lk-url { overflow-wrap: anywhere; word-break: break-word; }
.lk-figs { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
.lk-scroll { overflow-x: auto; max-width: 100%; }
.lk-table { border-collapse: collapse; width: 100%; font-size: 14px; }
.lk-table th, .lk-table td { text-align: left; padding: 8px 10px; vertical-align: top; }
.lk-table td.num, .lk-table th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.lk-bar { display: inline-block; height: 10px; border-radius: 3px; vertical-align: middle; }
.lk-two { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; }
@media (max-width: 860px) { .lk-two { grid-template-columns: minmax(0, 1fr); } }
`;

export default function LinksStyle() {
  return (
    <style href="alwayscited-links" precedence="default">
      {CSS}
    </style>
  );
}
