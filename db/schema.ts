// drizzle schema for stager
// auth.js standard tables plus boards pins runs runBoards runPhotos
import {
  pgTable,
  text,
  timestamp,
  primaryKey,
  integer,
  pgEnum,
  index,
  uniqueIndex,
  real,
  uuid,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";

// auth.js standard tables (drizzle adapter shape)

export const users = pgTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),
});

export const accounts = pgTable(
  "account",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (a) => [primaryKey({ columns: [a.provider, a.providerAccountId] })],
);

export const sessions = pgTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (vt) => [primaryKey({ columns: [vt.identifier, vt.token] })],
);

// app domain tables

// run and photo status
// queued -> running -> done | failed | cancelled
export const runStatusEnum = pgEnum("run_status", [
  "queued",
  "running",
  "done",
  "failed",
  "cancelled",
]);

// per-photo lifecycle states for granular progress display
export const photoStatusEnum = pgEnum("photo_status", [
  "queued",
  "classifying",
  "matched",
  "staging",
  "done",
  "failed",
  "cancelled",
]);

// model tier toggle per run
export const modelTierEnum = pgEnum("model_tier", ["flash", "pro"]);

// pinterest board saved by a user ingested and cached after first add
export const pinterestBoards = pgTable(
  "pinterest_board",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    pinCount: integer("pin_count").default(0).notNull(),
    status: text("status").notNull().default("ingesting"), // ingesting | ready | failed
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    lastFetchedAt: timestamp("last_fetched_at", { withTimezone: true }),
  },
  (b) => [
    index("pinterest_board_user_idx").on(b.userId),
    uniqueIndex("pinterest_board_user_url_idx").on(b.userId, b.url),
  ],
);

// individual cached pin image (hi-res copy in vercel blob)
export const pinterestPins = pgTable(
  "pinterest_pin",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    boardId: uuid("board_id")
      .notNull()
      .references(() => pinterestBoards.id, { onDelete: "cascade" }),
    imageUrl: text("image_url").notNull(), // blob url
    originalUrl: text("original_url").notNull(),
    width: integer("width"),
    height: integer("height"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (p) => [index("pinterest_pin_board_idx").on(p.boardId)],
);

// a staging run kicked off by the user against a zillow listing
export const runs = pgTable(
  "run",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    zillowUrl: text("zillow_url").notNull(),
    address: text("address").notNull().default(""), // run title
    status: runStatusEnum("status").notNull().default("queued"),
    modelTier: modelTierEnum("model_tier").notNull().default("flash"),
    workflowRunId: text("workflow_run_id"),
    photoCount: integer("photo_count").notNull().default(0),
    completedCount: integer("completed_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    error: text("error"),
    // public share token - when set /share/[token] renders a read-only run view
    shareToken: text("share_token"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (r) => [
    index("run_user_status_idx").on(r.userId, r.status),
    index("run_user_created_idx").on(r.userId, r.createdAt),
    uniqueIndex("run_share_token_idx").on(r.shareToken),
  ],
);

// join table for which boards were selected as style references for a run
export const runBoards = pgTable(
  "run_board",
  {
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    boardId: uuid("board_id")
      .notNull()
      .references(() => pinterestBoards.id, { onDelete: "cascade" }),
  },
  (rb) => [primaryKey({ columns: [rb.runId, rb.boardId] })],
);

// a single zillow photo within a run with classification and staging output
export const runPhotos = pgTable(
  "run_photo",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    index: integer("index").notNull(),
    inputUrl: text("input_url").notNull(),
    classifiedTheme: text("classified_theme"),
    classificationConfidence: real("classification_confidence"),
    matchedBoardId: uuid("matched_board_id").references(() => pinterestBoards.id, {
      onDelete: "set null",
    }),
    matchConfidence: real("match_confidence"),
    outputUrl: text("output_url"),
    status: photoStatusEnum("status").notNull().default("queued"),
    error: text("error"),
    // workflow run id for the per-photo child workflow recorded so cancel can call run.cancel()
    workflowRunId: text("workflow_run_id"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (rp) => [index("run_photo_run_idx").on(rp.runId, rp.index)],
);
