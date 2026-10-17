import { type Inline, parseAnswer } from "@/components/scan/answer-markdown";
import { highlight } from "@/lib/dash/highlight";

/**
 * An AI answer as the engine wrote it - paragraphs, lists, tables - with the
 * client's names and the named competitors marked (lib/dash/highlight.ts).
 * Rendered as text, never as HTML: the words came from a third party.
 */
export default function AnswerText({ text, you, rivals }: { text: string; you: string[]; rivals: string[] }) {
  const run = (parts: Inline[], key: string) =>
    parts.map((p, i) =>
      p.cite ? <sup key={`${key}-${i}`} className="muted">[{p.text}]</sup> : (
        <span key={`${key}-${i}`} style={p.bold ? { fontWeight: 700 } : undefined}>
          {highlight(p.text, you, rivals).map((s, j) => (s.mark ? <mark key={j} className={`hl-${s.mark}`}>{s.text}</mark> : <span key={j}>{s.text}</span>))}
        </span>
      ),
    );
  return (
    <div className="answer">
      {parseAnswer(text).map((b, i) => {
        const k = `b${i}`;
        if (b.kind === "h") return <p key={k} style={{ fontWeight: 700 }}>{run(b.text, k)}</p>;
        if (b.kind === "p") return <p key={k}>{b.lines.map((l, j) => <span key={j}>{j ? <br /> : null}{run(l, `${k}-${j}`)}</span>)}</p>;
        if (b.kind === "ul") return <ul key={k}>{b.items.map((it, j) => <li key={j}>{run(it, `${k}-${j}`)}</li>)}</ul>;
        if (b.kind !== "table") return <ol key={k}>{b.items.map((it, j) => <li key={j}>{run(it, `${k}-${j}`)}</li>)}</ol>;
        return (
          <div key={k} className="tbl-wrap"><table className="tbl"><thead><tr>{b.head.map((h, j) => <th key={j}>{run(h, `${k}-h${j}`)}</th>)}</tr></thead><tbody>{b.rows.map((r, j) => <tr key={j}>{r.map((c, m) => <td key={m}>{run(c, `${k}-${j}-${m}`)}</td>)}</tr>)}</tbody></table></div>
        );
      })}
    </div>
  );
}
