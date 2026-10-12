/**
 * The Actions components' own rules (13 Oct 2026, DIY P3): layout only, no
 * colour (palette.test.mts reads every hex in the tree). A React 19 hoisted
 * stylesheet - `href` and `precedence` - so Actions and the Overview's This
 * week can each draw it and the page carries it once, in the head, with no
 * edit to globals.css, which other packages of the wave are editing.
 *
 * - The board is four columns above 1180px, two below it, and one under
 *   another below 640px, where it reads as the list.
 * - `plan-only-sm`: drawn below 640px only (the default view's Placements
 *   group, which belongs to the list).
 * - "If done: did you change the page?" shows once Done is the move picked,
 *   in CSS, so it works with JS off; a browser without :has() shows it always.
 * - A grade chip's source and date show on hover and focus, and always on a
 *   phone, under the card's chips.
 */
const CSS = `
.plan-board { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; align-items: start; }
@media (max-width: 1180px) { .plan-board { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 639px) { .plan-board { grid-template-columns: minmax(0, 1fr); } }
.plan-only-sm { display: none !important; }
@media (max-width: 639px) { .plan-only-sm { display: flex !important; } }
.plan-move:not(:has(option[value=done]:checked)) .plan-changed { display: none !important; }
.plan-chip-note { display: none; }
.plan-chip:hover + .plan-chip-note, .plan-chip:focus + .plan-chip-note { display: block; }
@media (max-width: 639px) { .plan-chip-note { display: block; } }
`;

export default function PlanStyle() {
  return (
    <style href="alwayscited-plan" precedence="default">
      {CSS}
    </style>
  );
}
