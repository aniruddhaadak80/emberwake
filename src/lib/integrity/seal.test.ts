import { describe, expect, it } from "vitest";
import { GENESIS, canonicalJson, computeSeal, replayChain } from "@/lib/integrity/seal";
import { createHash } from "node:crypto";
import type { AuditEvent } from "@/lib/types";

/**
 * Integrity tests.
 *
 * The point of these is not that the code agrees with itself, but that the
 * documented formula can be checked by a third party. So the expected seal in the
 * first test is recomputed here with a bare `crypto.createHash`, entirely
 * separately from `src/lib/integrity/seal.ts`.
 */

/** Independent implementation of the documented formula, used as an oracle. */
function oracleSeal(prevSeal: string, event: Record<string, unknown>): string {
  // Same canonicalization, written out independently on purpose.
  const canonical = (value: unknown): string => {
    if (value === null) return "null";
    if (typeof value === "number") return JSON.stringify(value === 0 ? 0 : value);
    if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`);
    return `{${entries.join(",")}}`;
  };

  const body = canonical({
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
  hash.update(Buffer.from(body, "utf8"));
  return hash.digest("hex");
}

const baseEvent = {
  roundId: "r1",
  entityType: "round" as const,
  entityId: "r1",
  action: "round.create" as const,
  payload: { title: "Diwali Thursday", joinCode: "ABC234" },
  createdAt: "2026-10-02T10:00:00.000Z",
};

describe("canonicalJson", () => {
  it("sorts object keys recursively", () => {
    expect(canonicalJson({ b: 1, a: { z: 2, y: 3 } })).toBe('{"a":{"y":3,"z":2},"b":1}');
  });

  it("is insensitive to the order keys were written in", () => {
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });

  it("preserves array order, because order is meaningful in a payload", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
    expect(canonicalJson([1, 2, 3])).not.toBe(canonicalJson([3, 2, 1]));
  });

  it("normalizes negative zero so it cannot change a seal", () => {
    expect(canonicalJson(-0)).toBe("0");
    expect(canonicalJson(0)).toBe("0");
  });

  it("omits undefined properties, matching JSON semantics", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("rejects non-finite numbers rather than silently encoding null", () => {
    expect(() => canonicalJson(Number.NaN)).toThrow(/non-finite/);
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow(/non-finite/);
  });

  it("encodes dates as ISO strings", () => {
    expect(canonicalJson(new Date("2026-10-02T10:00:00.000Z"))).toBe('"2026-10-02T10:00:00.000Z"');
  });
});

describe("computeSeal", () => {
  it("matches an independently computed SHA-384 of the documented formula", () => {
    const event = { seq: 1, ...baseEvent };
    const actual = computeSeal(GENESIS, event);
    const expected = oracleSeal(GENESIS, event);
    expect(actual).toBe(expected);
    expect(actual).toMatch(/^[0-9a-f]{96}$/); // SHA-384 hex
  });

  it("is stable across repeated calls", () => {
    const event = { seq: 7, ...baseEvent };
    expect(computeSeal("abc", event)).toBe(computeSeal("abc", event));
  });

  it("changes when any field changes", () => {
    const event = { seq: 1, ...baseEvent };
    const original = computeSeal(GENESIS, event);
    expect(computeSeal(GENESIS, { ...event, payload: { title: "Different" } })).not.toBe(original);
    expect(computeSeal(GENESIS, { ...event, createdAt: "2026-10-02T10:00:01.000Z" })).not.toBe(original);
    expect(computeSeal("different-previous", event)).not.toBe(original);
  });

  it("ignores the order payload keys were supplied in", () => {
    const a = computeSeal(GENESIS, {
      seq: 1,
      ...baseEvent,
      payload: { title: "T", joinCode: "C" },
    });
    const b = computeSeal(GENESIS, {
      seq: 1,
      ...baseEvent,
      payload: { joinCode: "C", title: "T" },
    });
    expect(a).toBe(b);
  });
});

/** Builds a valid chain by sealing each event against the previous head. */
function buildChain(payloads: { action: AuditEvent["action"]; entityId: string }[]): AuditEvent[] {
  let prev = GENESIS;
  return payloads.map((entry, index) => {
    const seq = index + 1;
    const event = {
      seq,
      roundId: "r1",
      entityType: "ember" as const,
      entityId: entry.entityId,
      action: entry.action,
      payload: { index: entry.entityId },
      createdAt: `2026-10-02T10:0${index}:00.000Z`,
    };
    const seal = computeSeal(prev, event);
    const record: AuditEvent = { ...event, prevSeal: prev, seal };
    prev = seal;
    return record;
  });
}

describe("replayChain", () => {
  it("accepts an untouched chain and reports its head", () => {
    const events = buildChain([
      { action: "ember.create", entityId: "e1" },
      { action: "ember.create", entityId: "e2" },
      { action: "ember.delete", entityId: "e2" },
    ]);
    const result = replayChain(events);
    expect(result.ok).toBe(true);
    expect(result.events).toBe(3);
    expect(result.head).toBe(events[2].seal);
    expect(result.brokenAt).toBeNull();
    expect(result.tombstones).toBe(1);
  });

  it("reports a single empty chain as valid at the genesis value", () => {
    const result = replayChain([]);
    expect(result.ok).toBe(true);
    expect(result.events).toBe(0);
    expect(result.head).toBe(GENESIS);
  });

  it("detects a rewritten payload and names the first broken event", () => {
    const events = buildChain([
      { action: "ember.create", entityId: "e1" },
      { action: "ember.create", entityId: "e2" },
      { action: "ember.create", entityId: "e3" },
    ]);
    // Simulate somebody editing history directly in the database.
    const tampered = events.map((event, i) =>
      i === 1 ? { ...event, payload: { index: "forged" } } : event,
    );

    const result = replayChain(tampered);
    expect(result.ok).toBe(false);
    expect(result.brokenAt?.seq).toBe(2);
    expect(result.brokenAt?.actual).toBe(events[1].seal);
    expect(result.brokenAt?.expected).not.toBe(events[1].seal);
  });

  it("detects a removed event, because the following link no longer resolves", () => {
    const events = buildChain([
      { action: "ember.create", entityId: "e1" },
      { action: "ember.create", entityId: "e2" },
      { action: "ember.create", entityId: "e3" },
    ]);
    const result = replayChain([events[0], events[2]]);
    expect(result.ok).toBe(false);
    expect(result.brokenAt?.seq).toBe(3);
  });

  it("does not depend on the order events are supplied in", () => {
    const events = buildChain([
      { action: "ember.create", entityId: "e1" },
      { action: "ember.create", entityId: "e2" },
    ]);
    expect(replayChain(events).ok).toBe(true);
    expect(replayChain([...events].reverse()).ok).toBe(true);
  });

  it("counts deletion tombstones so deleted rounds stay auditable", () => {
    const events = buildChain([
      { action: "ember.create", entityId: "e1" },
      { action: "ember.delete", entityId: "e1" },
      { action: "round.delete", entityId: "r1" },
    ]);
    const result = replayChain(events);
    expect(result.ok).toBe(true);
    expect(result.tombstones).toBe(2);
  });
});