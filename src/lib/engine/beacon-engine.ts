/**
 * Emberwake Beacon Engine
 * =======================
 *
 * The single scoring implementation. The 3D HUD, the REST endpoint
 * (`POST /api/rounds/[id]/analyze`), the agent tool `analyze_round` and the
 * report route all call `analyzeRound` and nothing else. If a score ever
 * disagrees between two surfaces it is a rendering bug, not a logic fork.
 *
 * Version: beacon-engine-v2026.10.1
 *
 * Design rules
 * ------------
 * 1. Pure. No Date.now(), no randomness, no I/O. Time arrives as `opts.now`.
 * 2. Deterministic. Identical input produces a byte-identical result, which is
 *    what lets the integrity chain treat an analysis as a hashable fact.
 * 3. Explainable. Every factor exposes its own evidence lines.
 * 4. Bounded. Empty roster, zero fuel and single-contribution rounds produce
 *    defined numbers instead of NaN.
 *
 * The five factors
 * ----------------
 *   reach      0.34  share of the roster who lit at least one facet
 *   balance    0.26  1 - Gini(fuel per member); how evenly fuel was shared
 *   glow       0.16  total fuel against the fuel a full beacon needs
 *   rhythm     0.10  evenness of the gaps between contributions
 *   goldenHour 0.14  whether the planned day had usable outdoor light
 *
 * `goldenHour` is the one factor that needs the network; when the sky envelope
 * is unavailable or has no matching day it reports a neutral 50 with evidence
 * saying so, rather than pretending the plan is fine.
 */

import type {
  Ember,
  EngineFactor,
  EngineFactorId,
  EngineResult,
  Member,
  MemberContribution,
  RoundBundle,
  SkyEnvelope,
} from "@/lib/types";
import { ENGINE_VERSION } from "@/lib/types";
import { clamp } from "@/lib/utils";

export const WEIGHTS: Record<EngineFactorId, number> = {
  reach: 0.34,
  balance: 0.26,
  glow: 0.16,
  rhythm: 0.1,
  goldenHour: 0.14,
};

/** Fuel a single member is expected to contribute before the beacon is full. */
const FUEL_PER_MEMBER = 3;

/** A beacon needs at least this much fuel regardless of how small the group is. */
const MIN_BEACON_FUEL = 6;

/** Minutes of daylight below which an outdoor round is not really viable. */
const MIN_USABLE_DAYLIGHT = 60;

/** Weight of the beacon. The 3D scene renders exactly this many facets. */
export const FACET_COUNT = 12;

type Live = { ember: Ember; fuel: number };

function liveEmbers(bundle: RoundBundle): Live[] {
  return bundle.embers
    .filter((e) => e.deletedAt === null)
    .map((ember) => ({ ember, fuel: ember.weight }))
    .sort((a, b) => {
      // Stable ordering so repeated analysis never reshuffles evidence.
      const byTime = Date.parse(a.ember.createdAt) - Date.parse(b.ember.createdAt);
      if (byTime !== 0) return byTime;
      return a.ember.id < b.ember.id ? -1 : a.ember.id > b.ember.id ? 1 : 0;
    });
}

/**
 * Per-member participation.
 *
 * Members on the roster who never contributed are kept with `participation: 0`,
 * because "somebody never played" is the fact this whole product exists to
 * surface. A member absent from the roster entirely cannot be reported, which
 * is why `reach` is always computed against the roster, never against embers.
 */
export function contributions(bundle: RoundBundle): MemberContribution[] {
  const live = liveEmbers(bundle);
  const totalFuel = live.reduce((sum, l) => sum + l.fuel, 0);

  const byMember = new Map<string, { embers: number; fuel: number }>();
  for (const member of bundle.members) byMember.set(member.id, { embers: 0, fuel: 0 });
  for (const { ember, fuel } of live) {
    const slot = byMember.get(ember.memberId);
    // An ember whose member was removed still counts toward fuel totals but is
    // not attributed to anyone, which the balance factor treats as unowned fuel.
    if (slot) {
      slot.embers += 1;
      slot.fuel += fuel;
    }
  }

  const rows = bundle.members.map((member) => {
    const slot = byMember.get(member.id) ?? { embers: 0, fuel: 0 };
    return {
      memberId: member.id,
      displayName: member.displayName,
      ageBand: member.ageBand,
      embers: slot.embers,
      fuel: slot.fuel,
      share: totalFuel === 0 ? 0 : slot.fuel / totalFuel,
      participation: slot.embers > 0 ? 1 : 0,
    };
  });

  return rows.sort((a, b) => {
    if (b.participation !== a.participation) return b.participation - a.participation;
    if (b.fuel !== a.fuel) return b.fuel - a.fuel;
    // Final tie-break is stable and never depends on input order.
    return a.displayName.localeCompare(b.displayName) || a.memberId.localeCompare(b.memberId);
  });
}

/** Gini coefficient over non-negative values. Returns 0 for a single value. */
export function gini(values: number[]): number {
  const n = values.length;
  if (n === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const total = sorted.reduce((sum, v) => sum + v, 0);
  if (total === 0) return 0;
  let cumulative = 0;
  for (let i = 0; i < n; i++) cumulative += (i + 1) * sorted[i];
  const g = (2 * cumulative) / (n * total) - (n + 1) / n;
  // Floating point can push a perfectly even distribution a hair past 0 or 1.
  return clamp(g, 0, 1);
}

/** Coefficient of variation, or null when the mean is zero. */
function coefficientOfVariation(values: number[]): number | null {
  const n = values.length;
  if (n < 2) return null;
  const mean = values.reduce((sum, v) => sum + v, 0) / n;
  if (mean === 0) return null;
  const variance =
    values.reduce((sum, v) => sum + (v - mean) * (v - mean), 0) / n;
  return Math.sqrt(variance) / mean;
}

function minutesBetween(a: string, b: string): number {
  const delta = Date.parse(b) - Date.parse(a);
  if (Number.isNaN(delta)) return 0;
  return delta / 60000;
}

function factor(
  id: EngineFactorId,
  label: string,
  score: number,
  detail: string,
  evidence: string[],
): EngineFactor {
  return {
    id,
    label,
    weight: WEIGHTS[id],
    score: Math.round(clamp(score, 0, 100) * 100) / 100,
    detail,
    evidence,
  };
}

export type AnalyzeOptions = {
  /** Injected clock, ISO. Required so analysis stays pure. */
  now: string;
  /** Live or sealed-fallback sky data; null when the network path failed. */
  sky: SkyEnvelope | null;
};

export function analyzeRound(bundle: RoundBundle, opts: AnalyzeOptions): EngineResult {
  const live = liveEmbers(bundle);
  const rows = contributions(bundle);
  const rosterSize = bundle.members.length;
  const totalFuel = live.reduce((sum, l) => sum + l.fuel, 0);

  /* ---------------- reach ---------------- */
  const reached = rows.filter((r) => r.participation > 0).length;
  const leftOut = rows.filter((r) => r.participation === 0);
  const reachScore = rosterSize === 0 ? 0 : (reached / rosterSize) * 100;
  const leftOutNames = leftOut.map((r) => r.displayName);

  const reach = factor(
    "reach",
    "Reach",
    reachScore,
    rosterSize === 0
      ? "No one is on the roster yet, so nobody can be reached."
      : leftOut.length === 0
        ? `All ${rosterSize} people on the roster lit at least one facet.`
        : `${leftOut.length} of ${rosterSize} people never lit a facet.`,
    [
      `Roster: ${rosterSize}`,
      `Reached: ${reached}`,
      leftOutNames.length ? `Left out: ${leftOutNames.join(", ")}` : "Left out: nobody",
    ],
  );

  /* ---------------- balance ---------------- */
  // Fuel belonging to removed members is excluded so it cannot mask an unfair
  // split between people who are actually on the roster.
  const fuelByMember = rows.map((r) => r.fuel);
  let balanceScore: number;
  let balanceDetail: string;
  const balanceEvidence: string[] = [];
  if (rosterSize === 0) {
    balanceScore = 0;
    balanceDetail = "No roster, so there is nothing to balance.";
  } else if (totalFuel === 0) {
    balanceScore = 0;
    balanceDetail = "Nothing has been lit yet, so fairness cannot be measured.";
    balanceEvidence.push("Total fuel: 0");
  } else {
    const g = gini(fuelByMember);
    balanceScore = (1 - g) * 100;
    const top = rows[0];
    const heaviest = top && top.fuel > 0 ? top.displayName : null;
    balanceDetail =
      g === 0
        ? "Fuel is spread perfectly evenly across the roster."
        : heaviest
          ? `${heaviest} carries the most fuel; the split is uneven.`
          : "The fuel split is uneven.";
    balanceEvidence.push(`Gini coefficient: ${g.toFixed(3)}`);
    balanceEvidence.push(
      rows
        .filter((r) => r.fuel > 0)
        .map((r) => `${r.displayName} ${r.fuel} (${Math.round(r.share * 100)}%)`)
        .join(", "),
    );
  }

  const balance = factor("balance", "Balance", balanceScore, balanceDetail, balanceEvidence);

  /* ---------------- glow ---------------- */
  const targetFuel = Math.max(MIN_BEACON_FUEL, rosterSize * FUEL_PER_MEMBER);
  // Rational saturating curve: totalFuel === targetFuel lands exactly on 1.
  const glowRaw = (2 * totalFuel) / (totalFuel + targetFuel);
  const glowPct = Math.round(clamp(glowRaw, 0, 1) * 100);
  const glow = factor(
    "glow",
    "Glow",
    glowPct,
    glowPct >= 100
      ? "The beacon is fully lit."
      : `The beacon is ${glowPct}% of the fuel a full beacon needs.`,
    [
      `Total fuel: ${totalFuel}`,
      `Target fuel for ${rosterSize} ${rosterSize === 1 ? "person" : "people"}: ${targetFuel}`,
      `Contributions: ${live.length}`,
    ],
  );

  /* ---------------- rhythm ---------------- */
  const gaps: number[] = [];
  for (let i = 1; i < live.length; i++) {
    gaps.push(minutesBetween(live[i - 1].ember.createdAt, live[i].ember.createdAt));
  }
  const cv = coefficientOfVariation(gaps);
  let rhythmScore: number;
  let rhythmDetail: string;
  const rhythmEvidence: string[] = [`Contributions: ${live.length}`];
  if (live.length < 2) {
    rhythmScore = 50;
    rhythmDetail = "Not enough contributions yet to judge pacing.";
  } else if (cv === null) {
    rhythmScore = 50;
    rhythmDetail = "Contributions share a timestamp, so pacing is unmeasured.";
  } else {
    rhythmScore = (1 - clamp(cv, 0, 1)) * 100;
    rhythmDetail =
      rhythmScore >= 80
        ? "Contributions arrived at an even, unhurried pace."
        : rhythmScore >= 50
          ? "Pacing was uneven; a few people lit several facets in a row."
          : "Almost all the fuel arrived in one burst.";
    rhythmEvidence.push(`Gap variation: ${cv.toFixed(3)}`);
    rhythmEvidence.push(
      `First to last: ${minutesBetween(live[0].ember.createdAt, live[live.length - 1].ember.createdAt).toFixed(1)} min`,
    );
  }
  const rhythm = factor("rhythm", "Rhythm", rhythmScore, rhythmDetail, rhythmEvidence);

  /* ---------------- golden hour ---------------- */
  const { round } = bundle;
  let goldenScore = 50;
  let goldenDetail = "Set a place and a date to check the outdoor light.";
  const goldenEvidence: string[] = [];
  if (round.latitude === null || round.longitude === null || !round.scheduledDate) {
    goldenEvidence.push("No place or date set on this round.");
  } else if (!opts.sky) {
    goldenDetail = "Live sky data was unavailable, so the light window is unverified.";
    goldenEvidence.push("Sky data: unavailable");
  } else {
    const day = opts.sky.days.find((d) => d.date === round.scheduledDate);
    if (!day) {
      goldenDetail = `No sunrise or sunset available for ${round.scheduledDate}.`;
      goldenEvidence.push(`Requested: ${round.scheduledDate}`);
    } else {
      const usable = day.daylightMinutes;
      goldenScore = clamp((usable / MIN_USABLE_DAYLIGHT) * 100, 0, 100);
      goldenDetail =
        goldenScore >= 100
          ? `There are ${usable} minutes of daylight on ${day.date}.`
          : `Only ${usable} minutes of daylight on ${day.date}; an outdoor round is tight.`;
      goldenEvidence.push(`Sunrise: ${day.sunrise}`);
      goldenEvidence.push(`Sunset: ${day.sunset}`);
      goldenEvidence.push(`Daylight: ${usable} min`);
      goldenEvidence.push(
        `Best window: about ${Math.max(0, usable / 2 - 15).toFixed(0)} min around midday`,
      );
      if (opts.sky.status === "fallback") {
        goldenEvidence.push("Source: sealed offline sample, not live");
      }
    }
  }
  const goldenHour = factor(
    "goldenHour",
    "Golden hour",
    goldenScore,
    goldenDetail,
    goldenEvidence,
  );

  const factors = [reach, balance, glow, rhythm, goldenHour];
  // `factor()` already normalizes each score to 0..100, and the weights sum to
  // 1, so this weighted mean is itself on the 0..100 scale. Do not rescale.
  const overall = factors.reduce((sum, f) => sum + f.score * f.weight, 0);

  /* ---------------- recommendation ---------------- */
  const actions: string[] = [];
  const headline = buildHeadline({ rosterSize, leftOut, reachScore, glowPct, goldenScore });
  if (rosterSize === 0) {
    actions.push("Add the people who are actually playing to the roster first.");
  } else if (leftOut.length > 0) {
    actions.push(
      `Give ${leftOutNames.join(" and ")} ${leftOut.length === 1 ? "a turn" : "turns"} before the beacon is called lit.`,
    );
  }
  if (rosterSize > 1 && balanceScore > 0 && balanceScore < 70) {
    actions.push(
      "Nudge the heaviest contributor to hand out their next facet instead of taking it.",
    );
  }
  if (glowPct < 100) {
    actions.push(`${100 - glowPct} more fuel is needed to finish the beacon.`);
  }
  if (live.length >= 2 && rhythmScore < 60) {
    actions.push("Fuel arrived in a burst; spread the next round across the whole session.");
  }
  if (goldenScore < 100 && goldenScore > 0) {
    actions.push("Move the round inside golden hour, or plan it as an indoor round.");
  }
  if (actions.length === 0) {
    actions.push("Nothing to fix. Everyone played and the beacon is full.");
  }

  return {
    version: ENGINE_VERSION,
    scores: {
      reach: reach.score,
      balance: balance.score,
      glow: glow.score,
      rhythm: rhythm.score,
      goldenHour: goldenHour.score,
    },
    overall: Math.round(overall * 100) / 100,
    factors,
    contributions: rows,
    recommendation: {
      headline,
      detail: `${rosterSize} on the roster, ${reached} reached, ${leftOut.length} left out, ${live.length} contributions, ${totalFuel} fuel.`,
      actions,
    },
    seal: bundle.seal,
    empty: rosterSize === 0,
  };
}

function buildHeadline(input: {
  rosterSize: number;
  leftOut: MemberContribution[];
  reachScore: number;
  glowPct: number;
  goldenScore: number;
}): string {
  const { rosterSize, leftOut, reachScore, glowPct } = input;
  if (rosterSize === 0) return "Nobody is on the roster yet";
  if (leftOut.length === rosterSize) return "Nobody lit a facet";
  if (leftOut.length === 0 && glowPct >= 100) return "Everyone played and the beacon is full";
  if (leftOut.length === 0) return "Everyone played; the beacon still needs fuel";
  return `${leftOut.length} ${leftOut.length === 1 ? "person was" : "people were"} left out (${Math.round(reachScore)}% reach)`;
}

/** Convenience for tests and the agent tool: build an empty-but-valid bundle. */
export function emptyBundle(now: string, seal: string): RoundBundle {
  return {
    round: {
      id: "empty",
      joinCode: "0000",
      title: "Empty round",
      placeLabel: "Nowhere",
      latitude: null,
      longitude: null,
      scheduledDate: null,
      status: "open",
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
    members: [],
    embers: [],
    seal,
  };
}

export type { Member, Ember };