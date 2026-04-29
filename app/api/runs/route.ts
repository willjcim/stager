// runs api
// GET lists the user runs (optionally filtered by status)
// POST creates a run row and kicks off the stageRun workflow
import { NextResponse } from "next/server";
import { z } from "zod";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { start } from "workflow/api";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { runs, runBoards, pinterestBoards } from "@/db/schema";
import { stageRunWorkflow } from "@/workflows/stage-run";
import { normalizeZillowUrl } from "@/lib/zillow";

const createSchema = z.object({
  zillowUrl: z
    .string()
    .url()
    .refine((u) => /zillow\.com\//i.test(u), "must be a zillow url")
    .transform(normalizeZillowUrl),
  boardIds: z.array(z.string().uuid()).min(1, "select at least one board"),
  modelTier: z.enum(["flash", "pro"]).default("flash"),
});

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const filter = url.searchParams.get("filter"); // "active" | "history" | null

  const conds = [eq(runs.userId, session.user.id)];
  if (filter === "active") {
    conds.push(inArray(runs.status, ["queued", "running"]));
  } else if (filter === "history") {
    conds.push(inArray(runs.status, ["done", "failed", "cancelled"]));
  }
  void ne; // reserved for future use
  const rows = await db
    .select()
    .from(runs)
    .where(and(...conds))
    .orderBy(desc(runs.createdAt))
    .limit(100);

  return NextResponse.json({ runs: rows });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  // verify all boards belong to the user and are ready
  const boards = await db
    .select({ id: pinterestBoards.id, status: pinterestBoards.status })
    .from(pinterestBoards)
    .where(
      and(
        eq(pinterestBoards.userId, session.user.id),
        inArray(pinterestBoards.id, parsed.data.boardIds),
      ),
    );
  if (boards.length !== parsed.data.boardIds.length) {
    return NextResponse.json({ error: "one or more boards not found" }, { status: 400 });
  }
  const notReady = boards.filter((b) => b.status !== "ready");
  if (notReady.length) {
    return NextResponse.json(
      { error: "some boards are not ready yet wait for ingestion to finish" },
      { status: 400 },
    );
  }

  // insert run + run_boards link rows
  const [run] = await db
    .insert(runs)
    .values({
      userId: session.user.id,
      zillowUrl: parsed.data.zillowUrl,
      modelTier: parsed.data.modelTier,
      status: "queued",
    })
    .returning();

  await db.insert(runBoards).values(parsed.data.boardIds.map((boardId) => ({ runId: run.id, boardId })));

  // kick off workflow
  const handle = await start(stageRunWorkflow, [
    { runId: run.id, modelTier: parsed.data.modelTier },
  ]);

  await db.update(runs).set({ workflowRunId: handle.runId }).where(eq(runs.id, run.id));

  return NextResponse.json({ run }, { status: 201 });
}
