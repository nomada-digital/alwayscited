import type { Metadata } from "next";

import TaskList from "@/components/dash/TaskList";
import { PageHead } from "@/components/dash/Shell";
import { pageData } from "@/lib/dash/page-data";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { readTasks, syncTasks } from "@/lib/tasks/store";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
export const metadata: Metadata = { title: "Your tasks", robots: { index: false, follow: false } };

/**
 * Your tasks (Danny, 27 Nov 2026): the actions we need from the customer, with why each matters and plain steps, in their dashboard
 * rather than in an email. Staff add them from the hub (/api/hub/agency tasks_add). The customer ticks one done; connecting an
 * integration or a live page check marks it "Checked by us" on its own. Opening the page settles the auto-checks, except in a
 * read-only demo or view-as, which never write.
 */
export default async function Tasks({ params }: { params: Promise<{ client: string }> }) {
  const { client: slug } = await params;
  const { ws, raw, demo } = await pageData(slug);
  const db = supabaseAdmin();
  let rows = await readTasks(db, raw.client.id);
  if (!demo) rows = await syncTasks(db, { id: raw.client.id, domain: raw.client.domain }, rows);
  return (
    <>
      <PageHead micro="Your tasks" title="Your tasks" intro="Things that will help your results, with plain steps for each. Tick one when you have done it. Where we can, we check it for you." />
      <TaskList slug={slug} initial={rows} canWrite={ws.canWrite && !demo} />
    </>
  );
}
