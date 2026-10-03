import { NextResponse } from "next/server";
import { badRequest, created, handleServerError, ok, PayloadTooLargeError, rateLimit, readJson, tooManyRequests, unprocessable } from "@/lib/api";
import { ensureSchema, getDb } from "@/lib/db/client";
import { createRound, listRounds } from "@/lib/db/repository";
import { getOrCreateScope } from "@/lib/session";
import { createRoundSchema, fieldErrors, listRoundsQuerySchema } from "@/lib/validation";
import type { Round } from "@/lib/types";

export const dynamic = "force-dynamic";

/** GET /api/rounds?limit=20&offset=0&status=all — scoped to the caller. */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    await ensureSchema();
    const url = new URL(request.url);
    const parsed = listRoundsQuerySchema.safeParse({
      limit: url.searchParams.get("limit") ?? undefined,
      offset: url.searchParams.get("offset") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
    });
    if (!parsed.success) {
      return badRequest("Invalid list options.", fieldErrors(parsed.error));
    }

    const scope = await getOrCreateScope();
    const db = await getDb();
    const page = await listRounds(db, scope, parsed.data);
    return ok({ ...page, limit: parsed.data.limit, offset: parsed.data.offset });
  } catch (error) {
    return handleServerError(error);
  }
}

/** POST /api/rounds — creates a round owned by the caller's anonymous scope. */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    await ensureSchema();
    const scope = await getOrCreateScope();

    // Best-effort anonymous write control; see `rateLimit` for its real limits.
    if (!rateLimit(`round:create:${scope}`, 20, 60_000)) {
      return tooManyRequests("Too many rounds created in a short window.");
    }

    let body: unknown;
    try {
      body = await readJson(request);
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        return badRequest("That request body was too large.");
      }
      return badRequest("The request body was not valid JSON.");
    }

    const parsed = createRoundSchema.safeParse(body);
    if (!parsed.success) {
      return unprocessable("Check the round details and try again.", fieldErrors(parsed.error));
    }

    const db = await getDb();
    const round = await createRound(db, {
      ownerScope: scope,
      title: parsed.data.title,
      placeLabel: parsed.data.placeLabel,
      latitude: parsed.data.latitude,
      longitude: parsed.data.longitude,
      scheduledDate: parsed.data.scheduledDate,
      now: new Date().toISOString(),
    });

    const { headSeal } = await import("@/lib/db/repository");
    const seal = await headSeal(db, round.id);
    return created({ round, seal } satisfies { round: Round; seal: string });
  } catch (error) {
    return handleServerError(error);
  }
}