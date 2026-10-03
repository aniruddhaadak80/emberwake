/**
 * Idempotent first-run seed.
 *
 * Creates exactly one clearly-labelled public demo round, and only when none
 * exists. It lives under `DEMO_SCOPE`, which is excluded from every
 * owner-scoped query, so it can never appear in a visitor's own list and can
 * never be mistaken for their data.
 *
 * The demo is deliberately *unfair*: two people on the roster never contribute.
 * That is the whole point of the product, and a demo where everybody participated
 * would hide the problem the report exists to surface.
 */

import type { SqlClient } from "@/lib/db/types";
import { DEMO_SCOPE } from "@/lib/db/schema";
import { addEmber, addMember, createRound, findDemoRoundId } from "@/lib/db/repository";
import type { AgeBand } from "@/lib/types";

const DEMO_TITLE = "Diwali Thursday";
const DEMO_PLACE = "Kolkata, West Bengal";
const DEMO_LAT = 22.56263;
const DEMO_LNG = 88.36304;
const DEMO_DATE = "2026-10-18";

/** Fixed instants so the demo's pacing evidence is reproducible. */
const BASE = Date.parse("2026-10-18T14:10:00.000Z");

type SeedMember = {
  name: string;
  band: AgeBand;
  /** How many embers this person contributes. 0 is the point of the demo. */
  embers: { facet: number; weight: number; kind: "spark" | "note" }[];
};

const DEMO_MEMBERS: SeedMember[] = [
  { name: "Aunty Maya", band: "elder", embers: [] },
  { name: "Grandpa Ravi", band: "elder", embers: [] },
  { name: "Priya", band: "adult", embers: [
    { facet: 0, weight: 5, kind: "spark" },
    { facet: 1, weight: 4, kind: "spark" },
    { facet: 2, weight: 4, kind: "spark" },
    { facet: 3, weight: 3, kind: "note" },
  ] },
  { name: "Arjun", band: "teen", embers: [
    { facet: 6, weight: 5, kind: "spark" },
    { facet: 7, weight: 4, kind: "spark" },
    { facet: 9, weight: 3, kind: "spark" },
  ] },
  { name: "Meera", band: "adult", embers: [
    { facet: 4, weight: 3, kind: "spark" },
    { facet: 5, weight: 2, kind: "note" },
  ] },
  { name: "Tara", band: "child", embers: [
    { facet: 11, weight: 3, kind: "spark" },
  ] },
];

function iso(offsetMinutes: number): string {
  return new Date(BASE + offsetMinutes * 60_000).toISOString();
}

export async function seedIfEmpty(db: SqlClient): Promise<void> {
  const existing = await findDemoRoundId(db);
  if (existing) return;

  const round = await createRound(db, {
    ownerScope: DEMO_SCOPE,
    title: DEMO_TITLE,
    placeLabel: DEMO_PLACE,
    latitude: DEMO_LAT,
    longitude: DEMO_LNG,
    scheduledDate: DEMO_DATE,
    now: iso(0),
  });

  // Two elders join by QR, the rest by link, so the join provenance is varied
  // and the QR job-to-be-done has real evidence behind it.
  const joinedVia = ["qr", "qr", "host", "link", "host", "qr"] as const;

  let cursor = 0;
  for (const [index, spec] of DEMO_MEMBERS.entries()) {
    const member = await addMember(db, {
      roundId: round.id,
      displayName: spec.name,
      ageBand: spec.band,
      joinedVia: joinedVia[index],
      now: iso(cursor),
    });
    cursor += 1;

    for (const ember of spec.embers) {
      cursor += 3;
      await addEmber(db, {
        roundId: round.id,
        memberId: member.id,
        kind: ember.kind,
        weight: ember.weight,
        facet: ember.facet,
        transcript:
          ember.kind === "note"
            ? "Seeded example note shown in the public demo round."
            : null,
        transcriptEngine: null,
        note: null,
        now: iso(cursor),
      });
    }
  }
}