import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@/lib/db/schema";

const databaseUrl = process.env.DATABASE_URL;

const sql = databaseUrl ? postgres(databaseUrl, { prepare: false }) : null;

export const db = sql ? drizzle(sql, { schema }) : null;

export function requireDb() {
  if (!db) {
    throw new Error("DATABASE_URL is required for persistent workspace operations.");
  }

  return db;
}
