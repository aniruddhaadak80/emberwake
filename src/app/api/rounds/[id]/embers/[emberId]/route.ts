import { NextResponse } from "next/server";
import { handleServerError, notFound, ok, unauthorized, notUuidError } from "@/lib/api";
import { ensureSchema, getDb } from "@/lib/db/client";
import { deleteEmber, headSeal, isUuid } from "@/lib/db/repository";
import { isOwner } from "@/lib/access";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; emberId: string }> };

/**
 * DELETE /api/rounds/:id/embers/:emberId
 *
 * Host-only: a player may add fuel but not remove it, otherwise the fairness
 * record could be edited by the very people it measures.
 *
 * Soft delete, so the ember's creation event stays in the chain and replay still
 * proves what happened. The row disappears from every read path immediately.
 */
export async function DELETE(_request: Request, { params }: Ctx): Promise<NextResponse> {
  try {
    await ensureSchema();
    const { id, emberId } = await params;
    if (!isUuid(id)) return notUuidError();

    const db = await getDb();
    if (!(await isOwner(db, id))) {
      return unauthorized("Only the host who created this round can remove a contribution.");
    }

    const now = new Date().toISOString();
    const deleted = await deleteEmber(db, id, emberId, now);
    if (!deleted) return notFound("No ember with that id on this round.");

    return ok({ deleted: true, deletedAt: now, seal: await headSeal(db, id) });
  } catch (error) {
    return handleServerError(error);
  }
}