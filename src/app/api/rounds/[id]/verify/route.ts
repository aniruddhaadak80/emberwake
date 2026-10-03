/**
 * GET /api/rounds/:id/verify
 *
 * Replays the round's SHA-384 chain and reports the first broken link, if any.
 * Uses the same `replayChain` used by the report, so the two can never disagree
 * about whether history is intact.
 */

import { NextResponse } from "next/server";
import { handleServerError, notFound, notUuidError } from "@/lib/api";
import { ensureSchema, getDb } from "@/lib/db/client";
import { listAudit, isUuid } from "@/lib/db/repository";
import { canContribute } from "@/lib/access";
import { replayChain, shortSeal } from "@/lib/integrity/seal";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx): Promise<NextResponse> {
  try {
    await ensureSchema();
    const { id } = await params;
    if (!isUuid(id)) return notUuidError();

    const db = await getDb();
    if (!(await canContribute(db, id))) {
      return notFound("No round with that id is available to this session.");
    }

    const events = await listAudit(db, id);
    const replay = replayChain(events);

    return NextResponse.json(
      {
        replay,
        headShort: replay.head ? shortSeal(replay.head) : null,
        // The formula is documented in the UI so a reader can recompute a seal
        // themselves rather than trusting this endpoint.
        formula: "seal_n = SHA-384(UTF-8(prevSeal) || canonicalJson(event_n))",
        recent: events.slice(-12).reverse(),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return handleServerError(error);
  }
}