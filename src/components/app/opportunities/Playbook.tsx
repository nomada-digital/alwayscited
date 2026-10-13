import { T } from "@/config/tokens";
import { LINE_G1, type Playbook as Book } from "@/lib/diy/opportunities/playbooks.advice";
import { ROUTE_LABEL } from "@/lib/diy/opportunities/types";

import Advice from "./Advice";

/**
 * One route's method (13 Oct 2026, DIY P7; spec 10 sections 2.4 and 6.2):
 * the steps, what to send, where to point them, our estimate of the effort,
 * the line not to cross, and Google's dated spam-policy line, every line with
 * its grade. The same on the Methods view and on an opportunity's page.
 */
export default function Playbook({ book, heading = true, extra }: { book: Book; heading?: boolean; extra?: React.ReactNode }) {
  const h = `pb-${book.route}`;
  return (
    <section aria-labelledby={heading ? h : undefined} aria-label={heading ? undefined : "The method"} style={{ display: "flex", flexDirection: "column", gap: "10px", minWidth: 0 }}>
      {heading ? (
        <h3 id={h} style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: T.ink }}>
          {ROUTE_LABEL[book.route]}
        </h3>
      ) : null}
      <ol style={{ margin: 0, paddingLeft: "22px", listStyle: "decimal" }}>
        {book.steps.map((s) => (
          <Advice key={s.id} line={s} as="li" />
        ))}
      </ol>
      {extra}
      {book.send ? <Advice line={book.send} lead="What to send:" /> : null}
      {book.pointTo ? <Advice line={book.pointTo} lead="Point them to:" /> : null}
      <p style={{ margin: 0, fontSize: "14px", color: T.ink }}>
        <strong style={{ fontWeight: 650 }}>Effort:</strong> {book.effort} <span style={{ color: T.soft }}>(our estimate)</span>
      </p>
      {book.line ? <Advice line={book.line} lead="The line not to cross:" /> : null}
      <Advice line={LINE_G1} />
    </section>
  );
}
