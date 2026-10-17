import type { Guide } from "@/config/guidance";

/** One "how to act on this yourself" guide, closed until asked for (config/guidance.ts). */
export default function GuideBox({ guide, id, open = false }: { guide: Guide; id?: string; open?: boolean }) {
  return (
    <details className="guide" id={id} open={open}>
      <summary>{guide.title}</summary>
      <ol>{guide.steps.map((s) => <li key={s}>{s}</li>)}</ol>
    </details>
  );
}
