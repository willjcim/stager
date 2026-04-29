// generic apify actor runner using the sync run-and-get-dataset endpoint
const APIFY_BASE = "https://api.apify.com/v2";

// run an actor and return its dataset items
// actorId form is "username/actor-name" eg "maxcopell/zillow-detail-scraper"
export async function runActor<T = unknown>(
  actorId: string,
  input: unknown,
  opts: { timeoutSecs?: number } = {},
): Promise<T[]> {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN is not set");
  const slug = actorId.replace("/", "~");
  const url = `${APIFY_BASE}/acts/${slug}/run-sync-get-dataset-items?token=${token}${
    opts.timeoutSecs ? `&timeout=${opts.timeoutSecs}` : ""
  }`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input ?? {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`apify ${actorId} -> ${res.status}: ${text.slice(0, 500)}`);
  }
  return (await res.json()) as T[];
}
