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

type MixedSourcePhoto = {
  mixedSources?: { jpeg?: ResponsivePhoto[]; webp?: ResponsivePhoto[] };
};

// the actor emits a normalized payload (listingPhotos listingAddress listingPrice lotArea)
// older builds emitted raw zillow internals (responsivePhotos address resoFacts hdpData)
// we read both so a schema flip on apify's side degrades instead of failing the run
type RawListing = {
  // current normalized shape
  listingPhotos?: Array<{ url?: string; caption?: string | null }>;
  mainImage?: { thumbnail?: string; medium?: string; hiRes?: string };
  listingAddress?: {
    street?: string;
    unit?: string | null;
    city?: string;
    state?: string;
    zipCode?: string;
    full?: string;
  };
  listingPrice?: { amount?: number | string | null; formatted?: string | null };
  lotArea?: { value?: number | string | null; unit?: string | null; formatted?: string | null };
  photoCount?: number;

  // legacy raw shape
  address?: {
    streetAddress?: string;
    city?: string;
    state?: string;
    zipcode?: string;
  };
  abbreviatedAddress?: string;
  hdpUrl?: string;
  photos?: MixedSourcePhoto[];
  responsivePhotos?: MixedSourcePhoto[];
  price?: number | string;
  lotSize?: number | string;
  lotAreaValue?: number;
  lotAreaUnits?: string; // "acres" | "sqft"
  livingAreaValue?: number;

  // present in both shapes
  bedrooms?: number;
  bathrooms?: number;
  livingArea?: number | string;
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

// gallery urls from whichever photo shape the actor gave us
// mainImage is a last resort so a thin listing still yields one stageable photo
function extractPhotos(raw: RawListing): string[] {
  const listingPhotos = (raw.listingPhotos ?? [])
    .map((p) => p?.url)
    .filter((u): u is string => Boolean(u));
  const legacy = (raw.responsivePhotos ?? raw.photos ?? [])
    .map((p) => pickLargestJpeg(p?.mixedSources))
    .filter((u): u is string => Boolean(u));
  const fallback = [raw.mainImage?.hiRes, raw.mainImage?.medium].filter((u): u is string =>
    Boolean(u),
  );
  const picked = listingPhotos.length ? listingPhotos : legacy.length ? legacy : fallback.slice(0, 1);
  return [...new Set(picked)];
}

// build a friendly address string from listing parts
function formatAddress(raw: RawListing): string {
  const la = raw.listingAddress;
  if (la?.full?.trim()) return la.full.trim();
  if (la) {
    const street = [la.street, la.unit].filter(Boolean).join(" ").trim();
    const region = [la.state, la.zipCode].filter(Boolean).join(" ").trim();
    const parts = [street, la.city, region].filter(Boolean);
    if (parts.length) return parts.join(", ");
  }
  if (raw.abbreviatedAddress) return raw.abbreviatedAddress;
  const a = raw.address;
  if (!a) return "Unknown address";
  const parts = [a.streetAddress, a.city, a.state, a.zipcode].filter(Boolean);
  return parts.join(", ") || "Unknown address";
}

// coerce arbitrary apify field shapes (number | numeric string | null) to number
// zero means "unknown" in this payload (eg livingArea 0 on condos) so it maps to null
function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : null;
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

// render a lot area value + unit into a display string
function formatLotArea(value: number, unit: string): string | null {
  const u = unit.toLowerCase();
  if (u.startsWith("acre")) {
    return `${value < 10 ? value.toFixed(2) : Math.round(value)} acres`;
  }
  if (u.startsWith("sq")) return `${value.toLocaleString("en-US")} sqft`;
  // no unit given - a huge number is almost certainly sqft
  if (value >= 43560) return `${value.toLocaleString("en-US")} sqft`;
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

  const price = firstOf(
    toNumber(raw.listingPrice?.amount),
    toNumber(raw.price),
    toNumber(home.price),
  );
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
  const formatted = firstOf(
    typeof raw.lotArea?.formatted === "string" ? raw.lotArea.formatted.trim() || null : null,
    typeof reso.lotSize === "string" ? reso.lotSize.trim() || null : null,
    typeof raw.lotSize === "string" ? raw.lotSize.trim() || null : null,
  );
  let lotSize = formatted;
  if (!lotSize) {
    const lotVal = firstOf(
      toNumber(raw.lotArea?.value),
      toNumber(raw.lotAreaValue),
      toNumber(home.lotAreaValue),
    );
    const lotUnit = raw.lotArea?.unit ?? raw.lotAreaUnits ?? home.lotAreaUnit ?? "";
    if (lotVal != null) lotSize = formatLotArea(lotVal, lotUnit);
  }

  return { price, beds, baths, livingAreaSqft, lotSize };
}

// map one raw apify dataset item to our listing shape
export function parseZillowListing(listing: RawListing): ZillowListing {
  return {
    address: formatAddress(listing),
    photos: extractPhotos(listing),
    ...extractMetadata(listing),
  };
}

// fetch listing photos and address from a zillow url
export async function fetchZillowListing(zillowUrl: string): Promise<ZillowListing> {
  const url = normalizeZillowUrl(zillowUrl);
  // actor input schema https://apify.com/maxcopell/zillow-detail-scraper/input-schema
  // - field is `startUrls` (NOT propertyUrls -- using the wrong key makes the run fail with no work)
  // - propertyStatus is omitted on purpose - the actor detects it and hardcoding FOR_SALE
  //   returns a thin record for sold or off-market listings
  const items = await runActor<RawListing>("maxcopell/zillow-detail-scraper", {
    startUrls: [{ url }],
  });
  const listing = items[0];
  if (!listing) throw new Error(`zillow returned no listing for ${url}`);
  const parsed = parseZillowListing(listing);
  if (!parsed.photos.length) {
    throw new Error(
      `zillow listing has no photos: ${url} (actor returned keys ${Object.keys(listing).join("|")})`,
    );
  }
  return parsed;
}
