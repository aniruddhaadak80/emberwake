/**
 * Emberwake integrity chain
 * =========================
 *
 * Every mutation appends one audit event to a per-round hash chain:
 *
 *     seal_n = SHA-384( UTF-8(prevSeal) || canonicalJson(event_n) )
 *
 * `GENESIS` seeds the chain. Because each seal covers the previous seal, any
 * edit to a historical row — including one made directly in the database —
 * breaks every seal after it, and `replayChain` reports the first break.
 *
 * Canonical JSON recursively sorts object keys by UTF-16 code unit and
 * preserves array order, so the same logical event always produces the same
 * bytes regardless of key insertion order or engine version.
 *
 * Server-only: this module imports node:crypto.
 */

import { createHash } from "node:crypto";
import type { AuditEvent, ReplayResult } from "@/lib/types";

/** Public, documented seed value. Not a secret. */
export const GENESIS = "emberwake:genesis:beacon:v1";

/**
 * Serializes a value to canonical JSON.
 *
 * - object keys sorted recursively by code unit
 * - array order preserved (order is meaningful in an audit payload)
 * - `undefined` object properties omitted, matching JSON semantics
 * - `-0` normalized to `0` so it cannot change a seal
 * - non-finite numbers rejected rather than silently becoming `null`
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";

  const type = typeof value;
  if (type === "number") {
    const n = value as number;
    if (!Number.isFinite(n)) {
      throw new TypeError(`canonicalJson cannot encode non-finite number: ${String(n)}`);
    }
    return JSON.stringify(n === 0 ? 0 : n);
  }
  if (type === "string" || type === "boolean") return JSON.stringify(value);

  if (value instanceof Date) return JSON.stringify(value.toISOString());

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }

  if (type === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      // Default comparator: UTF-16 code-unit order, identical on every platform.
      .sort();
    const body = keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",");
    return `{${body}}`;
  }

  // undefined, function, symbol: not representable.
  throw new TypeError(`canonicalJson cannot encode type ${type}`);
}

/** The fields that participate in the hash, in a fixed shape. */
export type SealableEvent = {
  seq: number;
  roundId: string;
  entityType: AuditEvent["entityType"];
  entityId: string;
  action: AuditEvent["action"];
  payload: Record<string, unknown>;
  createdAt: string;
};

/**
 * Computes one seal. `prevSeal` is hashed as UTF-8 bytes immediately followed
 * by the canonical JSON bytes, exactly as the documented formula requires.
 */
export function computeSeal(prevSeal: string, event: SealableEvent): string {
  const payload = canonicalJson({
    action: event.action,
    createdAt: event.createdAt,
    entityId: event.entityId,
    entityType: event.entityType,
    payload: event.payload,
    roundId: event.roundId,
    seq: event.seq,
  });
  const hash = createHash("sha384");
  hash.update(Buffer.from(prevSeal, "utf8"));
  hash.update(Buffer.from(payload, "utf8"));
  return hash.digest("hex");
}

/** Convenience: the seal a round with no events yet carries. */
export function emptySeal(): string {
  return GENESIS;
}

/**
 * Walks a round's events and recomputes every seal.
 *
 * Reports the first broken link rather than only a boolean, because "the chain
 * is fine" and "the chain is broken at event 7" are different messages for
 * someone trying to trust a report.
 */
export function replayChain(events: AuditEvent[]): ReplayResult {
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  let prevSeal = GENESIS;
  let tombstones = 0;

  for (const event of ordered) {
    const expected = computeSeal(prevSeal, event);
    if (event.seal !== expected) {
      return {
        ok: false,
        genesis: GENESIS,
        events: ordered.length,
        head: prevSeal,
        brokenAt: { seq: event.seq, expected, actual: event.seal },
        tombstones,
      };
    }
    // Both ember and round deletes leave a retained tombstone event, so both
    // count as tombstones for replay.
    if (event.action === "ember.delete" || event.action === "round.delete") tombstones += 1;
    prevSeal = event.seal;
  }

  return {
    ok: true,
    genesis: GENESIS,
    events: ordered.length,
    head: prevSeal,
    brokenAt: null,
    tombstones,
  };
}

/**
 * Truncates a seal for display. Full seals are always returned by the API; this
 * exists so a UI chip can show a seal without wrapping across nine lines.
 */
export function shortSeal(seal: string): string {
  return `${seal.slice(0, 8)}…${seal.slice(-6)}`;
}