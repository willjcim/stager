// thin vercel blob helpers with a consistent prefix layout {kind}/{userId}/{...}
import { put, del } from "@vercel/blob";

type BlobKind = "boards" | "runs" | "tmp";

// upload bytes and return the public url
export async function uploadBytes(
  pathname: string,
  data: Buffer | string,
  contentType = "image/jpeg",
) {
  const blob = await put(pathname, data, {
    access: "public",
    contentType,
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  return blob.url;
}

// fetch a remote url and re-host in our blob bucket
export async function uploadFromUrl(pathname: string, sourceUrl: string) {
  const res = await fetch(sourceUrl);
  if (!res.ok) throw new Error(`fetch ${sourceUrl} -> ${res.status}`);
  const ct = res.headers.get("content-type") ?? "image/jpeg";
  const buf = Buffer.from(await res.arrayBuffer());
  return uploadBytes(pathname, buf, ct);
}

// delete a blob by url
export async function deleteBlob(url: string) {
  try {
    await del(url);
  } catch {
    // ignore missing
  }
}

// build a canonical path for a kind of asset
export function blobPath(kind: BlobKind, ...parts: (string | number)[]) {
  return [kind, ...parts.map(String)].join("/");
}
