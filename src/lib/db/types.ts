/** Shared types for the persistence layer. */

export type SqlClient = {
  /** Which adapter answered. Surfaced by /api/health so prod is never mistaken for local. */
  adapter: "neon-postgres" | "pglite-embedded";
  query<T = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
};

/** Thrown when no usable database is configured. Carries no secrets. */
export class DbUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DbUnavailableError";
  }
}

/** Postgres hands back `Date` or ISO string depending on driver; normalize. */
export function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    // A bare date string has no time component; keep it as-is for scheduledDate.
    return value;
  }
  return String(value ?? "");
}

/** Narrow an optional timestamp column to a string or null. */
export function toIsoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return toIso(value);
}

export function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}