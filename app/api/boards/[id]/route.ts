// per-board api
// DELETE removes a board (cascades to pins via fk on delete cascade)
// POST refreshes by re-running the ingest workflow
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { start } from "workflow/api";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { pinterestBoards } from "@/db/schema";
import { ingestBoardWorkflow } from "@/workflows/ingest-board";

async function loadBoardForUser(boardId: string, userId: string) {
  const rows = await db
    .select()
    .from(pinterestBoards)
    .where(and(eq(pinterestBoards.id, boardId), eq(pinterestBoards.userId, userId)));
  return rows[0] ?? null;
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const board = await loadBoardForUser(id, session.user.id);
  if (!board) return NextResponse.json({ error: "not found" }, { status: 404 });

  await db.delete(pinterestBoards).where(eq(pinterestBoards.id, id));
  return NextResponse.json({ ok: true });
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const board = await loadBoardForUser(id, session.user.id);
  if (!board) return NextResponse.json({ error: "not found" }, { status: 404 });

  await db
    .update(pinterestBoards)
    .set({ status: "ingesting" })
    .where(eq(pinterestBoards.id, id));

  await start(ingestBoardWorkflow, [
    { userId: session.user.id, boardId: id, boardUrl: board.url },
  ]);

  return NextResponse.json({ ok: true });
}
