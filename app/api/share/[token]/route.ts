// public share endpoint - no auth
// returns the same shape that the authed /api/runs/[id] returns minus secrets
// (zillow url + workflow internals)
// only completed runs are exposed
import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { runs, runPhotos, runBoards, pinterestBoards } from "@/db/schema";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token) return NextResponse.json({ error: "not found" }, { status: 404 });

  const [runRow] = await db
    .select({
      id: runs.id,
      address: runs.address,
      status: runs.status,
      modelTier: runs.modelTier,
      photoCount: runs.photoCount,
      completedCount: runs.completedCount,
      failedCount: runs.failedCount,
      createdAt: runs.createdAt,
      finishedAt: runs.finishedAt,
      price: runs.price,
      beds: runs.beds,
      baths: runs.baths,
      livingAreaSqft: runs.livingAreaSqft,
      lotSize: runs.lotSize,
    })
    .from(runs)
    .where(eq(runs.shareToken, token));
  if (!runRow || runRow.status !== "done") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const photos = await db
    .select({
      id: runPhotos.id,
      index: runPhotos.index,
      inputUrl: runPhotos.inputUrl,
      outputUrl: runPhotos.outputUrl,
      classifiedTheme: runPhotos.classifiedTheme,
      matchedBoardId: runPhotos.matchedBoardId,
      status: runPhotos.status,
    })
    .from(runPhotos)
    .where(eq(runPhotos.runId, runRow.id))
    .orderBy(asc(runPhotos.index));

  const boards = await db
    .select({ id: pinterestBoards.id, title: pinterestBoards.title })
    .from(runBoards)
    .innerJoin(pinterestBoards, eq(pinterestBoards.id, runBoards.boardId))
    .where(eq(runBoards.runId, runRow.id));

  return NextResponse.json({ run: runRow, photos, boards });
}
