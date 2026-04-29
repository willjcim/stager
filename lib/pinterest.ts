// pinterest board fetch via apify devcake/pinterest-board-scraper
// returns the board title plus pin records with hi-res image urls
import { runActor } from "@/lib/apify";

export type PinterestPin = {
  imageUrl: string;
  width?: number;
  height?: number;
};

export type PinterestBoard = {
  title: string;
  description?: string;
  pins: PinterestPin[];
};

type RawPin = {
  imageUrl?: string;
  // devcake actor exposes multiple sizes including orig
  images?: {
    orig?: { url?: string; width?: number; height?: number };
    "736x"?: { url?: string };
    "564x"?: { url?: string };
    "474x"?: { url?: string };
    "236x"?: { url?: string };
  };
  width?: number;
  height?: number;
  board?: { name?: string; description?: string };
};

// pick the best resolution image url from a raw pin
function pickPinImage(p: RawPin): string | null {
  return (
    p.images?.orig?.url ??
    p.images?.["736x"]?.url ??
    p.images?.["564x"]?.url ??
    p.images?.["474x"]?.url ??
    p.images?.["236x"]?.url ??
    p.imageUrl ??
    null
  );
}

// derive a clean board title from the url path when scraper omits one
function titleFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const segments = u.pathname.split("/").filter(Boolean);
    const slug = segments[segments.length - 1] ?? "board";
    return slug.replace(/[-_]+/g, " ").trim() || "Pinterest board";
  } catch {
    return "Pinterest board";
  }
}

// scrape a pinterest board url and return its pins
export async function fetchPinterestBoard(boardUrl: string, maxPins = 100): Promise<PinterestBoard> {
  const items = await runActor<RawPin>("devcake/pinterest-board-scraper", {
    startUrls: [{ url: boardUrl }],
    maxResults: maxPins,
    proxyConfig: { useApifyProxy: true },
  });
  const pins: PinterestPin[] = [];
  for (const raw of items) {
    const url = pickPinImage(raw);
    if (!url) continue;
    pins.push({
      imageUrl: url,
      width: raw.images?.orig?.width ?? raw.width,
      height: raw.images?.orig?.height ?? raw.height,
    });
  }
  const first = items[0];
  return {
    title: first?.board?.name?.trim() || titleFromUrl(boardUrl),
    description: first?.board?.description,
    pins,
  };
}
