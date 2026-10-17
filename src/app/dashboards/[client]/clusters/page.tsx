import type { Metadata } from "next";

import ClustersBoard from "@/components/dash/ClustersBoard";
import { PageHead } from "@/components/dash/Shell";
import { trimRaw } from "@/lib/dash/model";
import { pageData } from "@/lib/dash/page-data";
import { planShape } from "@/lib/dash/plan";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Clusters", robots: { index: false, follow: false } };

export default async function Clusters({ params }: { params: Promise<{ client: string }> }) {
  const { client: slug } = await params;
  const { raw, base, demo } = await pageData(slug);
  return (
    <>
      <PageHead micro="Clusters" title="What you track" intro="A cluster is one search you want to win, split into the groups of keywords that mean the same thing, with the prompts buyers ask AI about it." />
      <ClustersBoard slug={slug} base={base} demo={demo} initial={trimRaw(raw)} plan={planShape()} />
    </>
  );
}
