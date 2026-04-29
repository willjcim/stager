// share-link toggle for a completed run
// POST generates (or reuses) a public share token and returns it
// DELETE revokes the token so /share/[token] then 404s
import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { runs } from "@/db/schema";

// 24 random bytes -> 32-char base64url string (unguessable for any practical purpose)
function generateToken() {
  return randomBytes(24).toString("base64url");
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const [runRow] = await db
    .select()
    .from(runs)
    .where(and(eq(runs.id, id), eq(runs.userId, session.user.id)));
  if (!runRow) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (runRow.status !== "done") {
    return NextResponse.json(
      { error: "only completed runs can be shared" },
      { status: 409 },
    );
  }

  // reuse the existing token if one is already set so the share url stays stable
  const token = runRow.shareToken ?? generateToken();
  if (!runRow.shareToken) {
    await db.update(runs).set({ shareToken: token }).where(eq(runs.id, id));
  }

  return NextResponse.json({ token });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const [runRow] = await db
    .select({ id: runs.id })
    .from(runs)
    .where(and(eq(runs.id, id), eq(runs.userId, session.user.id)));
  if (!runRow) return NextResponse.json({ error: "not found" }, { status: 404 });

  await db.update(runs).set({ shareToken: null }).where(eq(runs.id, id));
  return NextResponse.json({ ok: true });
}
