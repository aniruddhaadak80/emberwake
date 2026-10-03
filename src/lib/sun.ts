/**
 * Daylight model.
 *
 * The arena's lighting is derived from real sunrise and sunset times fetched from
 * Open-Meteo, not from a looping animation. That is the point: if you open the
 * app at 9pm in Kolkata, the beacon is genuinely in night lighting, and if you
 * open it at 2pm it is genuinely in daylight.
 *
 * Honesty about precision: this is a simplified single-arc model, not an
 * ephemeris. It maps the wall-clock time onto an arc between the observed
 * sunrise and sunset and sweeps the sun's azimuth east to west. It does not
 * account for latitude, declination or atmospheric refraction, so treat the
 * altitude as "is the sun meaningfully up", not as a degree-accurate
 * observation. The sunrise/sunset *times* themselves are real provider data.
 */

export type SunState = {
  /** -1 (deep night) to 1 (high noon). Simplified. */
  altitude: number;
  /** Degrees clockwise from north. 90 = east, 180 = south, 270 = west. */
  azimuth: number;
  /** 0 at sunrise, 1 at sunset, clamped outside. */
  dayProgress: number;
  /** Coarse phase used to pick a palette. */
  phase: "night" | "dawn" | "day" | "dusk";
};

export type SkyPalette = {
  zenith: number;
  horizon: number;
  /** Directional light colour. */
  sun: number;
  fog: number;
  /** Ambient/hemisphere intensity. */
  ambient: number;
  /** How strongly the beacon's own glow reads against the sky. */
  beaconContrast: number;
};

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * Parses the provider's offset-free local timestamps ("2026-10-18T05:44") into
 * minutes since midnight. Hand-parsed so the result never depends on the
 * machine's own timezone.
 *
 * Ranges are validated rather than trusted: a string like `T99:99` is rejected
 * instead of silently becoming a nonsense minute count that would light the
 * scene as if it were mid-afternoon.
 */
export function localMinutes(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hours = Number(match[4]);
  const minutes = Number(match[5]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Computes the sun state for a local wall-clock time.
 * Returns `null` when the sunrise/sunset pair is unusable, so callers can fall
 * back to a fixed dusk rather than drawing a false dawn.
 */
export function sunState(
  sunrise: string | null,
  sunset: string | null,
  nowLocalMinutes: number | null,
): SunState | null {
  if (!sunrise || !sunset) return null;
  const rise = localMinutes(sunrise);
  const set = localMinutes(sunset);
  if (rise === null || set === null || set <= rise) return null;
  if (nowLocalMinutes === null) return null;

  const daylight = set - rise;
  const progress = (nowLocalMinutes - rise) / daylight;

  let altitude: number;
  let phase: SunState["phase"];

  if (progress < 0 || progress > 1) {
    // Before sunrise or after sunset: the sun is below the horizon. Altitude
    // falls off with distance from the day window so twilight is not a step.
    const distance = progress < 0 ? -progress * daylight : (progress - 1) * daylight;
    altitude = -clamp01(distance / 90) * 0.9;
    phase = progress < 0.35 ? "dawn" : "dusk";
    if (distance > 90) phase = "night";
  } else {
    // Simple sine arc across the day.
    altitude = Math.sin(progress * Math.PI) * 0.92;
    // The ends of the day window are twilight, and they are not the same colour:
    // the early side is dawn, the late side is dusk.
    if (progress < 0.12) phase = "dawn";
    else if (progress > 0.88) phase = "dusk";
    else phase = "day";
  }

  const azimuth = 90 + clamp01(progress) * 180;

  return {
    altitude: Math.round(altitude * 1000) / 1000,
    azimuth: Math.round(azimuth * 10) / 10,
    dayProgress: Math.round(clamp01(progress) * 1000) / 1000,
    phase,
  };
}

/* Palette keyframes, chosen against the tidal teal + ember brand. */
const NIGHT: SkyPalette = {
  zenith: 0x03080f,
  horizon: 0x0d2233,
  sun: 0x3d5a73,
  fog: 0x08151f,
  ambient: 0.32,
  beaconContrast: 1,
};

const DAWN: SkyPalette = {
  zenith: 0x123047,
  horizon: 0xff9a52,
  sun: 0xffb066,
  fog: 0x1a3446,
  ambient: 0.55,
  beaconContrast: 0.9,
};

const DAY: SkyPalette = {
  zenith: 0x2f7f9e,
  horizon: 0xa8d8e6,
  sun: 0xfff3d6,
  fog: 0x7fb3c6,
  ambient: 0.95,
  beaconContrast: 0.45,
};

const DUSK: SkyPalette = {
  zenith: 0x1a2140,
  horizon: 0xc2527a,
  sun: 0xff8a5c,
  fog: 0x241f3a,
  ambient: 0.48,
  beaconContrast: 0.95,
};

/** Blends the four keyframes by sun altitude. Deterministic and clamped. */
export function skyPalette(altitude: number): SkyPalette {
  const a = Math.max(-1, Math.min(1, altitude));

  const mix = (x: number, y: number, t: number) => Math.round(x + (y - x) * t);
  const lerpPalette = (p: SkyPalette, q: SkyPalette, t: number): SkyPalette => ({
    zenith: mix(p.zenith, q.zenith, t),
    horizon: mix(p.horizon, q.horizon, t),
    sun: mix(p.sun, q.sun, t),
    fog: mix(p.fog, q.fog, t),
    ambient: Math.round((p.ambient + (q.ambient - p.ambient) * t) * 100) / 100,
    beaconContrast: Math.round((p.beaconContrast + (q.beaconContrast - p.beaconContrast) * t) * 100) / 100,
  });

  if (a <= -0.3) return NIGHT;
  if (a <= 0) return lerpPalette(NIGHT, DAWN, clamp01((a + 0.3) / 0.3));
  if (a < 0.25) return lerpPalette(DAWN, DAY, clamp01(a / 0.25));
  if (a < 0.55) return lerpPalette(DAY, DUSK, clamp01((a - 0.55) / 0.55));
  return DAY;
}

/** Local wall-clock minutes for "now" in a named IANA zone, best effort. */
export function localMinutesNow(timezone: string): number | null {
  try {
    const now = new Date();
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now);
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "NaN");
    const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "NaN");
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    return (hour % 24) * 60 + minute;
  } catch {
    // Unknown timezone: the caller falls back to a fixed dusk.
    return null;
  }
}