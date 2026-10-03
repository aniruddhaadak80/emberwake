import { describe, expect, it } from "vitest";
import {
  analyzeRound,
  contributions,
  emptyBundle,
  gini,
  WEIGHTS,
} from "@/lib/engine/beacon-engine";
import type { AgeBand, Ember, Member, RoundBundle } from "@/lib/types";

/**
 * Beacon Engine tests.
 *
 * Five groups, matching the five failure modes the engine has to survive:
 * normal operation, boundary values, an empty round, malformed input, and the
 * determinism guarantee that lets an analysis be treated as a hashable fact.
 */

const NOW = "2026-10-02T12:00:00.000Z";
const SKY = null;

let seq = 0;
function member(name: string, band: AgeBand = "adult"): Member {
  seq += 1;
  return {
    id: `m${seq}`,
    roundId: "r1",
    displayName: name,
    ageBand: band,
    joinedVia: "host",
    createdAt: NOW,
  };
}

function ember(memberId: string, facet: number, weight: number, minuteOffset: number): Ember {
  seq += 1;
  return {
    id: `e${seq}`,
    roundId: "r1",
    memberId,
    kind: "spark",
    weight,
    facet,
    transcript: null,
    transcriptEngine: null,
    note: null,
    createdAt: new Date(Date.parse("2026-10-02T18:00:00.000Z") + minuteOffset * 60_000).toISOString(),
    deletedAt: null,
  };
}

function bundle(members: Member[], embers: Ember[]): RoundBundle {
  return {
    round: {
      id: "r1",
      joinCode: "ABC234",
      title: "Test round",
      placeLabel: "Kolkata",
      latitude: 22.56263,
      longitude: 88.36304,
      scheduledDate: "2026-10-18",
      status: "open",
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
    },
    members,
    embers,
    seal: "a".repeat(96),
  };
}

/** A fair round: four people, four equal contributions. */
function fairRound() {
  seq = 0;
  const a = member("A", "adult");
  const b = member("B", "adult");
  const c = member("C", "teen");
  const d = member("D", "elder");
  return bundle(
    [a, b, c, d],
    [
      ember(a.id, 0, 3, 0),
      ember(b.id, 3, 3, 5),
      ember(c.id, 6, 3, 10),
      ember(d.id, 9, 3, 15),
    ],
  );
}

describe("gini", () => {
  it("is 0 for a perfectly even distribution", () => {
    expect(gini([2, 2, 2, 2])).toBe(0);
  });

  it("is bounded at 1 when one member holds everything", () => {
    expect(gini([10, 0, 0, 0])).toBeCloseTo(0.75, 5);
    expect(gini([1, 0])).toBeCloseTo(0.5, 5);
  });

  it("returns 0 for an empty list rather than NaN", () => {
    expect(gini([])).toBe(0);
  });

  it("returns 0 when every value is zero", () => {
    expect(gini([0, 0, 0])).toBe(0);
  });

  it("never leaves the 0..1 range for extreme inputs", () => {
    expect(gini([1e9, 1])).toBeLessThanOrEqual(1);
    expect(gini([1e9, 1])).toBeGreaterThanOrEqual(0);
  });
});

describe("contributions", () => {
  it("keeps roster members with no embers, scored zero", () => {
    seq = 0;
    const a = member("Played");
    const b = member("Silent", "elder");
    const rows = contributions(bundle([a, b], [ember(a.id, 0, 3, 0)]));

    expect(rows).toHaveLength(2);
    const silent = rows.find((r) => r.displayName === "Silent");
    expect(silent).toBeDefined();
    expect(silent?.participation).toBe(0);
    expect(silent?.fuel).toBe(0);
  });

  it("orders by participation, then fuel, then name, deterministically", () => {
    const rows = contributions(fairRound());
    // Everyone participated with equal fuel, so ordering falls to the name.
    expect(rows.map((r) => r.displayName)).toEqual(["A", "B", "C", "D"]);
  });

  it("ignores soft-deleted embers", () => {
    seq = 0;
    const a = member("A");
    const deleted: Ember = { ...ember(a.id, 0, 5, 0), deletedAt: NOW };
    const rows = contributions(bundle([a], [deleted]));
    expect(rows[0].fuel).toBe(0);
    expect(rows[0].participation).toBe(0);
  });

  it("does not attribute fuel to a member who was removed from the roster", () => {
    seq = 0;
    const a = member("A");
    const orphan = "missing-member";
    const rows = contributions(bundle([a], [ember(orphan, 0, 5, 0)]));
    expect(rows[0].fuel).toBe(0);
  });
});

describe("analyzeRound — normal operation", () => {
  it("scores a fair round at full reach and full balance", () => {
    const result = analyzeRound(fairRound(), { now: NOW, sky: SKY });
    expect(result.empty).toBe(false);
    expect(result.scores.reach).toBe(100);
    expect(result.scores.balance).toBe(100);
    expect(result.recommendation.headline).toBe("Everyone played and the beacon is full");
  });

  it("reports exactly who was left out, by name", () => {
    seq = 0;
    const a = member("Loud one");
    const b = member("Quiet one", "elder");
    const result = analyzeRound(bundle([a, b], [ember(a.id, 0, 5, 0), ember(a.id, 1, 5, 2)]), {
      now: NOW,
      sky: SKY,
    });

    expect(result.scores.reach).toBe(50);
    expect(result.recommendation.headline).toContain("1 person was left out");
    const reachFactor = result.factors.find((f) => f.id === "reach");
    expect(reachFactor?.evidence.join(" ")).toContain("Quiet one");
  });

  it("keeps the overall score inside 0..100", () => {
    const result = analyzeRound(fairRound(), { now: NOW, sky: SKY });
    expect(result.overall).toBeGreaterThanOrEqual(0);
    expect(result.overall).toBeLessThanOrEqual(100);
  });

  it("weights sum to one, so the overall score is a true weighted mean", () => {
    const total = Object.values(WEIGHTS).reduce((sum, w) => sum + w, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it("carries the seal it was computed against", () => {
    const result = analyzeRound(fairRound(), { now: NOW, sky: SKY });
    expect(result.seal).toBe("a".repeat(96));
  });

  it("always returns a recommendation, even when nothing is wrong", () => {
    const result = analyzeRound(fairRound(), { now: NOW, sky: SKY });
    expect(result.recommendation.actions.length).toBeGreaterThan(0);
  });
});

describe("analyzeRound — boundaries", () => {
  it("handles a single member and a single ember", () => {
    seq = 0;
    const solo = member("Solo");
    const result = analyzeRound(bundle([solo], [ember(solo.id, 0, 5, 0)]), { now: NOW, sky: SKY });

    expect(result.scores.reach).toBe(100);
    // One member cannot be "unbalanced" against anyone.
    expect(result.scores.balance).toBe(100);
    expect(result.empty).toBe(false);
  });

  it("gives balance zero when nothing has been lit, not a perfect score", () => {
    seq = 0;
    const a = member("A");
    const b = member("B");
    const result = analyzeRound(bundle([a, b], []), { now: NOW, sky: SKY });

    expect(result.scores.balance).toBe(0);
    expect(result.scores.glow).toBe(0);
    expect(result.scores.reach).toBe(0);
  });

  it("reports rhythm as unmeasured for a single contribution", () => {
    seq = 0;
    const a = member("A");
    const result = analyzeRound(bundle([a], [ember(a.id, 0, 3, 0)]), { now: NOW, sky: SKY });

    expect(result.scores.rhythm).toBe(50);
    const rhythm = result.factors.find((f) => f.id === "rhythm");
    expect(rhythm?.detail).toMatch(/not enough contributions/i);
  });

  it("scores regular spacing above irregular spacing", () => {
    seq = 0;
    const a = member("A");
    const b = member("B");
    const c = member("C");

    // Three contributions are the minimum that yields two gaps, so rhythm is
    // actually measurable. Two contributions have a single interval, which has
    // no regularity to measure and is correctly reported as unmeasured.
    const regular = analyzeRound(
      bundle(
        [a, b, c],
        [ember(a.id, 0, 3, 0), ember(b.id, 1, 3, 10), ember(c.id, 2, 3, 20)],
      ),
      { now: NOW, sky: SKY },
    );
    // Same two gaps, wildly uneven: one turn immediately after the last.
    const irregular = analyzeRound(
      bundle(
        [a, b, c],
        [ember(a.id, 0, 3, 0), ember(b.id, 1, 3, 1), ember(c.id, 2, 3, 20)],
      ),
      { now: NOW, sky: SKY },
    );

    expect(regular.scores.rhythm).toBeGreaterThan(irregular.scores.rhythm);
  });

  it("deliberately measures evenness of gaps, not absolute tempo", () => {
    seq = 0;
    const a = member("A");
    const b = member("B");
    const c = member("C");

    // Two minutes apart and twenty minutes apart are both internally even, so
    // both score full marks. Rhythm answers "were turns interleaved or dumped",
    // not "how fast did the round go" — that distinction is documented so a
    // reader is not misled by a fast but evenly paced round.
    const fast = analyzeRound(
      bundle(
        [a, b, c],
        [ember(a.id, 0, 3, 0), ember(b.id, 1, 3, 1), ember(c.id, 2, 3, 2)],
      ),
      { now: NOW, sky: SKY },
    );
    expect(fast.scores.rhythm).toBe(100);
  });

  it("saturates glow at exactly 100 rather than exceeding it", () => {
    seq = 0;
    const a = member("A");
    const huge = Array.from({ length: 40 }, (_, i) => ember(a.id, i % 12, 5, i));
    const result = analyzeRound(bundle([a], huge), { now: NOW, sky: SKY });
    expect(result.scores.glow).toBeLessThanOrEqual(100);
    expect(Number.isFinite(result.overall)).toBe(true);
  });

  it("treats a round with no place or date as an unverified light window", () => {
    seq = 0;
    const a = member("A");
    const bare: RoundBundle = {
      ...bundle([a], [ember(a.id, 0, 3, 0)]),
      round: { ...bundle([a], []).round, latitude: null, longitude: null, scheduledDate: null },
    };
    const result = analyzeRound(bare, { now: NOW, sky: SKY });
    expect(result.scores.goldenHour).toBe(50);
    const golden = result.factors.find((f) => f.id === "goldenHour");
    expect(golden?.detail).toMatch(/set a place/i);
  });

  it("uses real daylight minutes when a sky envelope is supplied", () => {
    const result = analyzeRound(fairRound(), {
      now: NOW,
      sky: {
        status: "live",
        placeLabel: "Kolkata",
        latitude: 22.5,
        longitude: 88.3,
        timezone: "Asia/Kolkata",
        days: [{ date: "2026-10-18", sunrise: "2026-10-18T05:44", sunset: "2026-10-18T17:52", daylightMinutes: 728 }],
        fetchedAt: NOW,
        source: { name: "Open-Meteo", url: "https://open-meteo.com", attribution: "CC BY 4.0" },
      },
    });
    expect(result.scores.goldenHour).toBe(100);
  });

  it("says so when live daylight was unavailable rather than assuming good light", () => {
    const result = analyzeRound(fairRound(), {
      now: NOW,
      sky: {
        status: "fallback",
        placeLabel: "Kolkata",
        latitude: 22.5,
        longitude: 88.3,
        timezone: "Asia/Kolkata",
        days: [],
        fetchedAt: NOW,
        source: { name: "Open-Meteo", url: "https://open-meteo.com", attribution: "CC BY 4.0" },
        note: "unavailable",
      },
    });
    const golden = result.factors.find((f) => f.id === "goldenHour");
    expect(golden?.detail).toMatch(/no sunrise or sunset/i);
  });

  it("ignores an ember whose facet is outside the beacon", () => {
    seq = 0;
    const a = member("A");
    const offBeacon: Ember = { ...ember(a.id, 99, 5, 0) };
    const result = analyzeRound(bundle([a], [offBeacon]), { now: NOW, sky: SKY });
    // The ember still counts as a contribution; it simply has nowhere to show.
    expect(result.scores.reach).toBe(100);
    expect(result.contributions[0].fuel).toBe(5);
  });
});

describe("analyzeRound — empty", () => {
  it("handles a round with nobody on the roster", () => {
    const result = analyzeRound(emptyBundle(NOW, "seed"), { now: NOW, sky: SKY });
    expect(result.empty).toBe(true);
    expect(result.recommendation.headline).toBe("Nobody is on the roster yet");
    expect(result.scores.reach).toBe(0);
    expect(result.scores.balance).toBe(0);
    expect(result.overall).toBeGreaterThanOrEqual(0);
    expect(result.contributions).toEqual([]);
    expect(result.recommendation.actions[0]).toMatch(/roster/i);
  });

  it("never produces NaN for an empty round", () => {
    const result = analyzeRound(emptyBundle(NOW, "seed"), { now: NOW, sky: SKY });
    for (const value of Object.values(result.scores)) {
      expect(Number.isFinite(value)).toBe(true);
    }
    expect(Number.isFinite(result.overall)).toBe(true);
  });
});

describe("analyzeRound — malformed input", () => {
  it("survives unparseable timestamps without producing NaN", () => {
    seq = 0;
    const a = member("A");
    const bad: Ember = { ...ember(a.id, 0, 3, 0), createdAt: "not-a-date" };
    const result = analyzeRound(bundle([a], [bad, { ...ember(a.id, 1, 3, 5), createdAt: "" }]), {
      now: "also-not-a-date",
      sky: SKY,
    });
    for (const value of Object.values(result.scores)) {
      expect(Number.isFinite(value)).toBe(true);
    }
    expect(Number.isFinite(result.overall)).toBe(true);
  });

  it("survives weights and facets outside the documented range", () => {
    seq = 0;
    const a = member("A");
    const wild: Ember[] = [
      { ...ember(a.id, -5, 3, 0) },
      { ...ember(a.id, 500, 3, 1) },
      { ...ember(a.id, 2, -99, 2) },
    ];
    const result = analyzeRound(bundle([a], wild), { now: NOW, sky: SKY });
    expect(Number.isFinite(result.overall)).toBe(true);
    expect(result.overall).toBeLessThanOrEqual(100);
  });

  it("keeps scores bounded when a weight is enormous", () => {
    seq = 0;
    const a = member("A");
    const absurd: Ember = { ...ember(a.id, 0, 5, 0), weight: 1e12 };
    const result = analyzeRound(bundle([a], [absurd]), { now: NOW, sky: SKY });
    expect(result.scores.glow).toBeLessThanOrEqual(100);
    expect(result.overall).toBeLessThanOrEqual(100);
  });
});

describe("analyzeRound — determinism", () => {
  it("produces an identical result for identical input", () => {
    const first = analyzeRound(fairRound(), { now: NOW, sky: SKY });
    const second = analyzeRound(fairRound(), { now: NOW, sky: SKY });
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("does not depend on the order embers are supplied in", () => {
    const input = fairRound();
    const reversed: RoundBundle = { ...input, embers: [...input.embers].reverse() };
    const forwards = analyzeRound(input, { now: NOW, sky: SKY });
    const backwards = analyzeRound(reversed, { now: NOW, sky: SKY });
    expect(backwards.overall).toBe(forwards.overall);
    expect(backwards.scores).toEqual(forwards.scores);
  });

  it("does not depend on the order roster members are supplied in", () => {
    const input = fairRound();
    const shuffled: RoundBundle = { ...input, members: [...input.members].reverse() };
    expect(analyzeRound(shuffled, { now: NOW, sky: SKY }).overall).toBe(
      analyzeRound(input, { now: NOW, sky: SKY }).overall,
    );
  });

  it("ignores the injected clock, so the same round always scores the same", () => {
    // `now` is accepted for interface symmetry but must not leak into the maths.
    const early = analyzeRound(fairRound(), { now: "2020-01-01T00:00:00.000Z", sky: SKY });
    const late = analyzeRound(fairRound(), { now: "2099-12-31T23:59:59.000Z", sky: SKY });
    expect(late.overall).toBe(early.overall);
  });
});