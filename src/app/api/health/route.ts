/**
 * Health endpoint.
 *
 * The important property: this performs a real query round-trip against the
 * configured datastore and reports which adapter answered. A static `"ok"` would
 * make a production build with no database look healthy, which is exactly the
 * failure this endpoint exists to catch.
 */

import { NextResponse } from "next/server";
import { describeAdapter, ensureSchema, getDb } from "@/lib/db/client";
import { DbUnavailableError } from "@/lib/db/types";
import { ENGINE_VERSION } from "@/lib/types";
import type { HealthReport } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse<HealthReport>> {
  const startedAt = Date.now();
  try {
    await ensureSchema();
    const db = await getDb();

    // Touch a real table, not just `select 1`, so a missing migration is caught.
    const probe = await db.query<{ n: number }>(
      "select count(*)::int as n from audit_events",
    );
    const rounds = await db.query<{ n: number }>("select count(*)::int as n from rounds");

    return NextResponse.json(
      {
        status: "ok",
        store: {
          adapter: db.adapter,
          reachable: true,
          detail: `round-tripped in ${Date.now() - startedAt}ms; ${rounds.rows[0]?.n ?? 0} rounds and ${
            probe.rows[0]?.n ?? 0
          } audit events readable`,
        },
        engine: { version: ENGINE_VERSION },
        checkedAt: new Date().toISOString(),
      } satisfies HealthReport,
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const adapter = describeAdapter();
    const detail =
      error instanceof DbUnavailableError
        ? error.message
        : "Datastore check failed; see server logs.";
    return NextResponse.json(
      {
        status: "degraded",
        store: { adapter, reachable: false, detail },
        engine: { version: ENGINE_VERSION },
        checkedAt: new Date().toISOString(),
      } satisfies HealthReport,
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}