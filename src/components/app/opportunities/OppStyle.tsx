/**
 * Opportunities' own layout rules (13 Oct 2026, DIY P7): layout only, no
 * colour (palette.test.mts reads every hex in the tree). A React 19 hoisted
 * stylesheet - `href` and `precedence` - so the list, the detail page and
 * Cited pages can each draw it and a page carries it once, with no edit to
 * globals.css, which other packages of the wave are editing.
 *
 * - A row is a table row on a desktop (three columns) and a stacked card
 *   below 860px, with nothing to scroll sideways at 320px.
 * - The detail page is two columns from 980px, one below.
 * - A grade chip's source and date show on hover and focus, and always on a
 *   phone, as Actions' do.
 * - The pitch outline wraps; a long address scrolls inside its own box.
 * - Cited pages' Kind and Page type columns fold into a line under the page
 *   below 1100px, and the table keeps its five columns there.
 */
const CSS = `
.opp-row { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1.7fr) minmax(176px, auto); gap: 8px 20px; align-items: start; }
@media (max-width: 860px) { .opp-row { grid-template-columns: minmax(0, 1fr); } }
.opp-detail { display: grid; grid-template-columns: minmax(0, 7fr) minmax(0, 5fr); gap: 20px; align-items: start; }
@media (max-width: 980px) { .opp-detail { grid-template-columns: minmax(0, 1fr); } }
.opp-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-start; justify-content: flex-end; }
@media (max-width: 860px) { .opp-actions { justify-content: flex-start; } }
.opp-chip-note { display: none; }
.opp-chip:hover + .opp-chip-note, .opp-chip:focus + .opp-chip-note { display: block; }
@media (max-width: 639px) { .opp-chip-note { display: block; } }
.opp-pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-family: inherit; }
.opp-url { overflow-wrap: anywhere; word-break: break-word; }
.opp-reasons[open] > summary { margin-bottom: 8px; }
.opp-ct-inline { display: none; }
@media (max-width: 1100px) { .opp-ct-col { display: none !important; } .opp-ct-inline { display: block; } }
@media (min-width: 561px) and (max-width: 1100px) { .app-ct-grid.opp-ct-grid { grid-template-columns: minmax(0, 1fr) 96px 120px 84px 128px !important; } }
`;

export default function OppStyle() {
  return (
    <style href="alwayscited-opportunities" precedence="default">
      {CSS}
    </style>
  );
}
