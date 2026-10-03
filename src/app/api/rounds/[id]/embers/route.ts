import { NextResponse } from "next/server";
import {
  badRequest,
  conflict,
  created,
  handleServerError,
  notFound,
  ok,
  PayloadTooLargeError,
  rateLimit,
  readJson,
  unauthorized,
  unprocessable,
  notUuidError,
} from "@/lib/api";
import { ensureSchema, getDb } from "@/lib/db/client";
import { addEmber, getBundle, headSeal, listMembers, isUuid } from "@/lib/db/repository";
import { canContribute } from "@/lib/access";
import { readScope } from "@/lib/session";
import { addEmberSchema, fieldErrors } from "@/lib/validation";
import type { Ember } from "@/lib/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/rounds/:id/embers — live (non-deleted) embers for the round. */
export async function GET(_request: Request, { params }: Ctx): Promise<NextResponse> {
  try {
    await ensureSchema();
    const { id } = await params;
    if (!isUuid(id)) return notUuidError();

    const db = await getDb();
    if (!(await canContribute(db, id))) {
      return notFound("No round with that id is available to this session.");
    }

    const bundle = await getBundle(db, id);
    return ok({ embers: bundle?.embers ?? [] });
  } catch (error) {
    return handleServerError(error);
  }
}

/**
 * POST /api/rounds/:id/embers — light a facet.
 *
 * This is the decisive mutation of the whole product: it is what the 3D "Light"
 * control, the agent's `light_facet` tool and the REST client all call, and it
 * is what moves Reach, Balance and Glow.
 */
export async function POST(request: Request, { params }: Ctx): Promise<NextResponse> {
  try {
    await ensureSchema();
    const { id } = await params;
    if (!isUuid(id)) return notUuidError();
    const scope = await readScope();
    if (!scope) {
      return unauthorized("No session cookie, so you cannot contribute without a session.");
    }

    const db = await getDb();
    if (!(await canContribute(db, id))) {
      return notFound(
        "No round with that id is available to this session. Scan the round's QR code to join it first.",
      );
    }

    const bundle = await getBundle(db, id);
    if (!bundle) return notFound("No round with that id is available to this session.");
    const round = bundle.round;

    if (round.status === "closed") {
      return conflict("This round is closed, so it cannot take new embers.");
    }

    if (!rateLimit(`ember:${scope}`, 120, 60_000)) {
      return unprocessable("You are lighting facets very quickly. Pause for a moment.", {
        rate: "Too many contributions in one window.",
      });
    }

    let body: unknown;
    try {
      body = await readJson(request);
    } catch (error) {
      if (error instanceof PayloadTooLargeError) return badRequest("That request body was too large.");
      return badRequest("The request body was not valid JSON.");
    }

    const parsed = addEmberSchema.safeParse(body);
    if (!parsed.success) {
      return unprocessable("Check the ember details and try again.", fieldErrors(parsed.error));
    }

    // A member id from a different round must never be usable here.
    const members = await listMembers(db, id);
    if (!members.some((m) => m.id === parsed.data.memberId)) {
      return unprocessable("That member is not on this round's roster.", {
        memberId: "Add the person to the roster first.",
      });
    }

    const ember = await addEmber(db, {
      roundId: id,
      memberId: parsed.data.memberId,
      kind: parsed.data.kind,
      weight: parsed.data.weight,
      facet: parsed.data.facet,
      transcript: parsed.data.transcript ?? null,
      transcriptEngine: parsed.data.transcriptEngine ?? null,
      note: parsed.data.note ?? null,
      now: new Date().toISOString(),
    });

    return created({ ember: ember satisfies Ember, seal: await headSeal(db, id) });
  } catch (error) {
    return handleServerError(error);
  }
}