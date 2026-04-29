// run detail live progress view
// polls /api/runs/[id] every 2s and stops once status is terminal
// when readOnly is true the same component renders the public /share/[token]
// view - no destructive actions and no internal-only fields
"use client";

import useSWR from "swr";
import Link from "next/link";
import { useState } from "react";
import { PhotoLightbox, type LightboxPhoto } from "./photo-lightbox";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type RunStatus = "queued" | "running" | "done" | "failed" | "cancelled";
type PhotoStatus =
  | "queued"
  | "classifying"
  | "matched"
  | "staging"
  | "done"
  | "failed"
  | "cancelled";

type Run = {
  id: string;
  address: string;
  zillowUrl?: string; // omitted in read-only / share view
  status: RunStatus;
  modelTier: "flash" | "pro";
  photoCount: number;
  completedCount: number;
  failedCount: number;
  createdAt: string;
  finishedAt: string | null;
  error?: string | null;
  shareToken?: string | null;
};

type Photo = {
  id: string;
  index: number;
  inputUrl: string;
  outputUrl: string | null;
  classifiedTheme: string | null;
  classificationConfidence?: number | null;
  matchedBoardId: string | null;
  matchConfidence?: number | null;
  status: PhotoStatus;
  error?: string | null;
};

type Board = { id: string; title: string };

const photoStatusColor: Record<PhotoStatus, string> = {
  queued: "bg-muted text-muted-foreground",
  classifying: "bg-blue-500/15 text-blue-400",
  matched: "bg-purple-500/15 text-purple-400",
  staging: "bg-amber-500/15 text-amber-400",
  done: "bg-green-500/15 text-green-400",
  failed: "bg-red-500/15 text-red-400",
  cancelled: "bg-zinc-500/15 text-zinc-400",
};

const runStatusColor: Record<RunStatus, string> = {
  queued: "bg-muted text-muted-foreground",
  running: "bg-blue-500/15 text-blue-400",
  done: "bg-green-500/15 text-green-400",
  failed: "bg-red-500/15 text-red-400",
  cancelled: "bg-zinc-500/15 text-zinc-400",
};

function elapsed(fromIso: string, toIso?: string | null) {
  const from = new Date(fromIso).getTime();
  const to = toIso ? new Date(toIso).getTime() : Date.now();
  const s = Math.max(0, Math.floor((to - from) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return `${m}m ${r}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

type Props = {
  id: string;
  // when readOnly the api endpoint is /api/share/[token] and ALL action buttons
  // are hidden (used by the public share page)
  readOnly?: boolean;
  shareToken?: string;
};

export function RunDetail({ id, readOnly = false, shareToken }: Props) {
  const endpoint = readOnly && shareToken ? `/api/share/${shareToken}` : `/api/runs/${id}`;
  const { data, error, mutate } = useSWR<{ run: Run; photos: Photo[]; boards: Board[] }>(
    endpoint,
    fetcher,
    {
      refreshInterval: (latest) => {
        const status = latest?.run?.status;
        if (status === "done" || status === "failed" || status === "cancelled") return 0;
        return 2000;
      },
    },
  );

  // lightbox state - null when closed photoId when open
  const [lightboxId, setLightboxId] = useState<string | null>(null);

  if (error) return <div className="text-sm text-red-400">Failed to load run.</div>;
  if (!data) return <div className="text-sm text-muted-foreground">Loading…</div>;
  const { run, photos, boards } = data;
  const total = run.photoCount;
  const settled = run.completedCount + run.failedCount;
  const pct = total ? Math.min(100, Math.round((settled / total) * 100)) : 0;
  const boardTitleById = Object.fromEntries(boards.map((b) => [b.id, b.title]));

  // photos that can be opened in the lightbox (anything with an input image)
  const lightboxPhotos: LightboxPhoto[] = photos.map((p) => ({
    id: p.id,
    index: p.index,
    inputUrl: p.inputUrl,
    outputUrl: p.outputUrl,
    classifiedTheme: p.classifiedTheme,
    matchedBoardTitle: p.matchedBoardId ? boardTitleById[p.matchedBoardId] : null,
  }));

  const tally = {
    queued: photos.filter((p) => p.status === "queued").length,
    classifying: photos.filter((p) => p.status === "classifying").length,
    matched: photos.filter((p) => p.status === "matched").length,
    staging: photos.filter((p) => p.status === "staging").length,
    done: photos.filter((p) => p.status === "done").length,
    failed: photos.filter((p) => p.status === "failed").length,
    cancelled: photos.filter((p) => p.status === "cancelled").length,
  };

  return (
    <div className="space-y-6">
      <header className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-xs uppercase text-muted-foreground">Run</div>
            <h1 className="truncate text-xl font-semibold tracking-tight">
              {run.address || "Fetching listing…"}
            </h1>
            {!readOnly && run.zillowUrl ? (
              <a
                href={run.zillowUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-block truncate text-xs text-muted-foreground hover:text-foreground"
              >
                {run.zillowUrl}
              </a>
            ) : null}
          </div>
          <div className="text-right text-xs">
            <div
              className={`inline-block rounded px-2 py-0.5 text-[10px] uppercase ${runStatusColor[run.status]}`}
            >
              {run.status}
            </div>
            <div className="mt-1 text-muted-foreground">
              {run.modelTier} · {elapsed(run.createdAt, run.finishedAt)}
            </div>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {settled} / {total || "?"} photos
            </span>
            <span>{pct}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full transition-all ${run.status === "failed" ? "bg-red-500" : run.status === "cancelled" ? "bg-zinc-500" : "bg-foreground"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
            {tally.queued ? <span>queued: {tally.queued}</span> : null}
            {tally.classifying ? <span>classifying: {tally.classifying}</span> : null}
            {tally.matched ? <span>matched: {tally.matched}</span> : null}
            {tally.staging ? <span>staging: {tally.staging}</span> : null}
            {tally.done ? <span>done: {tally.done}</span> : null}
            {tally.failed ? <span className="text-red-400">failed: {tally.failed}</span> : null}
            {tally.cancelled ? <span>cancelled: {tally.cancelled}</span> : null}
          </div>
        </div>

        {run.error && !readOnly ? (
          <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
            {run.error}
          </div>
        ) : null}

        {boards.length ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="text-xs text-muted-foreground">references:</span>
            {boards.map((b) =>
              readOnly ? (
                <span
                  key={b.id}
                  className="rounded border border-border bg-muted px-2 py-0.5 text-[11px]"
                >
                  {b.title}
                </span>
              ) : (
                <Link
                  key={b.id}
                  href={`/boards`}
                  className="rounded border border-border bg-muted px-2 py-0.5 text-[11px] hover:border-accent"
                >
                  {b.title}
                </Link>
              ),
            )}
          </div>
        ) : null}

        {!readOnly ? <RunActions run={run} onChange={() => mutate()} /> : null}
      </header>

      <section>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {photos.map((p) => (
            <PhotoCard
              key={p.id}
              photo={p}
              boardTitleById={boardTitleById}
              onOpen={() => setLightboxId(p.id)}
              readOnly={readOnly}
            />
          ))}
        </div>
        {photos.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
            Waiting for Zillow listing…
          </div>
        ) : null}
      </section>

      <PhotoLightbox
        photos={lightboxPhotos}
        startId={lightboxId}
        onClose={() => setLightboxId(null)}
      />
    </div>
  );
}

// action bar (export / share / cancel)
function RunActions({ run, onChange }: { run: Run; onChange: () => void }) {
  const isActive = run.status === "queued" || run.status === "running";
  const isDone = run.status === "done";

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      {isDone ? <ExportButton runId={run.id} /> : null}
      {isDone ? <ShareControls runId={run.id} initialToken={run.shareToken ?? null} /> : null}
      {isActive ? <CancelButton runId={run.id} onCancelled={onChange} /> : null}
    </div>
  );
}

function ExportButton({ runId }: { runId: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <a
      href={`/api/runs/${runId}/export`}
      onClick={() => {
        // give visual feedback while the browser starts the download
        // we cannot reliably know when the download finishes so flip back after a beat
        setBusy(true);
        setTimeout(() => setBusy(false), 4000);
      }}
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-3 py-1.5 text-xs hover:border-accent"
    >
      <svg width="13" height="13" viewBox="0 0 20 20" fill="none" aria-hidden>
        <path d="M10 3v9m0 0l-3.5-3.5M10 12l3.5-3.5M4 14v2a1 1 0 001 1h10a1 1 0 001-1v-2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {busy ? "Preparing PDF…" : "Export PDF"}
    </a>
  );
}

function ShareControls({ runId, initialToken }: { runId: string; initialToken: string | null }) {
  const [token, setToken] = useState<string | null>(initialToken);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const shareUrl = token
    ? typeof window !== "undefined"
      ? `${window.location.origin}/share/${token}`
      : `/share/${token}`
    : null;

  async function enable() {
    setBusy(true);
    try {
      const res = await fetch(`/api/runs/${runId}/share`, { method: "POST" });
      const json = await res.json();
      if (res.ok) setToken(json.token);
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    if (!confirm("Revoke share link? Anyone using the existing link will lose access.")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/runs/${runId}/share`, { method: "DELETE" });
      if (res.ok) setToken(null);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // fall back to a prompt so the user can copy manually
      window.prompt("Copy this share link:", shareUrl);
    }
  }

  if (!token) {
    return (
      <button
        type="button"
        onClick={enable}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-3 py-1.5 text-xs hover:border-accent disabled:opacity-50"
      >
        <svg width="13" height="13" viewBox="0 0 20 20" fill="none" aria-hidden>
          <path d="M8.5 11.5L11.5 8.5M7 13l-2 2a2.5 2.5 0 01-3.5-3.5l2-2m6-6l2-2a2.5 2.5 0 013.5 3.5l-2 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        {busy ? "Creating…" : "Create share link"}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1 rounded-md border border-border bg-muted p-1 pl-2 text-xs">
      <span className="max-w-[260px] truncate text-muted-foreground" title={shareUrl ?? ""}>
        {shareUrl}
      </span>
      <button
        type="button"
        onClick={copy}
        className="rounded px-2 py-1 hover:bg-background"
        aria-label="Copy share link"
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <button
        type="button"
        onClick={disable}
        disabled={busy}
        className="rounded px-2 py-1 text-muted-foreground hover:bg-background hover:text-red-400 disabled:opacity-50"
        aria-label="Revoke share link"
      >
        Revoke
      </button>
    </div>
  );
}

function CancelButton({ runId, onCancelled }: { runId: string; onCancelled: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        if (!confirm("Cancel this run? Photos that have already finished will be kept.")) return;
        setBusy(true);
        try {
          const res = await fetch(`/api/runs/${runId}/cancel`, { method: "POST" });
          if (res.ok) onCancelled();
        } finally {
          setBusy(false);
        }
      }}
      disabled={busy}
      className="inline-flex items-center gap-1.5 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs text-red-300 hover:border-red-400 hover:bg-red-500/20 disabled:opacity-50"
    >
      <svg width="13" height="13" viewBox="0 0 20 20" fill="none" aria-hidden>
        <rect x="5" y="5" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      </svg>
      {busy ? "Cancelling…" : "Cancel run"}
    </button>
  );
}

// per-photo card
function PhotoCard({
  photo,
  boardTitleById,
  onOpen,
  readOnly,
}: {
  photo: Photo;
  boardTitleById: Record<string, string>;
  onOpen: () => void;
  readOnly: boolean;
}) {
  const matchedTitle = photo.matchedBoardId ? boardTitleById[photo.matchedBoardId] : null;
  const clickable = Boolean(photo.inputUrl);
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <button
        type="button"
        onClick={onOpen}
        disabled={!clickable}
        className="grid w-full grid-cols-2 text-left transition hover:opacity-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        aria-label={`Open photo ${photo.index + 1}`}
      >
        <div className="relative aspect-[4/3] bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo.inputUrl} alt="input" className="h-full w-full object-cover" />
          {(photo.status === "classifying" || photo.status === "staging") && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40">
              <div className="text-xs text-white">{photo.status}…</div>
            </div>
          )}
        </div>
        <div className="relative aspect-[4/3] bg-muted">
          {photo.outputUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo.outputUrl} alt="staged" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              {photo.status === "failed"
                ? "failed"
                : photo.status === "cancelled"
                  ? "cancelled"
                  : "pending"}
            </div>
          )}
        </div>
      </button>
      <div className="space-y-1 p-3">
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className={`rounded px-1.5 py-0.5 uppercase ${photoStatusColor[photo.status]}`}>
            {photo.status}
          </span>
          {photo.classifiedTheme ? (
            <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
              {photo.classifiedTheme}
            </span>
          ) : null}
          {matchedTitle ? (
            <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
              ← {matchedTitle}
            </span>
          ) : photo.matchConfidence != null && photo.matchConfidence < 0.3 ? (
            <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">all boards</span>
          ) : null}
        </div>
        {photo.error && !readOnly ? (
          <div className="truncate text-[11px] text-red-400" title={photo.error}>
            {photo.error}
          </div>
        ) : null}
      </div>
    </div>
  );
}
