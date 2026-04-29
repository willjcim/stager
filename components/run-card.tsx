// run card used on dashboard and active page
// shows title progress bar status pill model tier age
"use client";

import Link from "next/link";

export type RunCardData = {
  id: string;
  address: string;
  zillowUrl: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  modelTier: "flash" | "pro";
  photoCount: number;
  completedCount: number;
  failedCount: number;
  createdAt: string;
};

function timeAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

const statusStyles: Record<RunCardData["status"], string> = {
  queued: "bg-muted text-muted-foreground",
  running: "bg-blue-500/15 text-blue-400",
  done: "bg-green-500/15 text-green-400",
  failed: "bg-red-500/15 text-red-400",
  cancelled: "bg-zinc-500/15 text-zinc-400",
};

export function RunCard({ run }: { run: RunCardData }) {
  const total = run.photoCount || 0;
  const done = run.completedCount + run.failedCount;
  const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <Link
      href={`/runs/${run.id}`}
      className="block rounded-xl border border-border bg-card p-4 transition hover:border-accent"
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{run.address || "Fetching listing\u2026"}</div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
            <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${statusStyles[run.status]}`}>
              {run.status}
            </span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase">{run.modelTier}</span>
            <span>{timeAgo(run.createdAt)}</span>
          </div>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          {total ? `${done} / ${total}` : "—"}
        </div>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full transition-all ${run.status === "failed" ? "bg-red-500" : run.status === "cancelled" ? "bg-zinc-500" : "bg-foreground"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {run.failedCount > 0 ? (
        <div className="mt-2 text-[11px] text-red-400">{run.failedCount} failed</div>
      ) : null}
    </Link>
  );
}
