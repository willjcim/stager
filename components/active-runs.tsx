// live active-runs grid that auto-refreshes via SWR
// stops polling once nothing is in flight (refreshInterval=0)
"use client";

import useSWR from "swr";
import { RunCard, type RunCardData } from "./run-card";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function ActiveRuns({ refreshMs = 2000 }: { refreshMs?: number }) {
  const { data, isLoading } = useSWR<{ runs: RunCardData[] }>("/api/runs/active", fetcher, {
    refreshInterval: refreshMs,
  });

  const runs = data?.runs ?? [];

  if (isLoading && !data) {
    return <div className="text-sm text-muted-foreground">Loading active runs\u2026</div>;
  }
  if (!runs.length) {
    return <div className="text-sm text-muted-foreground">No active runs.</div>;
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {runs.map((r) => (
        <RunCard key={r.id} run={r} />
      ))}
    </div>
  );
}
