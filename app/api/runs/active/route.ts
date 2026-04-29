// active-runs summary endpoint
// returns lightweight rows for any in-flight run for the dashboard and active page
import { NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { runs } from "@/db/schema";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rows = await db
    .select({
      id: runs.id,
      address: runs.address,
      zillowUrl: runs.zillowUrl,
      status: runs.status,
      modelTier: runs.modelTier,
      photoCount: runs.photoCount,
      completedCount: runs.completedCount,
      failedCount: runs.failedCount,
      createdAt: runs.createdAt,
    })
    .from(runs)
    .where(and(eq(runs.userId, session.user.id), inArray(runs.status, ["queued", "running"])))
    .orderBy(desc(runs.createdAt));

  return NextResponse.json({ runs: rows });
}
