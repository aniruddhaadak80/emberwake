/**
 * GET /api/join/:code
 *
 * What the QR code resolves to. Returns only what a joining player needs — the
 * round's title, place, date and who is already playing — and never the owner's
 * session, never the owner scope, and never another visitor's records.
 */

import { NextResponse } from "next/server";
import { handleServerError, notFound, ok } from "@/lib/api";
import { ensureSchema, getDb } from "@/lib/db/client";
import { getRoundByJoinCode, isValidJoinCode, listMembers } from "@/lib/db/repository";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ code: string }> };

export async function GET(_request: Request, { params }: Ctx): Promise<NextResponse> {
  try {
    await ensureSchema();
    const { code } = await params;
    const normalised = code.toUpperCase();
    if (!isValidJoinCode(normalised)) {
      return notFound("That is not a valid Emberwake join code.");
    }

    const db = await getDb();
    const round = await getRoundByJoinCode(db, normalised);
    if (!round) return notFound("No round is using that code. Ask the host for a fresh one.");

    const members = await listMembers(db, round.id);

    return ok({
      round: {
        id: round.id,
        title: round.title,
        placeLabel: round.placeLabel,
        scheduledDate: round.scheduledDate,
        status: round.status,
        joinCode: round.joinCode,
        createdAt: round.createdAt,
      },
      // Names and bands only. Presence is the point of a join screen; member ids
      // are handed out by the POST that actually joins.
      alreadyPlaying: members.map((m) => ({ displayName: m.displayName, ageBand: m.ageBand })),
    });
  } catch (error) {
    return handleServerError(error);
  }
}