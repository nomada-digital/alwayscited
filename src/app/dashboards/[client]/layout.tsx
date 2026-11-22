import Shell from "@/components/dash/Shell";
import { firstCheckLine } from "@/lib/dash/first-check";
import { pageData } from "@/lib/dash/page-data";
import { newCount } from "@/lib/dash/recommendations";
import { readRecommendations } from "@/lib/dash/recommendations-read";
import type { Workspace } from "@/lib/dash/types";

export const dynamic = "force-dynamic";

/** Day zero's line for every page. Read off the clock, so kept out of the component's render (as the Overview's next check). */
function waitingLine(ws: Workspace): string | null {
  const tracking = ws.clusters.some((c) => c.prompts > 0) || ws.loose.prompts.length > 0;
  return firstCheckLine(ws.client, { hasRun: ws.lastRun !== null, tracking }, Date.now());
}

export default async function ClientLayout({ children, params }: { children: React.ReactNode; params: Promise<{ client: string }> }) {
  const { client } = await params;
  const { ws, others, base, demo, viewAs, banner } = await pageData(client);
  // The nav's count of new recommendations; an unreadable section shows no count (the page itself says so).
  const recs = await readRecommendations(ws.client.id, ws.today);
  return <Shell recommendations={recs.ok ? newCount(recs.items) : null} ws={ws} others={others} base={base} demo={demo} viewAs={viewAs} banner={banner} waiting={waitingLine(ws)}>{children}</Shell>;
}
