/**
 * API response helpers.
 *
 * One stable envelope for every error the product can return, so a client never
 * has to guess whether a failure body is `{error}`, `{message}` or an HTML
 * stack trace. Error messages here are safe to show: none of them interpolate a
 * database error string, a stack, or an environment variable.
 */

import { NextResponse } from "next/server";
import type { ApiError } from "@/lib/types";
import { DbUnavailableError } from "@/lib/db/types";

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, init);
}

export function created<T>(data: T): NextResponse {
  return NextResponse.json(data, { status: 201 });
}

export function fail(
  status: number,
  code: string,
  message: string,
  fields?: Record<string, string>,
): NextResponse<ApiError> {
  return NextResponse.json<ApiError>(
    { error: fields ? { code, message, fields } : { code, message } },
    { status },
  );
}

export const badRequest = (message: string, fields?: Record<string, string>) =>
  fail(400, "bad_request", message, fields);

export const unauthorized = (message = "This round belongs to another session.") =>
  fail(403, "forbidden", message);

export const notFound = (message = "Not found.") => fail(404, "not_found", message);

/**
 * Response for a path segment that cannot be a row id.
 *
 * `rounds.id` is a uuid column, so an unrecognised segment would otherwise reach
 * Postgres and raise `22P02`, surfacing as an opaque 500. This keeps the answer
 * a truthful 404 and deliberately does not confirm whether anything exists.
 */
export const notUuidError = () =>
  notFound("No round with that id is available to this session.");

export const conflict = (message: string) => fail(409, "conflict", message);

export const unprocessable = (message: string, fields: Record<string, string>) =>
  fail(422, "unprocessable", message, fields);

export const tooManyRequests = (message = "Too many requests. Try again shortly.") =>
  fail(429, "rate_limited", message);

export const unavailable = (message = "This service is temporarily unavailable.") =>
  fail(503, "unavailable", message);

/**
 * Last-resort handler for a route body.
 *
 * A missing or unreachable database is a 503 with a fixed message, never a 500
 * that leaks the connection string, and never a silent success.
 */
export function handleServerError(error: unknown): NextResponse<ApiError> {
  if (error instanceof DbUnavailableError) {
    return unavailable(
      "The datastore is not configured for this deployment. Nothing was saved.",
    );
  }
  // Logged server-side so an operator can diagnose, deliberately not echoed to
  // the client because an error message may carry a connection string, a SQL
  // fragment or a filesystem path.
  console.error("[emberwake] unhandled route error:", error);
  return fail(500, "internal", "Something went wrong handling that request.");
}

/** Bounded JSON body read. Rejects oversized payloads before parsing. */
export async function readJson(request: Request, maxBytes = 32_000): Promise<unknown> {
  const raw = await request.text();
  if (raw.length > maxBytes) {
    throw new PayloadTooLargeError();
  }
  if (raw.length === 0) return {};
  return JSON.parse(raw) as unknown;
}

export class PayloadTooLargeError extends Error {
  constructor() {
    super("Request body too large.");
    this.name = "PayloadTooLargeError";
  }
}

/**
 * Fixed-window, in-memory abuse control for anonymous writes.
 *
 * Honest limitation: on serverless this is best-effort only, because instances
 * are not shared and can be recycled. It stops casual scripted hammering from a
 * single warm instance and gives us a cheap tripwire; anything adversarial
 * needs a hosted limiter at the edge, which is documented in the README rather
 * than pretended to be solved here.
 */
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 5_000) {
      for (const [k, v] of buckets) if (now > v.resetAt) buckets.delete(k);
    }
    return true;
  }
  bucket.count += 1;
  return bucket.count <= limit;
}