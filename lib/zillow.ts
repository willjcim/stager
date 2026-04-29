// zillow listing fetch via apify maxcopell/zillow-detail-scraper
// returns address (for run title) plus full hi-res photo gallery
import { runActor } from "@/lib/apify";

export type ZillowListing = {
  address: string;
  photos: string[]; // hi-res image urls
};

// strip tracking params and hash so the scraper sees the canonical detail url
// share links from txt or email arrive with utm_* params that confuse the actor
export function normalizeZillowUrl(input: string): string {
  try {
    const u = new URL(input.trim());
    u.search = "";
    u.hash = "";
    u.hostname = u.hostname.toLowerCase();
    return u.toString();
  } catch {
    return input.trim();
  }
}

type ResponsivePhoto = {
  url?: string;
  width?: number;
};

type RawListing = {
  address?: {
    streetAddress?: string;
    city?: string;
    state?: string;
    zipcode?: string;
  };
  abbreviatedAddress?: string;
  hdpUrl?: string;
  photos?: Array<{
    mixedSources?: { jpeg?: ResponsivePhoto[]; webp?: ResponsivePhoto[] };
  }>;
  responsivePhotos?: Array<{
    mixedSources?: { jpeg?: ResponsivePhoto[]; webp?: ResponsivePhoto[] };
  }>;
};

// pick the largest jpeg url out of a mixedSources block
function pickLargestJpeg(sources?: { jpeg?: ResponsivePhoto[] }): string | null {
  if (!sources?.jpeg?.length) return null;
  const sorted = [...sources.jpeg].sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  return sorted[0]?.url ?? null;
}

// build a friendly address string from listing parts
function formatAddress(raw: RawListing): string {
  if (raw.abbreviatedAddress) return raw.abbreviatedAddress;
  const a = raw.address;
  if (!a) return "Unknown address";
  const parts = [a.streetAddress, a.city, a.state, a.zipcode].filter(Boolean);
  return parts.join(", ") || "Unknown address";
}

// fetch listing photos and address from a zillow url
export async function fetchZillowListing(zillowUrl: string): Promise<ZillowListing> {
  const url = normalizeZillowUrl(zillowUrl);
  // actor input schema https://apify.com/maxcopell/zillow-detail-scraper/input-schema
  // - field is `startUrls` (NOT propertyUrls -- using the wrong key makes the run fail with no work)
  // - propertyStatus is optional but skips a probing round-trip when correct
  const items = await runActor<RawListing>("maxcopell/zillow-detail-scraper", {
    startUrls: [{ url }],
    propertyStatus: "FOR_SALE",
  });
  const listing = items[0];
  if (!listing) throw new Error(`zillow returned no listing for ${url}`);
  const sources = listing.responsivePhotos ?? listing.photos ?? [];
  const photos = sources
    .map((p) => pickLargestJpeg(p.mixedSources))
    .filter((u): u is string => Boolean(u));
  if (!photos.length) throw new Error(`zillow listing has no photos: ${url}`);
  return {
    address: formatAddress(listing),
    photos,
  };
}
