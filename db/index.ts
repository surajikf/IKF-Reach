import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { SqliteD1Compat, CompatPreparedStatement } from "./sqlite-d1-compat";

// Kept under the original D1 type names so every existing call site
// (typed against Cloudflare's D1Database/D1PreparedStatement globals before
// the self-hosted migration) only needs an import added, not a rewrite.
export type D1Database = SqliteD1Compat;
export type D1PreparedStatement = CompatPreparedStatement;

const dbPath = resolve(process.cwd(), process.env.QUEUE_DB_PATH || "./data/queue.db");

let instance: SqliteD1Compat | null = null;

export function getQueueDb(): SqliteD1Compat {
  if (!instance) {
    mkdirSync(dirname(dbPath), { recursive: true });
    instance = new SqliteD1Compat(dbPath);
  }
  return instance;
}
