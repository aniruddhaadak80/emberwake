/**
 * GET /api/demo
 *
 * The public, clearly-labelled demo round. It exists so a first-time visitor can
 * see a real analysed round with a real imbalance instead of an empty shell.
 *
 * It lives under its own owner scope, is excluded from every visitor's round
 * list, and every surface that renders it shows a "demo round" badge. It is
 * seeded, read-only here, and never mixed with a visitor's own data.
 */

import { NextResponse } from "next/server";
import { handleServerError, ok } from "@/lib/api";
import { ensureSchema, getDb } from "@/lib/db/client";
import { analyzeRound } from "@/lib/engine/beacon-engine";
import { getDemoBundle, listAudit } from "@/lib/db/repository";
import { buildReport } from "@/lib/report";
import { dateWindow, fetchSky } from "@/lib/sky";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    await ensureSchema();
    const db = await getDb();
    const bundle = await getDemoBundle(db);

    if (!bundle) {
      return ok({
        demo: true,
        available: false,
        message: "The demo round has not been seeded in this environment yet.",
      });
    }

    let sky = null;
    if (bundle.round.latitude !== null && bundle.round.longitude !== null && bundle.round.scheduledDate) {
      const window = dateWindow(bundle.round.scheduledDate, 1);
      sky = await fetchSky(
        bundle.round.latitude,
        bundle.round.longitude,
        bundle.round.placeLabel,
        window.start,
        window.end,
      );
    }

    const generatedAt = new Date().toISOString();
    const result = analyzeRound(bundle, { now: generatedAt, sky });
    const events = await listAudit(db, bundle.round.id);
    const report = buildReport(bundle, result, sky, events, generatedAt);

    return NextResponse.json(
      {
        demo: true,
        available: true,
        round: bundle.round,
        members: bundle.members,
        embers: bundle.embers,
        result,
        report,
        sky,
      },
      { headers: { "cache-control": "public, max-age=60" } },
    );
  } catch (error) {
    return handleServerError(error);
  }
}