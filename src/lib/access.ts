/**
 * Access resolution for a round.
 *
 * Two capabilities, deliberately distinct:
 *
 *  - `owner`  — this browser created the round. Full control, including edits and
 *               deletion.
 *  - `player` — this browser joined by scanning the QR. May read the round and
 *               light facets. May not rename it, remove people, or delete it.
 *
 * Anything else gets `null`, and routes turn that into the same 404 they would
 * return for a round that does not exist, so access cannot be probed.
 */

import { getRound } from "@/lib/db/repository";
import { isPlayerOf, readScope } from "@/lib/session";
import type { SqlClient } from "@/lib/db/types";

export type AccessLevel = "owner" | "player" | null;

export async function resolveAccess(
  db: SqlClient,
  roundId: string,
  /** Supplied by the agent endpoint, which already resolved the session. */
  scopeOverride?: string | null,
): Promise<AccessLevel> {
  const scope = scopeOverride === undefined ? await readScope() : scopeOverride;
  if (scope) {
    const owned = await getRound(db, scope, roundId);
    if (owned) return "owner";
  }
  if (await isPlayerOf(roundId)) return "player";
  return null;
}

/** True when this session may read the round and contribute to it. */
export async function canContribute(
  db: SqlClient,
  roundId: string,
  scopeOverride?: string | null,
): Promise<boolean> {
  return (await resolveAccess(db, roundId, scopeOverride)) !== null;
}

/** True only for the host. Guards every structural mutation. */
export async function isOwner(
  db: SqlClient,
  roundId: string,
  scopeOverride?: string | null,
): Promise<boolean> {
  return (await resolveAccess(db, roundId, scopeOverride)) === "owner";
}