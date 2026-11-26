/**
 * A prompt deliverable and its Markdown file (Danny, 26 Nov 2026: "a Markdown file download for him in case he'd rather
 * do that"). Pure, no imports, so the page's download button and the tests share one builder.
 */
export type PromptDeliverable = { id: string; title: string; intro: string | null; publishedAt: string | null; prompts: { title: string; body: string }[] };

/** A code fence longer than any run of backticks in the text, so a prompt that contains a fence cannot close ours. */
const fenceFor = (text: string) => "`".repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map((m) => m[0].length + 1)));

/** All of one deliverable's prompts as one Markdown file: the title, the intro, then each prompt under its own heading in a code block. */
export function promptsMarkdown(d: Pick<PromptDeliverable, "title" | "intro" | "prompts">): string {
  const out = [`# ${d.title}`];
  if (d.intro) out.push(d.intro);
  for (const p of d.prompts) {
    const f = fenceFor(p.body);
    out.push(`## ${p.title}\n\n${f}text\n${p.body}\n${f}`);
  }
  return `${out.join("\n\n")}\n`;
}

/** A file name for the download: the title in lower-case words, `.md`. */
export const promptsFileName = (title: string) => `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "prompts"}.md`;
