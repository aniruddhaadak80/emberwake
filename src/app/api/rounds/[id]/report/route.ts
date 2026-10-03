import { NextResponse } from "next/server";
import { handleServerError, notFound, notUuidError } from "@/lib/api";
import { ensureSchema, getDb } from "@/lib/db/client";
import { analyzeRound } from "@/lib/engine/beacon-engine";
import { getBundle, listAudit, isUuid } from "@/lib/db/repository";
import { canContribute } from "@/lib/access";
import { buildReport, renderReportText } from "@/lib/report";
import { dateWindow, fetchSky } from "@/lib/sky";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/rounds/:id/report          -> JSON report
 * GET /api/rounds/:id/report?format=text -> plain text, suitable for download
 *                                       or pasting into a family group chat
 */
export async function GET(request: Request, { params }: Ctx): Promise<NextResponse> {
  try {
    await ensureSchema();
    const { id } = await params;
    if (!isUuid(id)) return notUuidError();

    const db = await getDb();
    if (!(await canContribute(db, id))) {
      return notFound("No round with that id is available to this session.");
    }

    const bundle = await getBundle(db, id);
    if (!bundle) return notFound("No round with that id is available to this session.");
    const round = bundle.round;

    let sky = null;
    if (round.latitude !== null && round.longitude !== null && round.scheduledDate) {
      const window = dateWindow(round.scheduledDate, 1);
      sky = await fetchSky(round.latitude, round.longitude, round.placeLabel, window.start, window.end);
    }

    const generatedAt = new Date().toISOString();
    const result = analyzeRound(bundle, { now: generatedAt, sky });
    const events = await listAudit(db, id);
    const report = buildReport(bundle, result, sky, events, generatedAt);

    if (new URL(request.url).searchParams.get("format") === "text") {
      return new NextResponse(renderReportText(report), {
        status: 200,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          // A download that a browser can save without a prompt loop.
          "content-disposition": `attachment; filename="emberwake-${round.joinCode}.txt"`,
          "cache-control": "no-store",
        },
      });
    }

    return NextResponse.json({ report }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return handleServerError(error);
  }
}