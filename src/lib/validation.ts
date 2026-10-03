/**
 * Request validation.
 *
 * Every value that crosses the network boundary is parsed here before it can
 * reach the database. Sizes, string lengths, enum membership and numeric ranges
 * are all constrained so a hostile or simply broken client cannot write an
 * unbounded string or an out-of-range facet.
 */

import { z } from "zod";
import { AGE_BANDS, EMBER_KINDS, ROUND_STATUSES } from "@/lib/types";
import { FACET_COUNT } from "@/lib/engine/beacon-engine";

const trimmed = (max: number) => z.string().trim().max(max);
const name = trimmed(60).min(1, "A name is required.");

/** Accepts `YYYY-MM-DD` and rejects impossible calendar dates. */
const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD.")
  .refine((value) => {
    const ms = Date.parse(`${value}T00:00:00Z`);
    return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === value;
  }, "That is not a real calendar date.");

export const createRoundSchema = z.object({
  title: trimmed(80).min(1, "Give the round a title."),
  placeLabel: trimmed(80).default(""),
  latitude: z.number().min(-90).max(90).nullable().default(null),
  longitude: z.number().min(-180).max(180).nullable().default(null),
  scheduledDate: isoDate.nullable().default(null),
});

export const updateRoundSchema = z
  .object({
    title: trimmed(80).min(1).optional(),
    placeLabel: trimmed(80).optional(),
    latitude: z.number().min(-90).max(90).nullable().optional(),
    longitude: z.number().min(-180).max(180).nullable().optional(),
    scheduledDate: isoDate.nullable().optional(),
    status: z.enum(ROUND_STATUSES).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Send at least one field to update.",
  });

export const addMemberSchema = z.object({
  displayName: name,
  ageBand: z.enum(AGE_BANDS),
  joinedVia: z.enum(["qr", "link", "host"]).default("link"),
});

export const addEmberSchema = z.object({
  memberId: z.string().uuid("memberId must be a member id."),
  kind: z.enum(EMBER_KINDS).default("spark"),
  weight: z.number().int().min(1).max(5).default(3),
  facet: z.number().int().min(0).max(FACET_COUNT - 1),
  transcript: trimmed(4000).nullable().optional(),
  transcriptEngine: trimmed(60).nullable().optional(),
  note: trimmed(280).nullable().optional(),
});

export const geocodeSchema = z.object({
  q: trimmed(80).min(2, "Type at least two characters."),
});

export const skyQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  place: trimmed(80).default(""),
  date: isoDate,
  days: z.coerce.number().int().min(1).max(7).default(1),
});

export const listRoundsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
  status: z.union([z.enum(ROUND_STATUSES), z.literal("all")]).default("all"),
});

/** Flattens a ZodError into the `fields` map of the API error envelope. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : "_";
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}