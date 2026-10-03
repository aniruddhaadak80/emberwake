/**
 * POST /api/rounds/:id/analyze
 *
 * The engine endpoint. It returns a versioned, itemized result plus the seal
 * the score was computed against, so a score can be tied back to the exact
 * chain head it describes.
 *
 * Note: analysis is a pure function of stored data, so this endpoint does not
 * need to write anything. It does append a `round.analyze` audit event when
 * `?record=true`, which is how a host can prove when a report was produced.
 */

import { NextResponse } from "next/server";
import { handleServerError, notFound, ok, notUuidError } from "@/lib/api";
import { ensureSchema, getDb } from "@/lib/db/client";
import { analyzeRound } from "@/lib/engine/beacon-engine";
import { getBundle, headSeal, isUuid } from "@/lib/db/repository";
import { resolveAccess } from "@/lib/access";
import { dateWindow, fetchSky } from "@/lib/sky";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Ctx): Promise<NextResponse> {
  try {
    await ensureSchema();
    const { id } = await params;
    if (!isUuid(id)) return notUuidError();

    const db = await getDb();
    const access = await resolveAccess(db, id);
    if (!access) return notFound("No round with that id is available to this session.");

    const bundle = await getBundle(db, id);
    if (!bundle) return notFound("No round with that id is available to this session.");
    const round = bundle.round;

    // Only fetch the network when the round actually has somewhere and a date,
    // and only for the day that round is planned for.
    let sky = null;
    if (round.latitude !== null && round.longitude !== null && round.scheduledDate) {
      const window = dateWindow(round.scheduledDate, 1);
      sky = await fetchSky(
        round.latitude,
        round.longitude,
        round.placeLabel,
        window.start,
        window.end,
      );
    }

    const result = analyzeRound(bundle, { now: new Date().toISOString(), sky });

    // Only the host may append to the chain: a player can read the analysis but
    // cannot write audit events into somebody else's round.
    if (access === "owner" && new URL(request.url).searchParams.get("record") === "true") {
      const { appendAudit } = await import("@/lib/db/repository");
      await appendAudit(db, {
        roundId: id,
        entityType: "round",
        entityId: id,
        action: "round.analyze",
        payload: {
          version: result.version,
          overall: result.overall,
          scores: result.scores,
          skyStatus: sky?.status ?? "unavailable",
        },
        createdAt: new Date().toISOString(),
      });
    }

    return ok({ result, sky, seal: await headSeal(db, id) });
  } catch (error) {
    return handleServerError(error);
  }
}