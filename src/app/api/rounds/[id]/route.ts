import { NextResponse } from "next/server";
import {
  badRequest,
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
import { deleteRound, getBundle, getRound, headSeal, isUuid, updateRound } from "@/lib/db/repository";
import { isOwner, resolveAccess } from "@/lib/access";
import { CONFIRM_HEADER, assertDestructiveConfirmation, readScope } from "@/lib/session";
import { fieldErrors, updateRoundSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/rounds/:id — round, roster, embers and the current seal.
 *
 * Access is resolved by ownership, not by guessing: if the round does not exist
 * *or* belongs to another session, both cases return the same 404, so the
 * endpoint cannot be used to probe for other people's rounds.
 */
export async function GET(_request: Request, { params }: Ctx): Promise<NextResponse> {
  try {
    await ensureSchema();
    const { id } = await params;
    if (!isUuid(id)) return notUuidError();

    const db = await getDb();
    const access = await resolveAccess(db, id);
    if (!access) return notFound("No round with that id is available to this session.");

    const bundle = await getBundle(db, id);
    if (!bundle) return notFound("No round with that id is available to this session.");

    return ok({ bundle, access });
  } catch (error) {
    return handleServerError(error);
  }
}

/** PATCH /api/rounds/:id — partial update of the round's plan. */
export async function PATCH(request: Request, { params }: Ctx): Promise<NextResponse> {
  try {
    await ensureSchema();
    const { id } = await params;
    if (!isUuid(id)) return notUuidError();
    const scope = await readScope();
    if (!scope) return unauthorized("No session cookie, so this round is not yours to edit.");

    const db = await getDb();
    if (!(await isOwner(db, id))) {
      return unauthorized("Only the host who created this round can change it.");
    }

    let body: unknown;
    try {
      body = await readJson(request);
    } catch (error) {
      if (error instanceof PayloadTooLargeError) return badRequest("That request body was too large.");
      return badRequest("The request body was not valid JSON.");
    }

    const parsed = updateRoundSchema.safeParse(body);
    if (!parsed.success) {
      return unprocessable("Check the fields you tried to change.", fieldErrors(parsed.error));
    }

    const round = await updateRound(db, scope, id, { ...parsed.data, now: new Date().toISOString() });
    if (!round) return notFound("No round with that id belongs to this session.");

    return ok({ round, seal: await headSeal(db, id) });
  } catch (error) {
    return handleServerError(error);
  }
}

/**
 * DELETE /api/rounds/:id — soft delete.
 *
 * The row keeps a `deleted_at` tombstone and the chain gains a `round.delete`
 * event, so the history of a deleted round stays verifiable rather than
 * vanishing.
 *
 * Requires this round's join code in the `x-emberwake-confirm` header, so a
 * leaked round UUID is not enough to destroy somebody's round.
 */
export async function DELETE(request: Request, { params }: Ctx): Promise<NextResponse> {
  try {
    await ensureSchema();
    const { id } = await params;
    if (!isUuid(id)) return notUuidError();
    const scope = await readScope();
    if (!scope) return unauthorized("No session cookie, so this round is not yours to delete.");

    const db = await getDb();
    if (!(await isOwner(db, id))) {
      return unauthorized("Only the host who created this round can delete it.");
    }

    const existing = await getRound(db, scope, id);
    if (!existing) return notFound("No round with that id belongs to this session.");

    if (!assertDestructiveConfirmation(existing.joinCode, request.headers.get(CONFIRM_HEADER))) {
      return unprocessable(
        "Confirm the deletion by sending this round's join code in the x-emberwake-confirm header.",
        { confirm: "Join code did not match." },
      );
    }

    const now = new Date().toISOString();
    const deleted = await deleteRound(db, scope, id, now);
    return ok({ deleted: deleted !== null, deletedAt: now, seal: await headSeal(db, id) });
  } catch (error) {
    return handleServerError(error);
  }
}