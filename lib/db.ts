// shared drizzle client singleton via postgres-js
// connection is lazy so the client can be constructed at module load
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";

declare global {
  // eslint-disable-next-line no-var
  var __pg: ReturnType<typeof postgres> | undefined;
  // eslint-disable-next-line no-var
  var __db: PostgresJsDatabase<typeof schema> | undefined;
}

function makeDb(): PostgresJsDatabase<typeof schema> {
  const url = process.env.DATABASE_URL ?? "postgres://placeholder:placeholder@localhost:5432/placeholder";
  if (!globalThis.__pg) {
    globalThis.__pg = postgres(url, { prepare: false, max: 1 });
  }
  return drizzle(globalThis.__pg, { schema });
}

if (!globalThis.__db) {
  globalThis.__db = makeDb();
}

export const db: PostgresJsDatabase<typeof schema> = globalThis.__db;
export { schema };
