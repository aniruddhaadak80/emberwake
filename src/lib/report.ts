/**
 * Round report.
 *
 * The takeaway artifact. Everything a host needs to look at their family group
 * chat and change a plan: who reached the beacon, who was left out, how the fuel
 * was shared, and when the light was actually good enough to play outside.
 *
 * The `facets` array is the important one. It is the per-facet fuel total, and
 * it is the *only* input the 3D beacon geometry uses. That means the picture and
 * the number cannot disagree: if the beacon looks lopsided, the fuel genuinely is
 * lopsided, because they are the same array.
 */

import { FACET_COUNT } from "@/lib/engine/beacon-engine";
import { replayChain } from "@/lib/integrity/seal";
import type {
  AuditEvent,
  Ember,
  MemberContribution,
  Round,
  RoundBundle,
  SkyEnvelope,
} from "@/lib/types";
import type { EngineResult } from "@/lib/types";

export type ReportPayload = {
  generatedAt: string;
  round: {
    id: string;
    title: string;
    joinCode: string;
    placeLabel: string;
    scheduledDate: string | null;
    status: Round["status"];
  };
  headline: string;
  engine: {
    version: string;
    overall: number;
    scores: EngineResult["scores"];
    factors: EngineResult["factors"];
    recommendation: EngineResult["recommendation"];
  };
  contributions: MemberContribution[];
  /** Total fuel per beacon facet, index 0..11. Drives the 3D geometry. */
  facets: number[];
  /** How many members touched each facet; a gap here is the visual signature. */
  facetReach: number[];
  leftOut: string[];
  light: {
    status: SkyEnvelope["status"];
    sunrise: string | null;
    sunset: string | null;
    daylightMinutes: number | null;
    timezone: string;
    placeLabel: string;
    fetchedAt: string | null;
    source: SkyEnvelope["source"] | null;
    note: string | null;
  };
  integrity: {
    genesis: string;
    head: string;
    events: number;
    ok: boolean;
    brokenAt: { seq: number } | null;
  };
  attribution: string;
};

export function buildReport(
  bundle: RoundBundle,
  result: EngineResult,
  sky: SkyEnvelope | null,
  events: AuditEvent[],
  generatedAt: string,
): ReportPayload {
  const facets = new Array<number>(FACET_COUNT).fill(0);
  const facetReach = new Array<number>(FACET_COUNT).fill(0);

  const live: Ember[] = bundle.embers.filter((e) => e.deletedAt === null);
  for (const ember of live) {
    if (ember.facet >= 0 && ember.facet < FACET_COUNT) {
      facets[ember.facet] += ember.weight;
      facetReach[ember.facet] += 1;
    }
  }

  const replay = replayChain(events);
  const day =
    sky && bundle.round.scheduledDate
      ? sky.days.find((d) => d.date === bundle.round.scheduledDate)
      : undefined;

  return {
    generatedAt,
    round: {
      id: bundle.round.id,
      title: bundle.round.title,
      joinCode: bundle.round.joinCode,
      placeLabel: bundle.round.placeLabel,
      scheduledDate: bundle.round.scheduledDate,
      status: bundle.round.status,
    },
    headline: result.recommendation.headline,
    engine: {
      version: result.version,
      overall: result.overall,
      scores: result.scores,
      factors: result.factors,
      recommendation: result.recommendation,
    },
    contributions: result.contributions,
    facets,
    facetReach,
    leftOut: result.contributions.filter((c) => c.participation === 0).map((c) => c.displayName),
    light: {
      status: sky?.status ?? "fallback",
      sunrise: day?.sunrise ?? null,
      sunset: day?.sunset ?? null,
      daylightMinutes: day?.daylightMinutes ?? null,
      timezone: sky?.timezone ?? "unknown",
      placeLabel: sky?.placeLabel ?? bundle.round.placeLabel,
      fetchedAt: sky?.fetchedAt ?? null,
      source: sky?.source ?? null,
      note: sky?.note ?? null,
    },
    integrity: {
      genesis: replay.genesis,
      head: replay.head ?? replay.genesis,
      events: replay.events,
      ok: replay.ok,
      brokenAt: replay.brokenAt ? { seq: replay.brokenAt.seq } : null,
    },
    attribution:
      "Beacon fairness scores are computed by the Emberwake deterministic engine. " +
      "Sunrise and sunset data by Open-Meteo (CC BY 4.0). Voice transcripts, when present, " +
      "were produced in the player's own browser by open-weight Whisper.",
  };
}

/**
 * Plain-text rendering used by the "copy to WhatsApp" action and by the
 * downloadable file. Deliberately readable by a grandparent: no markdown table,
 * no jargon.
 */
export function renderReportText(report: ReportPayload): string {
  const lines: string[] = [];
  lines.push(`${report.round.title} — Emberwake round report`);
  lines.push("");
  lines.push(report.headline);
  lines.push(report.engine.recommendation.detail);
  lines.push("");
  lines.push(`Overall: ${Math.round(report.engine.overall)}/100  (engine ${report.engine.version})`);
  for (const factor of report.engine.factors) {
    lines.push(`  ${factor.label.padEnd(12)} ${Math.round(factor.score).toString().padStart(3)}  ${factor.detail}`);
  }
  lines.push("");
  lines.push("Who played:");
  for (const row of report.contributions) {
    const mark = row.participation > 0 ? "" : "  <- never played";
    lines.push(`  ${row.displayName.padEnd(16)} ${row.embers} contribution(s), ${row.fuel} fuel${mark}`);
  }
  lines.push("");
  if (report.leftOut.length > 0) {
    lines.push(`Left out: ${report.leftOut.join(", ")}`);
    lines.push("");
  }
  if (report.light.sunrise && report.light.sunset) {
    lines.push(
      `Light on ${report.round.scheduledDate}: sunrise ${report.light.sunrise}, sunset ${report.light.sunset}` +
        ` (${report.light.daylightMinutes} min)${report.light.status === "fallback" ? " [offline sample, not live]" : ""}`,
    );
  } else {
    lines.push("Light: no sunrise or sunset available for this round.");
  }
  lines.push("");
  lines.push("What to do next:");
  for (const action of report.engine.recommendation.actions) lines.push(`  - ${action}`);
  lines.push("");
  lines.push(`Integrity: ${report.integrity.events} events, chain ${report.integrity.ok ? "verified" : "BROKEN"}`);
  lines.push(`Seal: ${report.integrity.head}`);
  lines.push(`Generated ${report.generatedAt}`);
  lines.push("");
  lines.push(report.attribution);
  return lines.join("\n");
}