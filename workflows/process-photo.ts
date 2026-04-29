// process-photo workflow
// per-photo child workflow kicked off by stage-run
// each photo is its own workflow run with its own small event log to avoid the
// "Unconsumed event in event log" runtime errors from a fat parent fan-out
// the per-photo pipeline (classify -> match -> stage -> upload) lives in a
// single fat step so the workflow event log stays at one step
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { runs, runPhotos } from "@/db/schema";
import { classifyPhotoStep, matchBoardStep } from "@/lib/classify";
import { stagePhotoStep, type ModelTier } from "@/lib/staging";
import { uploadBytes, blobPath } from "@/lib/blob";

export type ProcessPhotoInput = {
  runId: string;
  photoId: string;
  photoIndex: number;
  photoUrl: string;
  modelTier: ModelTier;
  boards: Array<{ id: string; title: string; description?: string | null }>;
  pinsByBoard: Record<string, string[]>;
};

// recompute aggregate counters for the parent run from per-photo rows
// called inline at the end of every photo so the parent ui sees fresh counts
async function bumpRunCounters(runId: string) {
  const rows = await db
    .select({ status: runPhotos.status })
    .from(runPhotos)
    .where(eq(runPhotos.runId, runId));
  const done = rows.filter((r) => r.status === "done").length;
  const failed = rows.filter((r) => r.status === "failed").length;
  await db
    .update(runs)
    .set({ completedCount: done, failedCount: failed })
    .where(eq(runs.id, runId));
}

// true when the parent run row is marked cancelled
// polled at safe boundaries inside the photo step so a user-triggered cancel
// stops the pipeline before launching the next expensive ai call
async function isRunCancelled(runId: string): Promise<boolean> {
  const [r] = await db
    .select({ status: runs.status })
    .from(runs)
    .where(eq(runs.id, runId));
  return r?.status === "cancelled";
}

// drive a single photo through classify -> match -> stage -> upload as one atomic step
// every phase transition is a plain db write (the live progress ui polls runPhotos.status)
// this step never throws - failures are recorded on the row so the child workflow always exits cleanly
async function processPhotoStep(input: ProcessPhotoInput) {
  "use step";
  try {
    // user cancelled before this child even started - short-circuit
    if (await isRunCancelled(input.runId)) {
      await db
        .update(runPhotos)
        .set({ status: "cancelled", finishedAt: new Date() })
        .where(eq(runPhotos.id, input.photoId));
      return;
    }

    await db
      .update(runPhotos)
      .set({ status: "classifying", startedAt: new Date() })
      .where(eq(runPhotos.id, input.photoId));

    // calls to other "use step" functions from inside a step run inline as plain
    // async calls (no nested event log entries no separate retry layer)
    const cls = await classifyPhotoStep({ photoUrl: input.photoUrl });
    if (await isRunCancelled(input.runId)) {
      await db
        .update(runPhotos)
        .set({ status: "cancelled", finishedAt: new Date() })
        .where(eq(runPhotos.id, input.photoId));
      return;
    }
    const match = await matchBoardStep({ theme: cls.theme, boards: input.boards });

    // confidence below 0.30 -> fall back to all-boards reference set
    const useAllBoards = match.confidence < 0.3 || !match.boardId;
    const refImageUrls = useAllBoards
      ? Object.values(input.pinsByBoard).flat()
      : (input.pinsByBoard[match.boardId!] ?? []);

    await db
      .update(runPhotos)
      .set({
        status: "matched",
        classifiedTheme: cls.theme,
        classificationConfidence: cls.confidence,
        matchedBoardId: useAllBoards ? null : match.boardId,
        matchConfidence: match.confidence,
      })
      .where(eq(runPhotos.id, input.photoId));

    if (await isRunCancelled(input.runId)) {
      await db
        .update(runPhotos)
        .set({ status: "cancelled", finishedAt: new Date() })
        .where(eq(runPhotos.id, input.photoId));
      return;
    }

    await db
      .update(runPhotos)
      .set({ status: "staging" })
      .where(eq(runPhotos.id, input.photoId));

    const result = await stagePhotoStep({
      photoUrl: input.photoUrl,
      refImageUrls,
      modelTier: input.modelTier,
    });

    const ext = result.mediaType.includes("png") ? "png" : "jpg";
    const outputPath = blobPath("runs", input.runId, `${input.photoIndex}.${ext}`);
    const buf = Buffer.from(result.base64, "base64");
    const outputUrl = await uploadBytes(outputPath, buf, result.mediaType);

    await db
      .update(runPhotos)
      .set({ status: "done", outputUrl, finishedAt: new Date() })
      .where(eq(runPhotos.id, input.photoId));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `processPhotoStep ${input.photoId} (idx ${input.photoIndex}) failed:`,
      message,
    );
    try {
      await db
        .update(runPhotos)
        .set({ status: "failed", error: message.slice(0, 500), finishedAt: new Date() })
        .where(eq(runPhotos.id, input.photoId));
    } catch (innerErr) {
      console.error(
        `processPhotoStep ${input.photoId}: failed to record failure:`,
        innerErr,
      );
    }
  } finally {
    try {
      await bumpRunCounters(input.runId);
    } catch (counterErr) {
      console.error(
        `processPhotoStep ${input.photoId}: failed to bump counters:`,
        counterErr,
      );
    }
  }
}

// thin workflow wrapper around processPhotoStep so it can be launched via
// start(processPhotoWorkflow [...]) from the parent stage-run workflow
export async function processPhotoWorkflow(input: ProcessPhotoInput) {
  "use workflow";
  await processPhotoStep(input);
}
