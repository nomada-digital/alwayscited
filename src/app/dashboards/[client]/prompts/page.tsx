import type { Metadata } from "next";

import { DownloadMd, PromptBox } from "@/components/dash/PromptBox";
import { PageHead } from "@/components/dash/Shell";
import { pageData } from "@/lib/dash/page-data";
import { readPublishedPrompts } from "@/lib/dash/prompts";
import { promptsFileName, promptsMarkdown } from "@/lib/dash/prompts-md";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Prompts for your site", robots: { index: false, follow: false } };

const when = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : null);

/**
 * Prompts for your site (Danny, 26 Nov 2026): ready-to-paste Claude/AI prompts we publish for the customer to apply on
 * their own site, instead of sending them in an email. Each is in a grey box with Copy; each deliverable downloads as
 * one Markdown file. Published by staff from the hub (/api/hub/agency prompts_publish).
 */
export default async function Prompts({ params }: { params: Promise<{ client: string }> }) {
  const { client: slug } = await params;
  const { raw } = await pageData(slug);
  const deliverables = await readPublishedPrompts(supabaseAdmin(), raw.client.id);
  return (
    <>
      <PageHead micro="Prompts for your site" title="Prompts for your site" intro="Ready-to-paste prompts from Nomada for you to apply on your own site. Copy one into Claude (or any AI assistant that can edit your site), or download the lot as a Markdown file." />
      {deliverables.length === 0 ? (
        <div className="dash-card"><p className="intro" style={{ margin: 0 }}>Nothing here yet. When we have prompts for your site, they appear here.</p></div>
      ) : (
        deliverables.map((d) => (
          <div className="dash-card prompt-set" key={d.id} style={{ marginBottom: 16 }}>
            <div className="prompt-set__head">
              <div>
                <h2 style={{ margin: 0 }}>{d.title}</h2>
                {when(d.publishedAt) ? <p className="intro" style={{ margin: "2px 0 0" }}>Published {when(d.publishedAt)}</p> : null}
              </div>
              <DownloadMd markdown={promptsMarkdown(d)} fileName={promptsFileName(d.title)} />
            </div>
            {d.intro ? <p className="intro" style={{ margin: "10px 0 14px" }}>{d.intro}</p> : null}
            {d.prompts.map((p, i) => <PromptBox key={i} n={i + 1} title={p.title} body={p.body} />)}
          </div>
        ))
      )}
    </>
  );
}
