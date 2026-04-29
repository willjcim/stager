// pdf export of a completed run
// landscape letter cover page + one page per photo (original | staged side-by-side)
// images are pre-shrunk via sharp so the file stays a few MB rather than ~50
import { eq, asc } from "drizzle-orm";
import { PDFDocument, StandardFonts, rgb, type PDFImage } from "pdf-lib";
import sharp from "sharp";
import { db } from "@/lib/db";
import { runs, runPhotos, runBoards, pinterestBoards } from "@/db/schema";

// page geometry (landscape letter 72dpi)
const PAGE_W = 792;
const PAGE_H = 612;
const MARGIN = 36;

// per-image target dimensions before embedding
// keeps the pdf under ~10mb even for 50-photo runs while still looking sharp
const IMAGE_TARGET_WIDTH = 1200;
const IMAGE_QUALITY = 80;

type RunRow = typeof runs.$inferSelect;
type PhotoRow = typeof runPhotos.$inferSelect;

// download and re-encode one image to a small jpeg buffer
async function fetchAndShrink(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return await sharp(buf)
      .rotate() // honor exif orientation
      .resize({ width: IMAGE_TARGET_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: IMAGE_QUALITY, mozjpeg: true })
      .toBuffer();
  } catch (err) {
    console.warn(`pdf: failed to fetch ${url}`, err);
    return null;
  }
}

// embed a buffer (or null) into the pdf and return a PDFImage we can draw later
async function embedJpeg(pdf: PDFDocument, buf: Buffer | null): Promise<PDFImage | null> {
  if (!buf) return null;
  try {
    return await pdf.embedJpg(buf);
  } catch {
    return null;
  }
}

// fit-and-center an image inside a box preserving aspect ratio
function drawImageContain(
  page: ReturnType<PDFDocument["addPage"]>,
  img: PDFImage,
  box: { x: number; y: number; w: number; h: number },
) {
  const scale = Math.min(box.w / img.width, box.h / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  page.drawImage(img, {
    x: box.x + (box.w - w) / 2,
    y: box.y + (box.h - h) / 2,
    width: w,
    height: h,
  });
}

export type PdfRunData = {
  run: RunRow;
  photos: PhotoRow[];
  boards: Array<{ id: string; title: string }>;
};

// load everything needed for the export
// caller verifies ownership separately
export async function loadRunForExport(runId: string): Promise<PdfRunData | null> {
  const [runRow] = await db.select().from(runs).where(eq(runs.id, runId));
  if (!runRow) return null;
  const photos = await db
    .select()
    .from(runPhotos)
    .where(eq(runPhotos.runId, runId))
    .orderBy(asc(runPhotos.index));
  const boards = await db
    .select({ id: pinterestBoards.id, title: pinterestBoards.title })
    .from(runBoards)
    .innerJoin(pinterestBoards, eq(pinterestBoards.id, runBoards.boardId))
    .where(eq(runBoards.runId, runId));
  return { run: runRow, photos, boards };
}

export async function generateRunPdf(data: PdfRunData): Promise<Uint8Array> {
  const { run, photos, boards } = data;
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Stager Re-staging — ${run.address || run.id}`);
  pdf.setAuthor("Stager");
  pdf.setCreator("Stager");

  const fontRegular = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const fontMono = await pdf.embedFont(StandardFonts.Courier);

  const boardTitleById = Object.fromEntries(boards.map((b) => [b.id, b.title]));

  // ---------- cover page ----------
  const cover = pdf.addPage([PAGE_W, PAGE_H]);
  const muted = rgb(0.4, 0.4, 0.4);
  const text = rgb(0.1, 0.1, 0.1);

  cover.drawText("STAGER", {
    x: MARGIN,
    y: PAGE_H - MARGIN - 12,
    size: 10,
    font: fontMono,
    color: muted,
  });

  // address title (truncate when it would overflow)
  const titleSize = 28;
  const titleMaxWidth = PAGE_W - MARGIN * 2;
  let title = run.address || "Untitled run";
  while (fontBold.widthOfTextAtSize(title, titleSize) > titleMaxWidth && title.length > 6) {
    title = title.slice(0, -2);
  }
  cover.drawText(title, {
    x: MARGIN,
    y: PAGE_H - MARGIN - 60,
    size: titleSize,
    font: fontBold,
    color: text,
  });

  const completed = run.finishedAt ?? run.createdAt;
  const dateStr = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(completed));

  const meta = [
    ["Completed", dateStr],
    ["Model", run.modelTier === "pro" ? "Gemini 3 Pro" : "Gemini 3 Flash"],
    ["Photos", `${run.completedCount} staged${run.failedCount ? ` · ${run.failedCount} failed` : ""}`],
    ["Style references", boards.length ? boards.map((b) => b.title).join(", ") : "—"],
  ];

  let y = PAGE_H - MARGIN - 130;
  for (const [k, v] of meta) {
    cover.drawText(k, { x: MARGIN, y, size: 9, font: fontMono, color: muted });
    // value can wrap onto multiple lines if it is the boards list
    const valueMaxWidth = PAGE_W - MARGIN * 2 - 110;
    const lines = wrapText(v, fontRegular, 12, valueMaxWidth);
    let lineY = y;
    for (const line of lines) {
      cover.drawText(line, { x: MARGIN + 110, y: lineY, size: 12, font: fontRegular, color: text });
      lineY -= 16;
    }
    y -= Math.max(28, lines.length * 16 + 12);
  }

  // footer
  cover.drawText(
    "Re-staged with Stager · stager.vercel.app",
    {
      x: MARGIN,
      y: MARGIN,
      size: 8,
      font: fontMono,
      color: muted,
    },
  );

  // ---------- one page per staged photo ----------
  // skip photos that do not have a staged output - nothing useful to show
  const exported = photos.filter((p) => p.outputUrl);

  // pre-fetch + shrink all images in parallel
  // capped concurrency would be safer for very large runs but typical zillow
  // listings are ~30-50 photos
  const imagePairs = await Promise.all(
    exported.map(async (p) => ({
      photo: p,
      input: await fetchAndShrink(p.inputUrl),
      output: p.outputUrl ? await fetchAndShrink(p.outputUrl) : null,
    })),
  );

  for (let i = 0; i < imagePairs.length; i++) {
    const { photo, input, output } = imagePairs[i];
    const page = pdf.addPage([PAGE_W, PAGE_H]);

    // page header - "Photo N of M  ·  room type  ·  board"
    const matched = photo.matchedBoardId ? boardTitleById[photo.matchedBoardId] : null;
    const header = [
      `Photo ${i + 1} of ${imagePairs.length}`,
      photo.classifiedTheme ? toTitleCase(photo.classifiedTheme) : null,
      matched ? `← ${matched}` : null,
    ]
      .filter(Boolean)
      .join("  ·  ");
    page.drawText(header, {
      x: MARGIN,
      y: PAGE_H - MARGIN - 4,
      size: 10,
      font: fontMono,
      color: muted,
    });

    // labels above each image slot
    const labelY = PAGE_H - MARGIN - 30;
    page.drawText("BEFORE", { x: MARGIN, y: labelY, size: 9, font: fontBold, color: muted });
    page.drawText("AFTER", {
      x: PAGE_W / 2 + 8,
      y: labelY,
      size: 9,
      font: fontBold,
      color: muted,
    });

    const imgBoxH = PAGE_H - MARGIN - 60 - MARGIN;
    const imgBoxW = (PAGE_W - MARGIN * 2 - 16) / 2;
    const inputBox = { x: MARGIN, y: MARGIN, w: imgBoxW, h: imgBoxH };
    const outputBox = { x: MARGIN + imgBoxW + 16, y: MARGIN, w: imgBoxW, h: imgBoxH };

    const inputImg = await embedJpeg(pdf, input);
    if (inputImg) drawImageContain(page, inputImg, inputBox);
    else drawPlaceholder(page, inputBox, "image unavailable", fontRegular, muted);

    const outputImg = await embedJpeg(pdf, output);
    if (outputImg) drawImageContain(page, outputImg, outputBox);
    else drawPlaceholder(page, outputBox, "image unavailable", fontRegular, muted);
  }

  return await pdf.save();
}

function drawPlaceholder(
  page: ReturnType<PDFDocument["addPage"]>,
  box: { x: number; y: number; w: number; h: number },
  label: string,
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  color: ReturnType<typeof rgb>,
) {
  page.drawRectangle({
    x: box.x,
    y: box.y,
    width: box.w,
    height: box.h,
    color: rgb(0.95, 0.95, 0.95),
  });
  const w = font.widthOfTextAtSize(label, 11);
  page.drawText(label, {
    x: box.x + (box.w - w) / 2,
    y: box.y + box.h / 2 - 5,
    size: 11,
    font,
    color,
  });
}

// simple word-wrap that breaks on spaces (good enough for board names + "etc")
function wrapText(
  s: string,
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  size: number,
  maxWidth: number,
): string[] {
  const words = s.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [s];
}

function toTitleCase(s: string) {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}
