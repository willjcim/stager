// zillow listing fetch via apify maxcopell/zillow-detail-scraper
// returns address (for run title) full hi-res photo gallery and listing metadata
import { runActor } from "@/lib/apify";

export type ZillowListing = {
  address: string;
  photos: string[]; // hi-res image urls
  price: number | null; // dollars
  beds: number | null;
  baths: number | null;
  livingAreaSqft: number | null;
  lotSize: string | null; // pre-formatted display string
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
  // listing facts - the actor exposes these under multiple shapes
  price?: number | string;
  bedrooms?: number;
  bathrooms?: number;
  livingArea?: number | string;
  livingAreaValue?: number;
  lotSize?: number | string;
  lotAreaValue?: number;
  lotAreaUnits?: string; // "acres" | "sqft"
  resoFacts?: {
    lotSize?: string;
    livingArea?: string;
    bedrooms?: number | string;
    bathrooms?: number | string;
  };
  hdpData?: {
    homeInfo?: {
      price?: number;
      bedrooms?: number;
      bathrooms?: number;
      livingArea?: number;
      lotAreaValue?: number;
      lotAreaUnit?: string;
    };
  };
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

// coerce arbitrary apify field shapes (number | numeric string | null) to number
function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

// pick the first non-null result from a list of getters
function firstOf<T>(...vals: Array<T | null | undefined>): T | null {
  for (const v of vals) if (v != null) return v;
  return null;
}

// pull listing metadata out of the (very inconsistent) apify payload
function extractMetadata(raw: RawListing): {
  price: number | null;
  beds: number | null;
  baths: number | null;
  livingAreaSqft: number | null;
  lotSize: string | null;
} {
  const home = raw.hdpData?.homeInfo ?? {};
  const reso = raw.resoFacts ?? {};

  const price = firstOf(toNumber(raw.price), toNumber(home.price));
  const beds = firstOf(toNumber(raw.bedrooms), toNumber(home.bedrooms), toNumber(reso.bedrooms));
  const baths = firstOf(
    toNumber(raw.bathrooms),
    toNumber(home.bathrooms),
    toNumber(reso.bathrooms),
  );
  const livingAreaSqft = firstOf(
    toNumber(raw.livingAreaValue),
    toNumber(raw.livingArea),
    toNumber(home.livingArea),
    toNumber(reso.livingArea),
  );

  // lot size - prefer a pre-formatted display string then fall back to value+unit
  let lotSize: string | null = null;
  if (typeof reso.lotSize === "string" && reso.lotSize.trim()) {
    lotSize = reso.lotSize.trim();
  } else if (typeof raw.lotSize === "string" && raw.lotSize.trim()) {
    lotSize = raw.lotSize.trim();
  } else {
    const lotVal = firstOf(toNumber(raw.lotAreaValue), toNumber(home.lotAreaValue));
    const lotUnit = (raw.lotAreaUnits ?? home.lotAreaUnit ?? "").toLowerCase();
    if (lotVal != null) {
      if (lotUnit.startsWith("acre")) {
        lotSize = `${lotVal < 10 ? lotVal.toFixed(2) : Math.round(lotVal)} acres`;
      } else if (lotUnit.startsWith("sq")) {
        lotSize = `${lotVal.toLocaleString("en-US")} sqft`;
      } else if (lotVal >= 43560) {
        // assume sqft when we have no unit and value is huge
        lotSize = `${lotVal.toLocaleString("en-US")} sqft`;
      }
    }
  }

  return { price, beds, baths, livingAreaSqft, lotSize };
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
    ...extractMetadata(listing),
  };
}
