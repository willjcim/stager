// dashboard - active runs at top history below
import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { runs } from "@/db/schema";
import { ActiveRuns } from "@/components/active-runs";
import { RunCard, type RunCardData } from "@/components/run-card";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await auth();
  const userId = session!.user!.id!;

  const history = await db
    .select()
    .from(runs)
    .where(and(eq(runs.userId, userId), inArray(runs.status, ["done", "failed", "cancelled"])))
    .orderBy(desc(runs.createdAt))
    .limit(50);

  const historyData: RunCardData[] = history.map((r) => ({
    id: r.id,
    address: r.address,
    zillowUrl: r.zillowUrl,
    status: r.status,
    modelTier: r.modelTier,
    photoCount: r.photoCount,
    completedCount: r.completedCount,
    failedCount: r.failedCount,
    createdAt: r.createdAt.toISOString(),
  }));

  return (
    <div className="space-y-10">
      <section>
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-xl font-semibold tracking-tight">Active runs</h2>
          <Link href="/runs/active" className="text-xs text-muted-foreground hover:text-foreground">
            View all
          </Link>
        </div>
        <ActiveRuns />
      </section>

      <section>
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-xl font-semibold tracking-tight">History</h2>
          <Link href="/runs/new" className="text-xs text-muted-foreground hover:text-foreground">
            + New run
          </Link>
        </div>
        {historyData.length === 0 ? (
          <p className="text-sm text-muted-foreground">No completed runs yet.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {historyData.map((r) => (
              <RunCard key={r.id} run={r} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
