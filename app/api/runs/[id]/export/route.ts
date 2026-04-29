// pdf export of a completed run
// streams a synchronously-built pdf back to the browser as an attachment
// only the run owner can download
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { runs } from "@/db/schema";
import { generateRunPdf, loadRunForExport } from "@/lib/pdf";

// pdf generation involves N image fetches + sharp resize per photo
// give the function plenty of headroom even on 50-photo runs
export const maxDuration = 300;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  // ownership + completion check via a small select first to fail fast on 404 / 409
  const [own] = await db
    .select({ status: runs.status, address: runs.address })
    .from(runs)
    .where(and(eq(runs.id, id), eq(runs.userId, session.user.id)));
  if (!own) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (own.status !== "done") {
    return NextResponse.json({ error: "run is not complete" }, { status: 409 });
  }

  const data = await loadRunForExport(id);
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });

  const bytes = await generateRunPdf(data);
  const filename = sanitizeFilename(`stager-${own.address || id}.pdf`);

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "no-store",
    },
  });
}

function sanitizeFilename(s: string) {
  return s.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").slice(0, 120);
}
