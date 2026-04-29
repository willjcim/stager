// ingest-board workflow
// scrape pinterest -> rehost pin images to vercel blob -> insert pins -> mark ready
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { pinterestBoards, pinterestPins } from "@/db/schema";
import { fetchPinterestBoard, type PinterestPin } from "@/lib/pinterest";
import { uploadFromUrl, blobPath } from "@/lib/blob";

// scrape pinterest into structured pins
async function scrapeBoardStep(input: { boardUrl: string; maxPins: number }) {
  "use step";
  return fetchPinterestBoard(input.boardUrl, input.maxPins);
}

// rehost a single pin image to our blob bucket
async function rehostPinStep(input: {
  userId: string;
  boardId: string;
  index: number;
  pin: PinterestPin;
}) {
  "use step";
  const path = blobPath("boards", input.userId, input.boardId, `${input.index}.jpg`);
  const blobUrl = await uploadFromUrl(path, input.pin.imageUrl);
  return { blobUrl, originalUrl: input.pin.imageUrl, width: input.pin.width, height: input.pin.height };
}

// persist board metadata and pins in postgres
async function persistBoardStep(input: {
  boardId: string;
  title: string;
  description?: string | null;
  pins: Array<{ blobUrl: string; originalUrl: string; width?: number; height?: number }>;
}) {
  "use step";
  // wipe and re-insert pins on every refresh so we never accumulate stale rows
  await db.delete(pinterestPins).where(eq(pinterestPins.boardId, input.boardId));
  if (input.pins.length) {
    await db.insert(pinterestPins).values(
      input.pins.map((p) => ({
        boardId: input.boardId,
        imageUrl: p.blobUrl,
        originalUrl: p.originalUrl,
        width: p.width,
        height: p.height,
      })),
    );
  }
  await db
    .update(pinterestBoards)
    .set({
      title: input.title,
      description: input.description ?? null,
      pinCount: input.pins.length,
      status: "ready",
      lastFetchedAt: new Date(),
    })
    .where(eq(pinterestBoards.id, input.boardId));
}

// mark board failed and persist the error
async function markBoardFailedStep(input: { boardId: string; error: string }) {
  "use step";
  await db
    .update(pinterestBoards)
    .set({ status: "failed", description: input.error.slice(0, 500) })
    .where(eq(pinterestBoards.id, input.boardId));
}

// orchestrate scrape -> rehost (parallel) -> persist
export async function ingestBoardWorkflow(input: {
  userId: string;
  boardId: string;
  boardUrl: string;
  maxPins?: number;
}) {
  "use workflow";

  try {
    const board = await scrapeBoardStep({
      boardUrl: input.boardUrl,
      maxPins: input.maxPins ?? 60,
    });

    const rehosted = await Promise.all(
      board.pins.map((pin, i) =>
        rehostPinStep({
          userId: input.userId,
          boardId: input.boardId,
          index: i,
          pin,
        }),
      ),
    );

    await persistBoardStep({
      boardId: input.boardId,
      title: board.title,
      description: board.description,
      pins: rehosted,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markBoardFailedStep({ boardId: input.boardId, error: message });
    throw err;
  }
}
