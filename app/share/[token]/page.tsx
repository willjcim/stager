// public share page for a completed run
// no auth - validates the token server-side then mounts RunDetail in read-only mode
// (which then fetches via /api/share/[token])
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { runs } from "@/db/schema";
import { RunDetail } from "@/components/run-detail";

export const dynamic = "force-dynamic";

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  // validate token + completed status server-side so we can 404 cleanly
  const [runRow] = await db
    .select({ id: runs.id, status: runs.status, address: runs.address })
    .from(runs)
    .where(eq(runs.shareToken, token));

  if (!runRow || runRow.status !== "done") notFound();

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur">
        <nav className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <Link
            href="/"
            className="flex items-center gap-2 text-sm font-semibold tracking-tight"
          >
            <Image src="/logo.svg" alt="" width={20} height={20} priority />
            Stager
          </Link>
          <span className="text-xs text-muted-foreground">Shared view</span>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <RunDetail id={runRow.id} readOnly shareToken={token} />
      </main>
    </div>
  );
}
