import { NextResponse } from "next/server";
import {
  badRequest,
  created,
  handleServerError,
  notFound,
  ok,
  PayloadTooLargeError,
  readJson,
  unauthorized,
  unprocessable,
  notUuidError,
} from "@/lib/api";
import { ensureSchema, getDb } from "@/lib/db/client";
import { addMember, getRound, getRoundByJoinCode, headSeal, removeMember, isUuid } from "@/lib/db/repository";
import { getOrCreateScope, grantPlayerScope, readScope } from "@/lib/session";
import { addMemberSchema, fieldErrors } from "@/lib/validation";
import { isOwner } from "@/lib/access";
import { isValidJoinCode } from "@/lib/db/repository";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/rounds/:id/members
 *
 * The QR join path. A visitor who scans the code joins the round under their own
 * anonymous scope; the host's session is never required and is never exposed.
 */
export async function POST(request: Request, { params }: Ctx): Promise<NextResponse> {
  try {
    await ensureSchema();
const { id } = await params;
    // Deliberately no UUID guard here: this is the one route that legitimately
    // accepts a human-typed join code as well as a UUID. The shape is checked
    // below, before anything reaches Postgres.
    // Joining mints a scope for the new player, so this is the one member route
    // that must create rather than read.
    const scope = await getOrCreateScope();

    let body: unknown;
    try {
      body = await readJson(request);
    } catch (error) {
      if (error instanceof PayloadTooLargeError) return badRequest("That request body was too large.");
      return badRequest("The request body was not valid JSON.");
    }

    const parsed = addMemberSchema.safeParse(body);
    if (!parsed.success) {
      return unprocessable("Tell us your name to join.", fieldErrors(parsed.error));
    }

    const db = await getDb();

    // The round may be addressed either by id (the host editing their roster) or
    // by join code (a guest who only scanned the QR).
    //
    // The UUID check is essential, not cosmetic: `rounds.id` is a uuid column, so
    // querying it with a join code makes Postgres raise `22P02 invalid input
    // syntax`, which was a 500 on the single most important path in the product.
    let round = isUuid(id) ? await getRound(db, scope, id) : null;
    let viaQr = false;
    if (!round && isValidJoinCode(id)) {
      round = await getRoundByJoinCode(db, id);
      viaQr = round !== null;
    }
    if (!round) return notFound("That round could not be found from this link or code.");

    const member = await addMember(db, {
      roundId: round.id,
      displayName: parsed.data.displayName,
      ageBand: parsed.data.ageBand,
      joinedVia: viaQr ? "qr" : parsed.data.joinedVia,
      now: new Date().toISOString(),
    });

    // A guest who joined by scanning the code is a *player* of this round: they
    // may light facets, but they are not the host and cannot edit or delete it.
    // Without this the QR would let someone join and then be unable to play.
    await grantPlayerScope(round.id);

    return created({ member, roundId: round.id, seal: await headSeal(db, round.id) });
  } catch (error) {
    return handleServerError(error);
  }
}

/** DELETE /api/rounds/:id/members?memberId=... — host removes someone. */
export async function DELETE(request: Request, { params }: Ctx): Promise<NextResponse> {
  try {
    await ensureSchema();
    const { id } = await params;
    if (!isUuid(id)) return notUuidError();
    const scope = await readScope();
    if (!scope) return unauthorized("No session cookie, so this round is not yours to edit.");

    const memberId = new URL(request.url).searchParams.get("memberId");
    if (!memberId) return badRequest("Send memberId to say who should be removed.");

    const db = await getDb();
    if (!(await isOwner(db, id))) {
      return unauthorized("Only the host who created this round can change the roster.");
    }

    const round = await getRound(db, scope, id);
    if (!round) return notFound("No round with that id belongs to this session.");

    const now = new Date().toISOString();
    const removed = await removeMember(db, id, memberId, now);
    if (!removed) return notFound("That person is not on this roster.");

    return ok({ removed: true, seal: await headSeal(db, id) });
  } catch (error) {
    return handleServerError(error);
  }
}