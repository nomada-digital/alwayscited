import Shell from "@/components/dash/Shell";
import { firstCheckLine } from "@/lib/dash/first-check";
import { pageData } from "@/lib/dash/page-data";
import type { Workspace } from "@/lib/dash/types";

export const dynamic = "force-dynamic";

/** Day zero's line for every page. Read off the clock, so kept out of the component's render (as the Overview's next check). */
function waitingLine(ws: Workspace): string | null {
  const tracking = ws.clusters.some((c) => c.prompts > 0) || ws.loose.prompts.length > 0;
  return firstCheckLine(ws.client, { hasRun: ws.lastRun !== null, tracking }, Date.now());
}

export default async function ClientLayout({ children, params }: { children: React.ReactNode; params: Promise<{ client: string }> }) {
  const { client } = await params;
  const { ws, others, base, demo, banner } = await pageData(client);
  return <Shell ws={ws} others={others} base={base} demo={demo} banner={banner} waiting={waitingLine(ws)}>{children}</Shell>;
}
