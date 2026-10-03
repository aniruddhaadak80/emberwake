/**
 * Live sky data.
 *
 * The only network dependency in the product, and it needs no API key:
 * Open-Meteo serves sunrise/sunset and geocoding for free without signup.
 *
 * Why this source: the app's one genuinely useful external fact is "was there
 * enough daylight for this round, and when should we have played?". That is a
 * real, recurring question when a family plans to be outside, and it is not
 * something a closed or paid weather API should be allowed to gate.
 *
 * Behaviour contract:
 *  - every request is time-bounded and retried at most once;
 *  - failures degrade to a sealed, dated sample labelled `fallback`, and the UI
 *    is required to render that label;
 *  - user-created data is never touched by this module, so a fallback can never
 *    overwrite anything a person actually did.
 */

import type { SkyDay, SkyEnvelope } from "@/lib/types";
import { localMinutes as parseLocalMinutes } from "@/lib/sun";

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";

const ATTRIBUTION =
  "Sunrise/sunset and geocoding data by Open-Meteo (open-meteo.com), CC BY 4.0.";

const TIMEOUT_MS = 6000;
const REVALIDATE_SECONDS = 3600;

export type GeocodeResult = {
  label: string;
  latitude: number;
  longitude: number;
  timezone: string;
};

/**
 * Sealed offline sample. Deliberately labelled `fallback` in the envelope so a
 * screen cannot present it as today's real light. Used when the network is
 * unavailable, and by tests.
 */
const FALLBACK_DAY: SkyDay = {
  date: "2026-10-18",
  sunrise: "2026-10-18T05:44",
  sunset: "2026-10-18T17:52",
  daylightMinutes: 728,
};

export const FALLBACK_SKY: SkyEnvelope = {
  status: "fallback",
  placeLabel: "Kolkata, West Bengal",
  latitude: 22.56263,
  longitude: 88.36304,
  timezone: "Asia/Kolkata",
  days: [FALLBACK_DAY],
  fetchedAt: "2026-10-02T00:00:00.000Z",
  source: {
    name: "Open-Meteo (sealed offline sample)",
    url: "https://open-meteo.com",
    attribution: ATTRIBUTION,
  },
  note: "Live sky data was unavailable, so this is a sealed sample from 2026-10-18, not today's light.",
};

/**
 * Minutes since local midnight for the provider's offset-free timestamps.
 *
 * Imported rather than reimplemented: the daylight model and this normalizer must
 * agree on exactly what a timestamp means, and one validated parser is easier to
 * trust than two that can drift apart.
 */
function localMinutes(value: string): number | null {
  return parseLocalMinutes(value);
}

function toDay(date: string, sunrise: string, sunset: string): SkyDay | null {
  const up = localMinutes(sunrise);
  const down = localMinutes(sunset);
  if (up === null || down === null || down <= up) return null;
  return { date, sunrise, sunset, daylightMinutes: down - up };
}

/** `fetch` with a hard timeout and at most one retry. */
async function fetchJson(
  url: string,
  init: RequestInit,
): Promise<Record<string, unknown> | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        next: { revalidate: REVALIDATE_SECONDS },
      });
      if (!response.ok) return null;
      return (await response.json()) as Record<string, unknown>;
    } catch {
      // Timeout, DNS failure or abort: fall through to the single retry.
    }
  }
  return null;
}

export async function geocodePlace(query: string): Promise<GeocodeResult | null> {
  const trimmed = query.trim().slice(0, 80);
  if (trimmed.length < 2) return null;

  const url = `${GEOCODE_URL}?name=${encodeURIComponent(trimmed)}&count=1&language=en&format=json`;
  const json = await fetchJson(url, {});
  const results = json?.results;
  if (!Array.isArray(results) || results.length === 0) return null;

  const first = results[0] as Record<string, unknown>;
  const latitude = Number(first.latitude);
  const longitude = Number(first.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const label = [first.name, first.admin1, first.country]
    .filter((part) => typeof part === "string" && part.length > 0)
    .join(", ");

  return {
    label: label.slice(0, 80),
    latitude,
    longitude,
    timezone: typeof first.timezone === "string" ? first.timezone : "auto",
  };
}

/**
 * Fetches normalized sunrise/sunset days for a place.
 *
 * Never throws. Returns a `fallback` envelope on any failure so a page render is
 * never blocked by an upstream outage.
 */
export async function fetchSky(
  latitude: number,
  longitude: number,
  placeLabel: string,
  startDate: string,
  endDate: string,
): Promise<SkyEnvelope> {
  const url =
    `${FORECAST_URL}?latitude=${latitude}&longitude=${longitude}` +
    `&daily=sunrise,sunset&timezone=auto&start_date=${startDate}&end_date=${endDate}`;

  const json = await fetchJson(url, {});

  const daily = json?.daily as Record<string, unknown> | undefined;
  const times = daily?.time;
  const sunrises = daily?.sunrise;
  const sunsets = daily?.sunset;

  if (!Array.isArray(times) || !Array.isArray(sunrises) || !Array.isArray(sunsets)) {
    return {
      ...FALLBACK_SKY,
      placeLabel: placeLabel || FALLBACK_SKY.placeLabel,
      latitude,
      longitude,
      note: `Live sky data was unavailable, so this is a sealed sample from ${FALLBACK_DAY.date}, not today's light.`,
    };
  }

  const days: SkyDay[] = [];
  for (let i = 0; i < times.length; i++) {
    const date = String(times[i]);
    const sunrise = String(sunrises[i] ?? "");
    const sunset = String(sunsets[i] ?? "");
    if (!sunrise || !sunset) continue;
    const day = toDay(date, sunrise, sunset);
    if (day) days.push(day);
  }

  if (days.length === 0) {
    return {
      ...FALLBACK_SKY,
      placeLabel: placeLabel || FALLBACK_SKY.placeLabel,
      latitude,
      longitude,
      note: `Open-Meteo returned no usable sunrise or sunset, so this is a sealed sample from ${FALLBACK_DAY.date}.`,
    };
  }

  return {
    status: "live",
    placeLabel: placeLabel || "Selected place",
    latitude,
    longitude,
    timezone: typeof json?.timezone === "string" ? json.timezone : "auto",
    days,
    fetchedAt: new Date().toISOString(),
    source: { name: "Open-Meteo", url: "https://open-meteo.com", attribution: ATTRIBUTION },
  };
}

/** Date window helper so callers never build an invalid range. */
export function dateWindow(centre: string, spanDays = 1): { start: string; end: string } {
  const base = Date.parse(`${centre}T00:00:00Z`);
  const safe = Number.isNaN(base) ? Date.parse("2026-10-02T00:00:00Z") : base;
  const start = new Date(safe).toISOString().slice(0, 10);
  const end = new Date(safe + (spanDays - 1) * 86_400_000).toISOString().slice(0, 10);
  return { start, end };
}