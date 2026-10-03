/**
 * Database client selection.
 *
 * Production  -> Neon serverless Postgres, chosen only when DATABASE_URL is set.
 * Local/dev   -> PGlite, an embedded Postgres compiled to WASM. Zero config,
 *                same SQL dialect, so the exact same DDL and queries run in
 *                both places.
 *
 * The important rule: a production build can NEVER fall back to PGlite. If
 * `NODE_ENV === "production"` and `DATABASE_URL` is missing we throw a typed
 * error, so a misconfigured deploy fails loudly and `/api/health` reports
 * `degraded` instead of quietly pretending a local file is a database.
 */

import type { SqlClient } from "@/lib/db/types";
import { DbUnavailableError } from "@/lib/db/types";

declare global {
  var __emberwakePglite: Promise<import("@electric-sql/pglite").PGlite> | undefined;
}

let cached: Promise<SqlClient> | null = null;

async function createNeon(url: string): Promise<SqlClient> {
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url);
  return {
    adapter: "neon-postgres",
    async query<T>(text: string, params: unknown[] = []): Promise<{ rows: T[] }> {
      // Neon's default resolves to the rows array itself; `fullResults: true`
      // would give `{ rows }`. Accept both so the adapter is not coupled to
      // one driver option.
      const result = (await sql.query(text, params as never[])) as unknown;
      const rows = Array.isArray(result)
        ? result
        : ((result as { rows?: unknown[] } | null)?.rows ?? []);
      return { rows: rows as T[] };
    },
  };
}

async function createPglite(): Promise<SqlClient> {
  // Kept on globalThis so Next's dev-mode module reloading reuses one instance
  // instead of opening a new embedded database on every hot reload.
  globalThis.__emberwakePglite ??= (async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    return new PGlite(".pglite");
  })();
  const db = await globalThis.__emberwakePglite;
  return {
    adapter: "pglite-embedded",
    async query<T>(text: string, params: unknown[] = []): Promise<{ rows: T[] }> {
      const result = await db.query<T>(text, params as never[]);
      return { rows: result.rows ?? [] };
    },
  };
}

/**
 * Returns the shared client. Idempotent: the first call performs the
 * connection, later calls reuse it.
 */
export function getDb(): Promise<SqlClient> {
  cached ??= connect();
  return cached;
}

async function connect(): Promise<SqlClient> {
  const url = process.env.DATABASE_URL?.trim();

  if (url) {
    if (!/^postgres(ql)?:\/\//i.test(url)) {
      throw new DbUnavailableError(
        "DATABASE_URL is set but is not a postgres connection string.",
      );
    }
    return createNeon(url);
  }

  if (process.env.NODE_ENV === "production") {
    // Deliberately no fallback. A production build without a database must
    // report itself as degraded rather than writing to a throwaway local file.
    throw new DbUnavailableError(
      "DATABASE_URL is not configured for this production build.",
    );
  }

  return createPglite();
}

/** Test seam: drops the cached client so a new environment can be selected. */
export function resetDbForTests(): void {
  cached = null;
}

/**
 * Runs the schema and seeds on first use. Called once per process, lazily, and
 * never from a module top-level side effect so `next build` cannot open a
 * database connection.
 */
let ensured: Promise<void> | null = null;
export function ensureSchema(): Promise<void> {
  ensured ??= (async () => {
    const { migrate } = await import("@/lib/db/schema");
    const { seedIfEmpty } = await import("@/lib/db/seed");
    const db = await getDb();
    await migrate(db);
    await seedIfEmpty(db);
  })().catch((error) => {
    // Allow a later request to retry instead of caching a rejected promise.
    ensured = null;
    throw error;
  });
  return ensured;
}

/** Exposed so `/api/health` can name the adapter it is talking to. */
export function describeAdapter(): "neon-postgres" | "pglite-embedded" | "unconfigured" {
  const url = process.env.DATABASE_URL?.trim();
  if (url) return "neon-postgres";
  if (process.env.NODE_ENV === "production") return "unconfigured";
  return "pglite-embedded";
}