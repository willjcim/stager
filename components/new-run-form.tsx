// new-run form
// zillow url + multi-select boards (only ready boards) + flash/pro toggle
"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type Board = { id: string; title: string; status: string; pinCount: number };

export function NewRunForm() {
  const router = useRouter();
  const { data } = useSWR<{ boards: Board[] }>("/api/boards", fetcher);
  const boards = (data?.boards ?? []).filter((b) => b.status === "ready" && b.pinCount > 0);

  const [zillowUrl, setZillowUrl] = useState("");
  const [boardIds, setBoardIds] = useState<string[]>([]);
  const [modelTier, setModelTier] = useState<"flash" | "pro">("flash");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function toggleBoard(id: string) {
    setBoardIds((curr) => (curr.includes(id) ? curr.filter((x) => x !== id) : [...curr, id]));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErr(null);
    const res = await fetch("/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ zillowUrl, boardIds, modelTier }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErr(j.error ?? "failed to start run");
      return;
    }
    const { run } = (await res.json()) as { run: { id: string } };
    router.push(`/runs/${run.id}`);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 rounded-xl border border-border bg-card p-6">
      <div>
        <label className="mb-2 block text-sm font-medium">Zillow listing URL</label>
        <input
          value={zillowUrl}
          onChange={(e) => setZillowUrl(e.target.value)}
          required
          type="url"
          placeholder="https://www.zillow.com/homedetails/..."
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground"
        />
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium">Reference boards</label>
        {boards.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No ready boards yet.{" "}
            <a href="/boards" className="underline">
              Add one
            </a>
            .
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {boards.map((b) => {
              const checked = boardIds.includes(b.id);
              return (
                <label
                  key={b.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm ${
                    checked ? "border-foreground bg-muted" : "border-border"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleBoard(b.id)}
                    className="accent-foreground"
                  />
                  <span className="flex-1 truncate">{b.title}</span>
                  <span className="text-xs text-muted-foreground">{b.pinCount}</span>
                </label>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium">Model tier</label>
        <div className="inline-flex overflow-hidden rounded-md border border-border">
          {(["flash", "pro"] as const).map((tier) => (
            <button
              key={tier}
              type="button"
              onClick={() => setModelTier(tier)}
              className={`px-4 py-2 text-sm ${
                modelTier === tier ? "bg-foreground text-background" : "bg-card text-muted-foreground"
              }`}
            >
              {tier === "flash" ? "Flash (cheap, fast)" : "Pro (hero quality)"}
            </button>
          ))}
        </div>
      </div>

      {err ? <p className="text-xs text-red-400">{err}</p> : null}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={submitting || boardIds.length === 0}
          className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {submitting ? "Starting\u2026" : "Start staging"}
        </button>
      </div>
    </form>
  );
}
