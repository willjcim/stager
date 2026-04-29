// run detail page
import { RunDetail } from "@/components/run-detail";

export const dynamic = "force-dynamic";

export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RunDetail id={id} />;
}
