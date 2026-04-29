// boards api
// GET lists saved boards for the signed-in user
// POST adds a new board by url and starts the ingest workflow
import { NextResponse } from "next/server";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { start } from "workflow/api";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { pinterestBoards, pinterestPins } from "@/db/schema";
import { ingestBoardWorkflow } from "@/workflows/ingest-board";

const addSchema = z.object({
  url: z.string().url().refine((u) => /pinterest\.[a-z.]+\//i.test(u), "must be a pinterest url"),
  title: z.string().min(1).max(120).optional(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const boards = await db
    .select()
    .from(pinterestBoards)
    .where(eq(pinterestBoards.userId, session.user.id))
    .orderBy(desc(pinterestBoards.createdAt));

  // attach a thumbnail (first pin) per board
  const ids = boards.map((b) => b.id);
  const thumbsByBoard: Record<string, string> = {};
  if (ids.length) {
    const pins = await db
      .select({ boardId: pinterestPins.boardId, imageUrl: pinterestPins.imageUrl })
      .from(pinterestPins);
    for (const p of pins) {
      if (!thumbsByBoard[p.boardId]) thumbsByBoard[p.boardId] = p.imageUrl;
    }
  }

  return NextResponse.json({
    boards: boards.map((b) => ({ ...b, thumbnail: thumbsByBoard[b.id] ?? null })),
  });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = addSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid input", issues: parsed.error.issues }, { status: 400 });
  }

  // create board row in ingesting state
  const [board] = await db
    .insert(pinterestBoards)
    .values({
      userId: session.user.id,
      url: parsed.data.url,
      title: parsed.data.title ?? "Pinterest board",
      status: "ingesting",
    })
    .returning();

  // kick off ingest workflow
  await start(ingestBoardWorkflow, [
    { userId: session.user.id, boardId: board.id, boardUrl: board.url },
  ]);

  return NextResponse.json({ board }, { status: 201 });
}
