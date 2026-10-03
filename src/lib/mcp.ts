/**
 * MCP-style JSON-RPC 2.0 endpoint implementation.
 *
 * Transport: POST a JSON-RPC 2.0 request to `/api/mcp`. Supported methods are
 * `initialize`, `tools/list`, `tools/call` and `ping`.
 *
 * Two properties matter more than the protocol details:
 *
 *  1. Every tool goes through the same repository functions as the REST API and
 *     the UI, so `light_facet` and the on-screen "Light" button are literally the
 *     same mutation. An agent cannot reach state the product cannot.
 *  2. Mutating tools accept `idempotencyKey`. A replayed call with the same key
 *     returns the first result instead of adding a second ember, which is what
 *     makes an agent safe to retry.
 */

import { z } from "zod";
import { ensureSchema, getDb } from "@/lib/db/client";
import { analyzeRound, FACET_COUNT } from "@/lib/engine/beacon-engine";
import {
  addEmber,
  addMember,
  deleteRound,
  getBundle,
  getRound,
  headSeal,
  isValidJoinCode,
  listAudit,
  listRounds,
} from "@/lib/db/repository";
import { replayChain } from "@/lib/integrity/seal";
import { canContribute, isOwner } from "@/lib/access";
import { buildReport, renderReportText } from "@/lib/report";
import { dateWindow, fetchSky } from "@/lib/sky";
import { AGE_BANDS } from "@/lib/types";
import type { SqlClient } from "@/lib/db/types";
import type { SkyEnvelope } from "@/lib/types";

export const PROTOCOL_VERSION = "2025-06-18";
export const SERVER_INFO = {
  name: "emberwake",
  version: "1.0.0",
} as const;

/* ------------------------------------------------------------------ */
/* Tool schemas                                                        */
/* ------------------------------------------------------------------ */

const idempotencyKey = z
  .string()
  .trim()
  .min(8)
  .max(120)
  .regex(/^[A-Za-z0-9._:-]+$/, "Use letters, digits, dot, dash, colon or underscore.")
  .optional()
  .describe(
    "Replay guard. Repeating a call with the same key returns the original result instead of mutating twice.",
  );

const listRoundsArgs = z.object({
  limit: z.number().int().min(1).max(50).optional().describe("Maximum rounds to return."),
  status: z.enum(["open", "lit", "closed", "all"]).optional().describe("Filter by round status."),
});

const getRoundAnalysisArgs = z.object({
  roundId: z.string().uuid().describe("The round to analyse."),
});

const lightFacetArgs = z.object({
  roundId: z.string().uuid().describe("The round to light a facet in."),
  memberId: z.string().uuid().describe("Who is contributing. Must already be on the roster."),
  facet: z
    .number()
    .int()
    .min(0)
    .max(FACET_COUNT - 1)
    .describe(`Which beacon facet to light, 0 to ${FACET_COUNT - 1}.`),
  weight: z.number().int().min(1).max(5).optional().describe("Fuel contributed, 1 to 5."),
  note: z.string().max(280).optional().describe("Short optional note."),
  transcript: z
    .string()
    .max(4000)
    .optional()
    .describe("Transcript of a voice memo, if one was produced on-device."),
  transcriptEngine: z.string().max(60).optional().describe("Which model produced the transcript."),
  idempotencyKey,
});

const addPlayerArgs = z.object({
  roundId: z.string().uuid().describe("The round to add a player to."),
  displayName: z.string().trim().min(1).max(60).describe("The player's name."),
  ageBand: z.enum(AGE_BANDS).describe("Age band, used by the fairness factors."),
  idempotencyKey,
});

const deleteRoundArgs = z.object({
  roundId: z.string().uuid().describe("The round to delete."),
  joinCode: z
    .string()
    .trim()
    .describe("The round's join code, required to confirm a destructive operation."),
  idempotencyKey,
});

const verifyIntegrityArgs = z.object({
  roundId: z.string().uuid().describe("The round whose chain should be replayed."),
});

const getRoundReportArgs = z.object({
  roundId: z.string().uuid().describe("The round to report on."),
  format: z.enum(["json", "text"]).optional().describe("Plain text is pasteable into a chat app."),
});

type ToolDefinition = {
  name: string;
  description: string;
  /** JSON Schema for the tool's arguments, emitted verbatim by tools/list. */
  inputSchema: Record<string, unknown>;
  schema: z.ZodType;
  mutating: boolean;
  handler: (args: unknown, scope: string) => Promise<ToolResult>;
};

/**
 * What a tool handler returns: an MCP tool result block. `content` is the
 * textual payload a model reads; `structuredContent` is the same information in
 * a shape a program can consume without parsing prose.
 */
type ToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError: boolean;
};

const textContent = (value: unknown, text?: string) => ({
  content: [{ type: "text" as const, text: text ?? JSON.stringify(value, null, 2) }],
  structuredContent: value as Record<string, unknown>,
  isError: false,
});

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

/**
 * Looks for an earlier audit event carrying the same idempotency key.
 *
 * Stored inside the event payload rather than a separate table, so the replay
 * guard is itself part of the hash chain and cannot be edited without breaking
 * the seal.
 */
async function findIdempotentReplay(
  db: SqlClient,
  roundId: string,
  key: string | undefined,
): Promise<{ found: boolean; payload: Record<string, unknown> }> {
  if (!key) return { found: false, payload: {} };
  const { rows } = await db.query<{ payload: unknown }>(
    `select payload from audit_events
       where round_id = $1 and payload->>'idempotencyKey' = $2
       order by seq asc limit 1`,
    [roundId, key],
  );
  if (rows.length === 0) return { found: false, payload: {} };
  const raw = rows[0].payload;
  if (raw && typeof raw === "object") return { found: true, payload: raw as Record<string, unknown> };
  return { found: false, payload: {} };
}

async function skyFor(
  round: { latitude: number | null; longitude: number | null; scheduledDate: string | null; placeLabel: string },
): Promise<SkyEnvelope | null> {
  if (round.latitude === null || round.longitude === null || !round.scheduledDate) return null;
  const window = dateWindow(round.scheduledDate, 1);
  return fetchSky(round.latitude, round.longitude, round.placeLabel, window.start, window.end);
}

const notOwned = (roundId: string) => ({
  content: [{ type: "text" as const, text: `No round ${roundId} belongs to this session.` }],
  isError: true,
});

/* ------------------------------------------------------------------ */
/* Tools                                                               */
/* ------------------------------------------------------------------ */

const TOOLS: ToolDefinition[] = [
  {
    name: "list_rounds",
    description:
      "List the rounds owned by the calling session, newest first. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 50 },
        status: { type: "string", enum: ["open", "lit", "closed", "all"] },
      },
      additionalProperties: false,
    },
    schema: listRoundsArgs,
    mutating: false,
    handler: async (args, scope) => {
      const parsed = listRoundsArgs.parse(args);
      const db = await getDb();
      const { rounds, total } = await listRounds(db, scope, {
        limit: parsed.limit ?? 20,
        offset: 0,
        status: parsed.status ?? "all",
      });
      return textContent({
        total,
        rounds: rounds.map((r) => ({
          id: r.id,
          title: r.title,
          joinCode: r.joinCode,
          status: r.status,
          scheduledDate: r.scheduledDate,
          placeLabel: r.placeLabel,
          createdAt: r.createdAt,
        })),
      });
    },
  },

  {
    name: "get_round_analysis",
    description:
      "Run the deterministic Beacon Engine over a round and return the versioned, itemized fairness result: Reach, Balance, Glow, Rhythm and Golden hour, with an actionable recommendation and the seal it was computed against.",
    inputSchema: {
      type: "object",
      properties: { roundId: { type: "string", format: "uuid" } },
      required: ["roundId"],
      additionalProperties: false,
    },
    schema: getRoundAnalysisArgs,
    mutating: false,
    handler: async (args, scope) => {
      const { roundId } = getRoundAnalysisArgs.parse(args);
      const db = await getDb();
      const bundle = await getBundle(db, roundId);
      if (!bundle || !(await canContribute(db, roundId, scope))) return notOwned(roundId);

      const sky = await skyFor(bundle.round);
      const result = analyzeRound(bundle, { now: new Date().toISOString(), sky });
      return textContent({
        version: result.version,
        overall: result.overall,
        scores: result.scores,
        factors: result.factors,
        contributions: result.contributions,
        recommendation: result.recommendation,
        seal: result.seal,
        empty: result.empty,
        skyStatus: sky?.status ?? null,
      });
    },
  },

  {
    name: "light_facet",
    description:
      "Mutating tool. Adds an ember to a round: who contributed, which of the 12 beacon facets they lit, and how much fuel. This is the same code path as the in-app Light control, and it moves Reach, Balance and Glow.",
    inputSchema: {
      type: "object",
      properties: {
        roundId: { type: "string", format: "uuid" },
        memberId: { type: "string", format: "uuid" },
        facet: { type: "integer", minimum: 0, maximum: FACET_COUNT - 1 },
        weight: { type: "integer", minimum: 1, maximum: 5 },
        note: { type: "string", maxLength: 280 },
        transcript: { type: "string", maxLength: 4000 },
        transcriptEngine: { type: "string", maxLength: 60 },
        idempotencyKey: { type: "string", minLength: 8, maxLength: 120 },
      },
      required: ["roundId", "memberId", "facet"],
      additionalProperties: false,
    },
    schema: lightFacetArgs,
    mutating: true,
    handler: async (args, scope) => {
      const parsed = lightFacetArgs.parse(args);
      const db = await getDb();
      // A player who scanned the QR may contribute; only the host may edit.
      if (!(await canContribute(db, parsed.roundId, scope))) return notOwned(parsed.roundId);

      const replay = await findIdempotentReplay(db, parsed.roundId, parsed.idempotencyKey);
      if (replay.found) {
        return textContent({
          replayed: true,
          idempotencyKey: parsed.idempotencyKey,
          emberId: replay.payload.emberId,
          note: "This idempotency key was already used, so nothing was written twice.",
        });
      }

      const bundle = await getBundle(db, parsed.roundId);
      if (!bundle) return notOwned(parsed.roundId);
      if (!bundle.members.some((m) => m.id === parsed.memberId)) {
        return {
          content: [{ type: "text" as const, text: "That member is not on this round's roster." }],
          isError: true,
        };
      }

      const ember = await addEmber(db, {
        roundId: parsed.roundId,
        memberId: parsed.memberId,
        kind: parsed.transcript ? "voice" : "spark",
        weight: parsed.weight ?? 3,
        facet: parsed.facet,
        note: parsed.note ?? null,
        transcript: parsed.transcript ?? null,
        transcriptEngine: parsed.transcriptEngine ?? null,
        now: new Date().toISOString(),
      });

      // Record the key on the create event so the replay guard is chained.
      if (parsed.idempotencyKey) {
        const { appendAudit } = await import("@/lib/db/repository");
        await appendAudit(db, {
          roundId: parsed.roundId,
          entityType: "ember",
          entityId: ember.id,
          action: "ember.create",
          payload: { idempotencyKey: parsed.idempotencyKey, emberId: ember.id, acknowledged: true },
          createdAt: new Date().toISOString(),
        });
      }

      const after = await getBundle(db, parsed.roundId);
      const result = after
        ? analyzeRound(after, { now: new Date().toISOString(), sky: await skyFor(after.round) })
        : null;

      return textContent({
        emberId: ember.id,
        facet: ember.facet,
        weight: ember.weight,
        seal: await headSeal(db, parsed.roundId),
        scores: result?.scores ?? null,
        overall: result?.overall ?? null,
        recommendation: result?.recommendation ?? null,
      });
    },
  },

  {
    name: "add_player",
    description:
      "Mutating tool. Adds someone to a round's roster. Knowing a player is on the roster is what makes 'they never played' a computable fact.",
    inputSchema: {
      type: "object",
      properties: {
        roundId: { type: "string", format: "uuid" },
        displayName: { type: "string", minLength: 1, maxLength: 60 },
        ageBand: { type: "string", enum: [...AGE_BANDS] },
        idempotencyKey: { type: "string", minLength: 8, maxLength: 120 },
      },
      required: ["roundId", "displayName", "ageBand"],
      additionalProperties: false,
    },
    schema: addPlayerArgs,
    mutating: true,
    handler: async (args, scope) => {
      const parsed = addPlayerArgs.parse(args);
      const db = await getDb();
      // Host-only: the roster is the basis of the fairness measure, so a player
      // cannot quietly remove themselves from being counted.
      if (!(await isOwner(db, parsed.roundId, scope))) return notOwned(parsed.roundId);

      const replay = await findIdempotentReplay(db, parsed.roundId, parsed.idempotencyKey);
      if (replay.found) {
        return textContent({
          replayed: true,
          memberId: replay.payload.memberId,
          displayName: replay.payload.displayName,
        });
      }

      const member = await addMember(db, {
        roundId: parsed.roundId,
        displayName: parsed.displayName,
        ageBand: parsed.ageBand,
        joinedVia: "link",
        now: new Date().toISOString(),
      });

      if (parsed.idempotencyKey) {
        const { appendAudit } = await import("@/lib/db/repository");
        await appendAudit(db, {
          roundId: parsed.roundId,
          entityType: "member",
          entityId: member.id,
          action: "member.join",
          payload: {
            idempotencyKey: parsed.idempotencyKey,
            memberId: member.id,
            displayName: member.displayName,
          },
          createdAt: new Date().toISOString(),
        });
      }

      return textContent({ member, seal: await headSeal(db, parsed.roundId) });
    },
  },

  {
    name: "get_round_report",
    description:
      "Read-only. Returns the shareable round report: who played, who was left out, the light window, the facet distribution that drives the 3D beacon, and the integrity head.",
    inputSchema: {
      type: "object",
      properties: {
        roundId: { type: "string", format: "uuid" },
        format: { type: "string", enum: ["json", "text"] },
      },
      required: ["roundId"],
      additionalProperties: false,
    },
    schema: getRoundReportArgs,
    mutating: false,
    handler: async (args, scope) => {
      const parsed = getRoundReportArgs.parse(args);
      const db = await getDb();
      if (!(await canContribute(db, parsed.roundId, scope))) return notOwned(parsed.roundId);
      const bundle = await getBundle(db, parsed.roundId);
      if (!bundle) return notOwned(parsed.roundId);

      const sky = await skyFor(bundle.round);
      const generatedAt = new Date().toISOString();
      const result = analyzeRound(bundle, { now: generatedAt, sky });
      const report = buildReport(bundle, result, sky, await listAudit(db, parsed.roundId), generatedAt);

      if (parsed.format === "text") {
        return {
          content: [{ type: "text" as const, text: renderReportText(report) }],
          structuredContent: { headline: report.headline, seal: report.integrity.head },
          isError: false,
        };
      }
      return textContent(report);
    },
  },

  {
    name: "verify_integrity",
    description:
      "Read-only. Replays a round's SHA-384 hash chain and reports the first broken link, so a report can be checked rather than trusted.",
    inputSchema: {
      type: "object",
      properties: { roundId: { type: "string", format: "uuid" } },
      required: ["roundId"],
      additionalProperties: false,
    },
    schema: verifyIntegrityArgs,
    mutating: false,
    handler: async (args, scope) => {
      const { roundId } = verifyIntegrityArgs.parse(args);
      const db = await getDb();
      if (!(await canContribute(db, roundId, scope))) return notOwned(roundId);
      const replay = replayChain(await listAudit(db, roundId));
      return textContent({
        ...replay,
        formula: "seal_n = SHA-384(UTF-8(prevSeal) || canonicalJson(event_n))",
      });
    },
  },

  {
    name: "delete_round",
    description:
      "Mutating tool. Soft-deletes a round, keeping its audit tombstone so the history stays verifiable. Requires the round's join code as confirmation, so a leaked round id is not enough to destroy a round.",
    inputSchema: {
      type: "object",
      properties: {
        roundId: { type: "string", format: "uuid" },
        joinCode: { type: "string" },
        idempotencyKey: { type: "string", minLength: 8, maxLength: 120 },
      },
      required: ["roundId", "joinCode"],
      additionalProperties: false,
    },
    schema: deleteRoundArgs,
    mutating: true,
    handler: async (args, scope) => {
      const parsed = deleteRoundArgs.parse(args);
      const db = await getDb();
      // Host-only, then join-code confirmation: two independent gates.
      if (!(await isOwner(db, parsed.roundId, scope))) return notOwned(parsed.roundId);
      const round = await getRound(db, scope, parsed.roundId);
      if (!round) return notOwned(parsed.roundId);

      if (!isValidJoinCode(parsed.joinCode) || parsed.joinCode !== round.joinCode) {
        return {
          content: [
            { type: "text" as const, text: "Confirmation failed: that is not this round's join code." },
          ],
          isError: true,
        };
      }

      const replay = await findIdempotentReplay(db, parsed.roundId, parsed.idempotencyKey);
      if (replay.found) {
        return textContent({ replayed: true, deletedAt: replay.payload.deletedAt });
      }

      const deleted = await deleteRound(db, scope, parsed.roundId, new Date().toISOString());
      return textContent({
        deleted: deleted !== null,
        deletedAt: deleted?.deletedAt ?? null,
        seal: await headSeal(db, parsed.roundId),
      });
    },
  },
];

const TOOL_MAP = new Map(TOOLS.map((tool) => [tool.name, tool]));

/* ------------------------------------------------------------------ */
/* JSON-RPC dispatch                                                   */
/* ------------------------------------------------------------------ */

type JsonRpcRequest = {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
};

const ERROR_CODES = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
} as const;

function rpcError(id: unknown, code: number, message: string, data?: unknown) {
  return { jsonrpc: "2.0" as const, id: id ?? null, error: { code, message, ...(data ? { data } : {}) } };
}

function rpcResult(id: unknown, result: unknown) {
  return { jsonrpc: "2.0" as const, id: id ?? null, result };
}

/**
 * Handles one parsed JSON-RPC request object and returns the response body.
 * Batch requests are not supported by design: a single, explicit request per call
 * keeps agent behaviour predictable.
 */
export async function dispatchRpc(
  body: unknown,
  scope: string,
): Promise<Record<string, unknown> | null> {
  if (Array.isArray(body)) {
    return rpcError(null, ERROR_CODES.invalidRequest, "Batch requests are not supported.");
  }

  const request = body as JsonRpcRequest;
  const id = request?.id;

  if (typeof request !== "object" || request === null || request.jsonrpc !== "2.0") {
    return rpcError(id, ERROR_CODES.invalidRequest, 'Expected a JSON-RPC 2.0 object with "jsonrpc": "2.0".');
  }
  if (typeof request.method !== "string") {
    return rpcError(id, ERROR_CODES.invalidRequest, 'Expected a string "method".');
  }

  try {
    await ensureSchema();

    switch (request.method) {
      case "initialize":
        return rpcResult(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions:
            "Emberwake models a family game round. Call list_rounds, then get_round_analysis " +
            "for a fairness breakdown, then light_facet to contribute. light_facet and add_player " +
            "accept idempotencyKey so retries are safe.",
        });

      case "notifications/initialized":
        // A notification expects no response body.
        return null;

      case "ping":
        return rpcResult(id, { ok: true, serverInfo: SERVER_INFO });

      case "tools/list":
        return rpcResult(id, {
          tools: TOOLS.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            annotations: { readOnlyHint: !tool.mutating },
          })),
        });

      case "tools/call": {
        const params = (request.params ?? {}) as { name?: unknown; arguments?: unknown };
        if (typeof params.name !== "string") {
          return rpcError(id, ERROR_CODES.invalidParams, 'tools/call requires params.name.');
        }
        const tool = TOOL_MAP.get(params.name);
        if (!tool) {
          return rpcError(
            id,
            ERROR_CODES.methodNotFound,
            `Unknown tool "${params.name}".`,
            { available: [...TOOL_MAP.keys()] },
          );
        }
        // Validate first so a malformed call is a protocol error, not a stack trace.
        const parsed = tool.schema.safeParse(params.arguments ?? {});
        if (!parsed.success) {
          return rpcError(id, ERROR_CODES.invalidParams, `Invalid arguments for ${tool.name}.`, {
            issues: parsed.error.issues.map((issue) => ({
              path: issue.path.join("."),
              message: issue.message,
            })),
          });
        }
        const result = await tool.handler(parsed.data, scope);
        return rpcResult(id, result);
      }

      default:
        return rpcError(id, ERROR_CODES.methodNotFound, `Unknown method "${request.method}".`, {
          available: ["initialize", "tools/list", "tools/call", "ping"],
        });
    }
  } catch {
    // Deliberately does not echo the underlying error: it may contain a
    // connection string or a SQL fragment.
    return rpcError(id, ERROR_CODES.internal, "The server failed while handling that call.");
  }
}

export { TOOLS as MCP_TOOLS };