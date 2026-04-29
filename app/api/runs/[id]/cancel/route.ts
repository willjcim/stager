// cancel an in-progress run
// flips the run row to cancelled then best-effort calls run.cancel() on the
// parent stage-run workflow plus every per-photo child workflow
// the workflow code also polls runs.status itself so even when the wdk cancel
// fails the workflow short-circuits at the next safe boundary
import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { getRun } from "workflow/api";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { runs, runPhotos } from "@/db/schema";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const [runRow] = await db
    .select()
    .from(runs)
    .where(and(eq(runs.id, id), eq(runs.userId, session.user.id)));
  if (!runRow) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (runRow.status !== "queued" && runRow.status !== "running") {
    return NextResponse.json(
      { error: `run already ${runRow.status} nothing to cancel` },
      { status: 409 },
    );
  }

  // 1 flip the db status
  // this is the source of truth - both the parent stage-run poll loop and each
  // per-photo child workflow check this and bail at the next safe boundary even
  // when wdk cancel below silently fails
  await db
    .update(runs)
    .set({ status: "cancelled", finishedAt: new Date() })
    .where(eq(runs.id, id));

  // 2 best-effort hard-cancel any in-flight workflow runs via the wdk
  // collect parent + every child run id we recorded when each photo was launched
  const childRuns = await db
    .select({ workflowRunId: runPhotos.workflowRunId })
    .from(runPhotos)
    .where(eq(runPhotos.runId, id));
  const wfRunIds = [
    runRow.workflowRunId,
    ...childRuns.map((r) => r.workflowRunId),
  ].filter((rid): rid is string => Boolean(rid));

  // run cancellations in parallel and ignore errors from already-finished runs
  await Promise.all(
    wfRunIds.map(async (rid) => {
      try {
        await getRun(rid).cancel();
      } catch (err) {
        console.warn(`cancel: getRun(${rid}).cancel() failed:`, err);
      }
    }),
  );

  // 3 mark any non-terminal photo rows as cancelled so the ui does not show
  // them stuck in "queued" or "classifying" forever
  await db
    .update(runPhotos)
    .set({ status: "cancelled", finishedAt: new Date() })
    .where(
      and(
        eq(runPhotos.runId, id),
        inArray(runPhotos.status, ["queued", "classifying", "matched", "staging"]),
      ),
    );

  return NextResponse.json({ ok: true, cancelledWorkflows: wfRunIds.length });
}
