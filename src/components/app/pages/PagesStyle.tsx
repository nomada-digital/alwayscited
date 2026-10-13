/**
 * Your pages' own layout rules (13 Oct 2026, DIY P8): layout only, no colour
 * (palette.test.mts reads every hex in the tree; the colours are the tokens,
 * inline). A React 19 hoisted stylesheet - `href` and `precedence` - so the
 * list and the detail page each draw it and the page carries it once, with no
 * edit to globals.css, which other packages of the wave are editing.
 *
 * - A table stacks into one card per row below 760px: each cell on its own
 *   line with its label, the row's name first. The key pages table (`yp-wide`)
 *   stacks below 1100px, where the dashboard's sidebar leaves it too little
 *   room; above that it scrolls inside its own box if it must, never the page.
 * - A code block scrolls inside its own box; the page never scrolls sideways.
 * - A grade chip's source and date show on hover and focus, and always on a
 *   phone, under the chip.
 * - Now and Example sit side by side above 760px, one above the other below.
 */
const CSS = `
.yp-table { width: 100%; border-collapse: collapse; font-size: 14px; }
.yp-table th { text-align: left; font-size: 12px; font-weight: 600; padding: 10px 12px; white-space: nowrap; }
.yp-table td { padding: 12px; vertical-align: top; }
.yp-table td[data-label]::before { content: none; }
.yp-wrap { overflow-x: auto; max-width: 100%; }
@media (max-width: 1099px) {
  .yp-wide thead { display: none; }
  .yp-wide, .yp-wide tbody, .yp-wide tr { display: block; width: 100%; }
  .yp-wide tr { padding: 12px 14px; box-sizing: border-box; }
  .yp-wide td { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; padding: 5px 0; text-align: right; }
  .yp-wide td:first-child { display: block; text-align: left; padding-bottom: 8px; }
  .yp-wide td[data-label]::before { content: attr(data-label); font-size: 12px; font-weight: 600; text-align: left; flex: 0 1 auto; max-width: 50%; }
  .yp-wide td:first-child::before { content: none; }
}
@media (max-width: 759px) {
  .yp-table thead { display: none; }
  .yp-table, .yp-table tbody, .yp-table tr { display: block; width: 100%; }
  .yp-table tr { padding: 12px 14px; box-sizing: border-box; }
  .yp-table td { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; padding: 5px 0; text-align: right; }
  .yp-table td:first-child { display: block; text-align: left; padding-bottom: 8px; }
  .yp-table td[data-label]::before { content: attr(data-label); font-size: 12px; font-weight: 600; text-align: left; flex: 0 1 auto; max-width: 50%; }
  .yp-table td:first-child::before { content: none; }
  .yp-table th[scope=row] { display: block; padding: 0 0 2px; width: auto; }
}
.yp-code { margin: 0; padding: 14px 16px; overflow-x: auto; max-width: 100%; box-sizing: border-box; font-size: 12.5px; line-height: 1.55; white-space: pre; border-radius: 12px; }
.yp-chip-note { display: none; }
.yp-chip:hover + .yp-chip-note, .yp-chip:focus + .yp-chip-note { display: block; }
@media (max-width: 639px) { .yp-chip-note { display: block; } }
.yp-side { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
@media (max-width: 759px) { .yp-side { grid-template-columns: minmax(0, 1fr); } }
.yp-diag { width: 100%; border-collapse: collapse; font-size: 13px; }
.yp-diag th, .yp-diag td { padding: 8px 10px; text-align: left; vertical-align: top; }
.yp-scroll { overflow-x: auto; max-width: 100%; }
.yp-tabs { display: flex; gap: 8px; flex-wrap: wrap; }
.yp-break { overflow-wrap: anywhere; }
`;

export default function PagesStyle() {
  return (
    <style href="alwayscited-your-pages" precedence="default">
      {CSS}
    </style>
  );
}
