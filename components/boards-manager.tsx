// boards manager
// add by url + thumbnail grid + delete + refresh swr-driven
"use client";

import { useState, type FormEvent } from "react";
import useSWR, { mutate } from "swr";
// next/image is replaced with plain <img> for simplicity with arbitrary blob hosts
const fetcher = (url: string) => fetch(url).then((r) => r.json());

type Board = {
  id: string;
  url: string;
  title: string;
  description: string | null;
  pinCount: number;
  status: string;
  thumbnail: string | null;
  createdAt: string;
};

export function BoardsManager() {
  const { data } = useSWR<{ boards: Board[] }>("/api/boards", fetcher, { refreshInterval: 4000 });
  const boards = data?.boards ?? [];
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErr(null);
    const res = await fetch("/api/boards", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url, title: title || undefined }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErr(j.error ?? "failed to add board");
      return;
    }
    setUrl("");
    setTitle("");
    mutate("/api/boards");
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this board?")) return;
    await fetch(`/api/boards/${id}`, { method: "DELETE" });
    mutate("/api/boards");
  }

  async function handleRefresh(id: string) {
    await fetch(`/api/boards/${id}`, { method: "POST" });
    mutate("/api/boards");
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleAdd} className="rounded-xl border border-border bg-card p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[2fr_1fr_auto]">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            type="url"
            required
            placeholder="https://www.pinterest.com/username/board-name/"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground"
          />
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            type="text"
            placeholder="Title (optional)"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground"
          />
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {submitting ? "Adding\u2026" : "Add board"}
          </button>
        </div>
        {err ? <p className="mt-2 text-xs text-red-400">{err}</p> : null}
      </form>

      {boards.length === 0 ? (
        <p className="text-sm text-muted-foreground">No boards saved yet. Add one above.</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {boards.map((b) => (
            <div key={b.id} className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="aspect-video bg-muted">
                {b.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={b.thumbnail} alt={b.title} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                    {b.status === "ingesting" ? "Ingesting\u2026" : "No image"}
                  </div>
                )}
              </div>
              <div className="p-3">
                <div className="truncate text-sm font-medium">{b.title}</div>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{b.pinCount} pins</span>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase">{b.status}</span>
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => handleRefresh(b.id)}
                    className="flex-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
                  >
                    Refresh
                  </button>
                  <button
                    onClick={() => handleDelete(b.id)}
                    className="rounded-md border border-border px-2 py-1 text-xs text-red-400 hover:bg-red-500/10"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
