import Shell from "@/components/dash/Shell";
import { pageData } from "@/lib/dash/page-data";

export const dynamic = "force-dynamic";

export default async function ClientLayout({ children, params }: { children: React.ReactNode; params: Promise<{ client: string }> }) {
  const { client } = await params;
  const { ws, others, base, demo, banner } = await pageData(client);
  return <Shell ws={ws} others={others} base={base} demo={demo} banner={banner}>{children}</Shell>;
}
