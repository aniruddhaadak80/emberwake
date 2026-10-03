/**
 * Anonymous session ownership.
 *
 * This product has no accounts. Ownership is an unguessable scope minted as an
 * HTTP-only cookie, and every query filters on it. That gives three properties
 * for free:
 *
 *  - a visitor's rounds are private to their browser without a signup wall;
 *  - two visitors can never read or mutate each other's rounds;
 *  - there is no credential to leak, because there is no credential.
 *
 * Destructive operations additionally require the round's `joinCode` as a
 * confirmation token (see `assertDestructiveConfirmation`). Possessing the
 * join code is what the QR card confers, so it is the right capability to
 * require: knowing only a round UUID is not enough to delete a round.
 */

import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";

const SCOPE_COOKIE = "emberwake_scope";
const PLAYS_COOKIE = "emberwake_plays";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** Caps the cookie so it cannot grow without bound on a busy device. */
const MAX_PLAY_ROUNDS = 20;

/**
 * 32 bytes of entropy, hex encoded. The `s_` prefix makes the value
 * self-describing when it appears in a database row.
 */
export function mintScope(): string {
  return `s_${randomBytes(32).toString("hex")}`;
}

export function isValidScope(value: string | undefined | null): boolean {
  return typeof value === "string" && /^s_[0-9a-f]{64}$/.test(value);
}

/**
 * Returns the caller's scope, minting and setting one when absent.
 *
 * Always call this before a write: a route that writes without a scope would
 * create rows that no one can read back.
 */
export async function getOrCreateScope(): Promise<string> {
  const store = await cookies();
  const existing = store.get(SCOPE_COOKIE)?.value;
  if (isValidScope(existing)) return existing as string;

  const scope = mintScope();
  store.set(SCOPE_COOKIE, scope, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
  });
  return scope;
}

/**
 * Read-only variant for pages and GET handlers: returns null instead of setting
 * a cookie, so a bot hitting a page never mints sessions it does not need.
 */
export async function readScope(): Promise<string | null> {
  const store = await cookies();
  const value = store.get(SCOPE_COOKIE)?.value;
  return isValidScope(value) ? (value as string) : null;
}

/** Header a destructive request must carry, holding the round's join code. */
export const CONFIRM_HEADER = "x-emberwake-confirm";

/**
 * Player scope.
 *
 * The host owns a round and can change everything about it. Someone who joined by
 * scanning the QR is a *player*: they may read the round and light facets, but
 * they cannot rename the round, remove people or delete it.
 *
 * Without this second capability, "scan the code and play" would be a fiction —
 * the guest could appear on the roster and then be unable to take a turn, which
 * would make the QR the least useful control in the product.
 *
 * Stored as a short list of round ids in an HTTP-only cookie. It is a capability
 * granted by having scanned a code, so it grants nothing beyond that round.
 */
async function readPlays(): Promise<string[]> {
  const store = await cookies();
  const raw = store.get(PLAYS_COOKIE)?.value;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string").slice(0, MAX_PLAY_ROUNDS);
  } catch {
    return [];
  }
}

export async function isPlayerOf(roundId: string): Promise<boolean> {
  return (await readPlays()).includes(roundId);
}

export async function grantPlayerScope(roundId: string): Promise<void> {
  const store = await cookies();
  const plays = await readPlays();
  if (plays.includes(roundId)) return;
  const next = [...plays, roundId].slice(-MAX_PLAY_ROUNDS);
  store.set(PLAYS_COOKIE, JSON.stringify(next), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
  });
}

/** True when this session owns the round (host), rather than merely playing. */
export function assertDestructiveConfirmation(joinCode: string, supplied: string | null): boolean {
  if (!supplied) return false;
  // Constant-time-ish comparison; the secret is low-entropy by design, but
  // there is no reason to make guessing cheaper than necessary.
  if (supplied.length !== joinCode.length) return false;
  let diff = 0;
  for (let i = 0; i < supplied.length; i++) {
    diff |= supplied.charCodeAt(i) ^ joinCode.charCodeAt(i);
  }
  return diff === 0;
}