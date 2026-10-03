import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Formats an ISO timestamp for display without pulling in a locale bundle.
 * Returns the input unchanged when it is not a valid date, so a malformed
 * upstream value degrades to visible-but-truthful rather than crashing a render.
 */
export function formatWhen(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return new Date(ms).toISOString().replace("T", " ").slice(0, 16) + "Z";
}

/** Clamp helper shared by the engine and the UI so both bound identically. */
export function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, n));
}