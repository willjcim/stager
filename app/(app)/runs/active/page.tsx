// active runs page - dedicated full-width view of every in-flight run
import { ActiveRuns } from "@/components/active-runs";

export const dynamic = "force-dynamic";

export default function ActiveRunsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Active runs</h1>
        <p className="text-sm text-muted-foreground">Live progress for everything in flight.</p>
      </div>
      <ActiveRuns refreshMs={2000} />
    </div>
  );
}
