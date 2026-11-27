import Shell from "@/components/dash/Shell";
import { firstCheckLine } from "@/lib/dash/first-check";
import { pageData } from "@/lib/dash/page-data";
import { isSampleClient } from "@/lib/dash/host";
import { clientLogo } from "@/lib/dash/logo";
import { countPublishedPrompts } from "@/lib/dash/prompts";
import { taskCounts } from "@/lib/tasks/store";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { Workspace } from "@/lib/dash/types";

export const dynamic = "force-dynamic";

/** Day zero's line for every page. Read off the clock, so kept out of the component's render (as the Overview's next check). */
function waitingLine(ws: Workspace): string | null {
  const tracking = ws.clusters.some((c) => c.prompts > 0) || ws.loose.prompts.length > 0;
  return firstCheckLine(ws.client, { hasRun: ws.lastRun !== null, tracking }, Date.now());
}

export default async function ClientLayout({ children, params }: { children: React.ReactNode; params: Promise<{ client: string }> }) {
  const { client } = await params;
  const { ws, others, base, demo, viewAs, banner, raw } = await pageData(client);
  // Sample and demo clients are generated, never read: the database is asked only for a real client (as demoRaw does).
  const logo = isSampleClient(raw.client.id) ? null : await clientLogo(supabaseAdmin(), raw.client.id);
  const prompts = isSampleClient(raw.client.id) ? 0 : await countPublishedPrompts(supabaseAdmin(), raw.client.id).catch(() => 0);
  const tasks = isSampleClient(raw.client.id) ? { total: 0, open: 0 } : await taskCounts(supabaseAdmin(), raw.client.id);
  return <Shell ws={ws} others={others} base={base} demo={demo} viewAs={viewAs} banner={banner} waiting={waitingLine(ws)} prompts={prompts} tasks={tasks} logo={logo}>{children}</Shell>;
}
