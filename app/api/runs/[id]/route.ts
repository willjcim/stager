// per-run api
// GET returns the full run + its photos for the live progress view
// DELETE removes a run (and its photos via cascade) with best-effort blob cleanup
import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { runs, runPhotos, runBoards, pinterestBoards } from "@/db/schema";
import { deleteBlob } from "@/lib/blob";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const runRow = (
    await db
      .select()
      .from(runs)
      .where(and(eq(runs.id, id), eq(runs.userId, session.user.id)))
  )[0];
  if (!runRow) return NextResponse.json({ error: "not found" }, { status: 404 });

  const photos = await db
    .select()
    .from(runPhotos)
    .where(eq(runPhotos.runId, id))
    .orderBy(asc(runPhotos.index));

  const boards = await db
    .select({ id: pinterestBoards.id, title: pinterestBoards.title })
    .from(runBoards)
    .innerJoin(pinterestBoards, eq(pinterestBoards.id, runBoards.boardId))
    .where(eq(runBoards.runId, id));

  return NextResponse.json({ run: runRow, photos, boards });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const runRow = (
    await db
      .select()
      .from(runs)
      .where(and(eq(runs.id, id), eq(runs.userId, session.user.id)))
  )[0];
  if (!runRow) return NextResponse.json({ error: "not found" }, { status: 404 });

  // best-effort blob cleanup before deleting db rows
  const photos = await db
    .select({ outputUrl: runPhotos.outputUrl })
    .from(runPhotos)
    .where(eq(runPhotos.runId, id));
  await Promise.all(photos.map((p) => (p.outputUrl ? deleteBlob(p.outputUrl) : Promise.resolve())));

  await db.delete(runs).where(eq(runs.id, id));
  return NextResponse.json({ ok: true });
}
