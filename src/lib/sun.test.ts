import { describe, expect, it } from "vitest";
import { localMinutes, skyPalette, sunState } from "@/lib/sun";

/**
 * Daylight model tests.
 *
 * The sunrise/sunset *times* come from Open-Meteo; this module only maps a local
 * wall-clock time onto a simplified arc. These tests pin the properties that
 * matter for the 3D scene: night really reads as night, noon really reads as
 * day, and unusable input degrades rather than producing a false dawn.
 */

const SUNRISE = "2026-10-18T05:44";
const SUNSET = "2026-10-18T17:52";

describe("localMinutes", () => {
  it("parses the provider's offset-free timestamps", () => {
    expect(localMinutes(SUNRISE)).toBe(5 * 60 + 44);
    expect(localMinutes(SUNSET)).toBe(17 * 60 + 52);
  });

  it("returns null for anything it cannot parse", () => {
    expect(localMinutes("not-a-time")).toBeNull();
    expect(localMinutes("")).toBeNull();
    expect(localMinutes("2026-13-45T99:99")).toBeNull();
  });
});

describe("sunState", () => {
  it("returns null when there is no usable sunrise or sunset", () => {
    expect(sunState(null, SUNSET, 600)).toBeNull();
    expect(sunState(SUNRISE, null, 600)).toBeNull();
    expect(sunState("bad", SUNSET, 600)).toBeNull();
    expect(sunState(SUNSET, SUNRISE, 600)).toBeNull(); // sunset before sunrise
    expect(sunState(SUNRISE, SUNSET, null)).toBeNull();
  });

  it("puts local midnight below the horizon in the night phase", () => {
    const state = sunState(SUNRISE, SUNSET, 0);
    expect(state).not.toBeNull();
    expect(state?.altitude).toBeLessThan(0);
    expect(state?.phase).toBe("night");
  });

  it("puts solar noon at its highest point", () => {
    const noon = sunState(SUNRISE, SUNSET, 11 * 60 + 48);
    expect(noon?.altitude).toBeGreaterThan(0.8);
    expect(noon?.dayProgress).toBeCloseTo(0.5, 2);
  });

  it("places sunrise and sunset exactly at the horizon", () => {
    expect(sunState(SUNRISE, SUNSET, 5 * 60 + 44)?.altitude).toBeCloseTo(0, 2);
    expect(sunState(SUNRISE, SUNSET, 17 * 60 + 52)?.altitude).toBeCloseTo(0, 2);
  });

  it("clamps dayProgress to 0..1 outside the day window", () => {
    expect(sunState(SUNRISE, SUNSET, 0)?.dayProgress).toBe(0);
    expect(sunState(SUNRISE, SUNSET, 23 * 60)?.dayProgress).toBe(1);
  });

  it("sweeps the azimuth from east to west across the day", () => {
    const morning = sunState(SUNRISE, SUNSET, 8 * 60);
    const evening = sunState(SUNRISE, SUNSET, 16 * 60);
    expect(morning?.azimuth).toBeLessThan(180);
    expect(evening?.azimuth).toBeGreaterThan(180);
  });

  it("labels the evening side as dusk", () => {
    expect(sunState(SUNRISE, SUNSET, 17 * 60 + 40)?.phase).toBe("dusk");
  });

  it("keeps altitude inside -1..1 for every minute of the day", () => {
    for (let minute = 0; minute < 24 * 60; minute += 7) {
      const state = sunState(SUNRISE, SUNSET, minute);
      expect(state).not.toBeNull();
      expect(state!.altitude).toBeGreaterThanOrEqual(-1);
      expect(state!.altitude).toBeLessThanOrEqual(1);
      expect(Number.isFinite(state!.altitude)).toBe(true);
    }
  });

  it("is a pure function of its inputs", () => {
    const a = sunState(SUNRISE, SUNSET, 700);
    const b = sunState(SUNRISE, SUNSET, 700);
    expect(b).toEqual(a);
  });
});

describe("skyPalette", () => {
  it("is dark at night and bright at noon", () => {
    const night = skyPalette(-0.8);
    const noon = skyPalette(0.9);
    expect(night.ambient).toBeLessThan(noon.ambient);
    expect(night.beaconContrast).toBeGreaterThan(noon.beaconContrast);
    expect(night.zenith).not.toBe(noon.zenith);
  });

  it("makes the beacon read most strongly when the sky is darkest", () => {
    const contrasts = [-0.9, -0.2, 0.1, 0.5, 0.95].map((a) => skyPalette(a).beaconContrast);
    expect(contrasts[0]).toBeGreaterThan(contrasts[4]!);
  });

  it("clamps altitudes outside -1..1 instead of extrapolating", () => {
    expect(skyPalette(-5)).toEqual(skyPalette(-1));
    expect(skyPalette(5)).toEqual(skyPalette(1));
  });

  it("returns valid colours for any input", () => {
    for (const altitude of [-1, -0.5, 0, 0.3, 0.7, 1]) {
      const palette = skyPalette(altitude);
      for (const channel of [palette.zenith, palette.horizon, palette.sun, palette.fog]) {
        expect(Number.isInteger(channel)).toBe(true);
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(0xffffff);
      }
    }
  });
});