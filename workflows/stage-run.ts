// stage-run workflow
// thin orchestrator that runs setup steps fans out N child processPhotoWorkflow
// runs (one per photo) in a single step then polls runPhotos until every photo
// has settled (done | failed | cancelled) before finalizing
//
// architecture rationale - prior designs ran the per-photo pipeline as either
// many sequential steps inside the parent (264+ events) or 44 single fat steps
// directly inside the parent (44 concurrent long-running steps) both produced
// "Unconsumed event in event log" runtime errors on Vercel because
//   - WDK uses at-least-once delivery so concurrent lambdas race on the same run
//   - long-running concurrent steps (~30-60s each) keep the workflow active for
//     minutes which multiplies the racing window
//   - the parent event log grew large enough to amplify the race
// child-workflow fan-out via start() from a step is the WDK-recommended pattern
// for high-cardinality work - each child has its own event log and the parent
// event log stays trivially small (setup + kickoff + ~N polls + finalize)
import { and, eq, inArray } from "drizzle-orm";
import { sleep } from "workflow";
import { start } from "workflow/api";
import { db } from "@/lib/db";
import { runs, runPhotos, runBoards, pinterestBoards, pinterestPins } from "@/db/schema";
import { fetchZillowListing } from "@/lib/zillow";
import { type ModelTier } from "@/lib/staging";
import { processPhotoWorkflow, type ProcessPhotoInput } from "@/workflows/process-photo";

// load run header row
async function loadRunHeaderStep(input: { runId: string }) {
  "use step";
  const rows = await db
    .select({
      id: runs.id,
      zillowUrl: runs.zillowUrl,
      userId: runs.userId,
      status: runs.status,
    })
    .from(runs)
    .where(eq(runs.id, input.runId));
  return rows[0] ?? null;
}

// fetch listing details (address + photo urls) from zillow
async function fetchZillowStep(input: { zillowUrl: string }) {
  "use step";
  return fetchZillowListing(input.zillowUrl);
}

// write run header (address photo count status running) and seed runPhotos rows
async function initRunStep(input: { runId: string; address: string; photos: string[] }) {
  "use step";
  await db
    .update(runs)
    .set({
      address: input.address,
      photoCount: input.photos.length,
      status: "running",
    })
    .where(eq(runs.id, input.runId));
  if (input.photos.length) {
    await db.insert(runPhotos).values(
      input.photos.map((url, idx) => ({
        runId: input.runId,
        index: idx,
        inputUrl: url,
        status: "queued" as const,
      })),
    );
  }
  return await db
    .select({ id: runPhotos.id, index: runPhotos.index, inputUrl: runPhotos.inputUrl })
    .from(runPhotos)
    .where(eq(runPhotos.runId, input.runId));
}

// load selected boards and their pin urls for the run
async function loadBoardsStep(input: { runId: string }) {
  "use step";
  const links = await db
    .select({
      boardId: runBoards.boardId,
      title: pinterestBoards.title,
      description: pinterestBoards.description,
    })
    .from(runBoards)
    .innerJoin(pinterestBoards, eq(pinterestBoards.id, runBoards.boardId))
    .where(eq(runBoards.runId, input.runId));

  if (!links.length) return { boards: [], pinsByBoard: {} as Record<string, string[]> };

  const boardIds = links.map((l) => l.boardId);
  const pins = await db
    .select({ boardId: pinterestPins.boardId, imageUrl: pinterestPins.imageUrl })
    .from(pinterestPins)
    .where(inArray(pinterestPins.boardId, boardIds));

  const pinsByBoard: Record<string, string[]> = {};
  for (const p of pins) {
    (pinsByBoard[p.boardId] ??= []).push(p.imageUrl);
  }
  return {
    boards: links.map((l) => ({ id: l.boardId, title: l.title, description: l.description })),
    pinsByBoard,
  };
}

// launch one child workflow per photo
// each child runs independently with its own event log so the parent never has
// more than one step in flight which keeps the parent event log small enough to
// stay healthy on Vercel at-least-once delivery
//
// each child workflow runId is persisted on its runPhoto row so a later /cancel
// call can call run.cancel() on the in-flight children
async function kickoffPhotoWorkflowsStep(input: {
  runId: string;
  modelTier: ModelTier;
  photos: Array<{ id: string; index: number; inputUrl: string }>;
  boards: Array<{ id: string; title: string; description?: string | null }>;
  pinsByBoard: Record<string, string[]>;
}) {
  "use step";
  // we are inside a step (full Node.js context) so Promise.all here is just
  // regular JS concurrency for HTTP fan-out - no WDK replay semantics involved
  const launches = await Promise.all(
    input.photos.map(async (p) => {
      const args: ProcessPhotoInput = {
        runId: input.runId,
        photoId: p.id,
        photoIndex: p.index,
        photoUrl: p.inputUrl,
        modelTier: input.modelTier,
        boards: input.boards,
        pinsByBoard: input.pinsByBoard,
      };
      const handle = await start(processPhotoWorkflow, [args]);
      return { photoId: p.id, workflowRunId: handle.runId };
    }),
  );

  // persist child workflow run ids for later cancellation
  await Promise.all(
    launches.map((l) =>
      db
        .update(runPhotos)
        .set({ workflowRunId: l.workflowRunId })
        .where(eq(runPhotos.id, l.photoId)),
    ),
  );

  const launched = launches.map((l) => l.workflowRunId);
  console.log(
    `stageRun ${input.runId}: launched ${launched.length} child processPhotoWorkflow runs`,
  );
  return launched;
}

// snapshot the per-photo settlement state used by the parent poll loop
// also reports whether the user has marked the run as cancelled so the parent
// can stop early without waiting for every child to finish
async function checkRunProgressStep(input: { runId: string }) {
  "use step";
  const [runRow] = await db
    .select({ status: runs.status })
    .from(runs)
    .where(eq(runs.id, input.runId));
  const rows = await db
    .select({ status: runPhotos.status })
    .from(runPhotos)
    .where(eq(runPhotos.runId, input.runId));
  let done = 0;
  let failed = 0;
  let cancelled = 0;
  for (const r of rows) {
    if (r.status === "done") done++;
    else if (r.status === "failed") failed++;
    else if (r.status === "cancelled") cancelled++;
  }
  return {
    done,
    failed,
    cancelled,
    total: rows.length,
    runCancelled: runRow?.status === "cancelled",
  };
}

// finalize the run header (status + finishedAt)
// when finalizing as cancelled also mark any still-pending photos as cancelled
// so the ui does not show them stuck in "queued" forever
async function finalizeRunStep(input: {
  runId: string;
  status: "done" | "failed" | "cancelled";
  error?: string;
}) {
  "use step";
  await db
    .update(runs)
    .set({
      status: input.status,
      finishedAt: new Date(),
      error: input.error ?? null,
    })
    .where(eq(runs.id, input.runId));
  if (input.status === "cancelled") {
    await db
      .update(runPhotos)
      .set({ status: "cancelled", finishedAt: new Date() })
      .where(
        and(
          eq(runPhotos.runId, input.runId),
          inArray(runPhotos.status, ["queued", "classifying", "matched", "staging"]),
        ),
      );
  }
}

// poll up to ~30 minutes (180 polls * 10s)
// plenty of headroom for 44 photos of pro-tier staging while keeping the parent
// event log bounded
const POLL_INTERVAL = "10s";
const MAX_POLLS = 180;

// kicked off by POST /api/runs
export async function stageRunWorkflow(input: { runId: string; modelTier: ModelTier }) {
  "use workflow";

  try {
    const run = await loadRunHeaderStep({ runId: input.runId });
    if (!run) throw new Error(`run ${input.runId} not found`);
    // user may have cancelled before the workflow even started its first step
    if (run.status === "cancelled") {
      await finalizeRunStep({ runId: input.runId, status: "cancelled" });
      return;
    }

    const listing = await fetchZillowStep({ zillowUrl: run.zillowUrl });

    const photoRows = await initRunStep({
      runId: input.runId,
      address: listing.address,
      photos: listing.photos,
    });

    const { boards, pinsByBoard } = await loadBoardsStep({ runId: input.runId });

    if (photoRows.length === 0) {
      await finalizeRunStep({ runId: input.runId, status: "done" });
      return;
    }

    await kickoffPhotoWorkflowsStep({
      runId: input.runId,
      modelTier: input.modelTier,
      photos: photoRows,
      boards,
      pinsByBoard,
    });

    // poll until every photo row is settled (done | failed | cancelled) or until
    // the user marks the run as cancelled - bounded by MAX_POLLS
    let timedOut = true;
    let cancelledByUser = false;
    for (let i = 0; i < MAX_POLLS; i++) {
      await sleep(POLL_INTERVAL);
      const progress = await checkRunProgressStep({ runId: input.runId });
      if (progress.runCancelled) {
        cancelledByUser = true;
        timedOut = false;
        break;
      }
      if (progress.done + progress.failed + progress.cancelled >= progress.total) {
        timedOut = false;
        break;
      }
    }

    if (cancelledByUser) {
      await finalizeRunStep({ runId: input.runId, status: "cancelled" });
      return;
    }

    if (timedOut) {
      await finalizeRunStep({
        runId: input.runId,
        status: "failed",
        error: `timed out waiting for photo workflows after ${MAX_POLLS} polls`,
      });
      return;
    }

    await finalizeRunStep({ runId: input.runId, status: "done" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`stageRun ${input.runId} failed:`, message);
    await finalizeRunStep({ runId: input.runId, status: "failed", error: message.slice(0, 500) });
    throw err;
  }
}
