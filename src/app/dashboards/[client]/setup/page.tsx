import type { Metadata } from "next";

import SetupWizard from "@/components/dash/SetupWizard";
import { PageHead } from "@/components/dash/Shell";
import { pageData } from "@/lib/dash/page-data";
import { planShape } from "@/lib/dash/plan";
import { trimRaw } from "@/lib/dash/model";
import { loadSetupConfirmed } from "@/lib/tracking/setup-data";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Set up", robots: { index: false, follow: false } };

/**
 * Setup on the dashboards host (18 Oct 2026 brief 2d): every signup lands
 * here until it is confirmed (the Overview sends an unconfirmed client here).
 * Keyword, its plural, target page, prompts - SetupWizard - then Confirm.
 */
export default async function Setup({ params }: { params: Promise<{ client: string }> }) {
  const { client: slug } = await params;
  const { raw, base, demo } = await pageData(slug);
  const confirmed = demo ? false : await loadSetupConfirmed(raw.client.id);
  return (
    <>
      <PageHead
        micro="Set up"
        title={confirmed ? "Your clusters are set up" : "Set up your clusters"}
        intro={confirmed ? "Setup is confirmed. You can still change a keyword, target page or prompt here or on each cluster's page." : "For each cluster: check its Google keyword, choose the page it should rank with, and save the questions buyers ask. The first reading runs the morning after you confirm."}
      />
      <SetupWizard slug={slug} base={base} initial={trimRaw(raw)} plan={planShape()} demo={demo} homepage={`https://${raw.client.domain}/`} />
    </>
  );
}
