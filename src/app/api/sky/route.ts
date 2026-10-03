/**
 * Live sky data endpoint.
 *
 * Normalized Open-Meteo sunrise/sunset. Always returns `status: "live" | "fallback"`
 * so a client cannot mistake the sealed sample for real light.
 */

import { NextResponse } from "next/server";
import { dateWindow, fetchSky, geocodePlace, FALLBACK_SKY } from "@/lib/sky";
import { badRequest, ok } from "@/lib/api";
import { fieldErrors, geocodeSchema, skyQuerySchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

/** `GET /api/sky?lat=..&lng=..&place=..&date=YYYY-MM-DD&days=1` */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);

  // `?q=` is the geocoding shorthand used by the settings screen.
  const q = url.searchParams.get("q");
  if (q !== null) {
    const parsed = geocodeSchema.safeParse({ q });
    if (!parsed.success) {
      return badRequest("Invalid search term.", fieldErrors(parsed.error));
    }
    const place = await geocodePlace(parsed.data.q);
    if (!place) {
      return badRequest(
        `No place called "${parsed.data.q.slice(0, 40)}" was found. Try a city name.`,
      );
    }
    return ok({ place, sky: null });
  }

  const parsed = skyQuerySchema.safeParse({
    lat: url.searchParams.get("lat") ?? undefined,
    lng: url.searchParams.get("lng") ?? undefined,
    place: url.searchParams.get("place") ?? "",
    date: url.searchParams.get("date") ?? undefined,
    days: url.searchParams.get("days") ?? undefined,
  });

  if (!parsed.success) {
    return badRequest("Invalid sky query.", fieldErrors(parsed.error));
  }

  const { lat, lng, place, date, days } = parsed.data;
  const window = dateWindow(date, days);
  const sky = await fetchSky(lat, lng, place, window.start, window.end);
  return ok(sky, { headers: { "cache-control": "public, max-age=300" } });
}

export async function HEAD(): Promise<NextResponse> {
  // Lets the client cheaply confirm the sealed sample is still what we ship.
  return NextResponse.json(FALLBACK_SKY, { headers: { "cache-control": "no-store" } });
}