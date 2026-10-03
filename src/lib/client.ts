/**
 * Typed browser API client.
 *
 * Every mutation surfaces the server's error envelope verbatim, so a UI can
 * show a real message ("that member is not on this roster") instead of a
 * generic failure. Never swallows an error into a fake success.
 */

import type {
  ApiError,
  Ember,
  Member,
  Round,
  SkyEnvelope,
} from "@/lib/types";
import type { ReportPayload } from "@/lib/report";
import type { EngineResult } from "@/lib/types";

export class ClientError extends Error {
  readonly code: string;
  readonly fields: Record<string, string>;
  readonly status: number;

  constructor(status: number, payload: ApiError | null, fallback: string) {
    super(payload?.error?.message ?? fallback);
    this.name = "ClientError";
    this.status = status;
    this.code = payload?.error?.code ?? "unknown";
    this.fields = payload?.error?.fields ?? {};
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch {
    // A network failure is still a failure, and must not read as an empty result.
    throw new ClientError(0, null, "Could not reach the server. Check your connection.");
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let parsed: unknown = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) {
    const envelope =
      parsed && typeof parsed === "object" && "error" in parsed ? (parsed as ApiError) : null;
    throw new ClientError(response.status, envelope, `Request failed (${response.status}).`);
  }

  return parsed as T;
}

/* ------------------------------------------------------------------ */
/* Rounds                                                              */
/* ------------------------------------------------------------------ */

export async function listRounds(params?: { status?: string; limit?: number }): Promise<{
  rounds: Round[];
  total: number;
  limit: number;
  offset: number;
}> {
  const search = new URLSearchParams();
  if (params?.status && params.status !== "all") search.set("status", params.status);
  if (params?.limit) search.set("limit", String(params.limit));
  const query = search.toString();
  return request(`/api/rounds${query ? `?${query}` : ""}`);
}

export async function createRound(input: {
  title: string;
  placeLabel: string;
  latitude: number | null;
  longitude: number | null;
  scheduledDate: string | null;
}): Promise<{ round: Round; seal: string }> {
  return request("/api/rounds", { method: "POST", body: JSON.stringify(input) });
}

export async function getRoundBundle(id: string): Promise<{ bundle: BundleShape; owned: boolean }> {
  return request(`/api/rounds/${id}`);
}

export type BundleShape = {
  round: Round;
  members: Member[];
  embers: Ember[];
  seal: string;
};

export async function updateRound(
  id: string,
  patch: Partial<{
    title: string;
    placeLabel: string;
    latitude: number | null;
    longitude: number | null;
    scheduledDate: string | null;
    status: Round["status"];
  }>,
): Promise<{ round: Round; seal: string }> {
  return request(`/api/rounds/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

/**
 * Deletes a round. The join code is the destructive-operation confirmation,
 * so it is sent as a header rather than in the body.
 */
export async function deleteRound(id: string, joinCode: string): Promise<{ deleted: boolean; seal: string }> {
  return request(`/api/rounds/${id}`, {
    method: "DELETE",
    headers: { "x-emberwake-confirm": joinCode },
  });
}

/* ------------------------------------------------------------------ */
/* Members and embers                                                  */
/* ------------------------------------------------------------------ */

export async function addMember(
  roundRef: string,
  input: { displayName: string; ageBand: Member["ageBand"]; joinedVia?: Member["joinedVia"] },
): Promise<{ member: Member; roundId: string; seal: string }> {
  return request(`/api/rounds/${roundRef}/members`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function removeMember(roundId: string, memberId: string): Promise<{ removed: boolean }> {
  return request(`/api/rounds/${roundId}/members?memberId=${encodeURIComponent(memberId)}`, {
    method: "DELETE",
  });
}

export async function addEmber(
  roundId: string,
  input: {
    memberId: string;
    kind: Ember["kind"];
    weight: number;
    facet: number;
    transcript?: string | null;
    transcriptEngine?: string | null;
    note?: string | null;
  },
): Promise<{ ember: Ember; seal: string }> {
  return request(`/api/rounds/${roundId}/embers`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function deleteEmber(roundId: string, emberId: string): Promise<{ deleted: boolean }> {
  return request(`/api/rounds/${roundId}/embers/${emberId}`, { method: "DELETE" });
}

/* ------------------------------------------------------------------ */
/* Analysis, report, integrity                                        */
/* ------------------------------------------------------------------ */

export async function analyzeRound(
  roundId: string,
  options?: { record?: boolean },
): Promise<{ result: EngineResult; sky: SkyEnvelope | null; seal: string }> {
  const query = options?.record ? "?record=true" : "";
  return request(`/api/rounds/${roundId}/analyze${query}`, { method: "POST" });
}

export async function getReport(roundId: string): Promise<{ report: ReportPayload }> {
  return request(`/api/rounds/${roundId}/report`);
}

export async function verifyRound(roundId: string): Promise<{
  replay: {
    ok: boolean;
    genesis: string;
    events: number;
    head: string | null;
    brokenAt: { seq: number; expected: string; actual: string } | null;
    tombstones: number;
  };
  headShort: string | null;
  formula: string;
  recent: {
    seq: number;
    action: string;
    seal: string;
    prevSeal: string;
    createdAt: string;
    payload: Record<string, unknown>;
  }[];
}> {
  return request(`/api/rounds/${roundId}/verify`);
}

/* ------------------------------------------------------------------ */
/* Sky and demo                                                        */
/* ------------------------------------------------------------------ */

export async function fetchSky(params: {
  lat: number;
  lng: number;
  place: string;
  date: string;
  days?: number;
}): Promise<SkyEnvelope> {
  const search = new URLSearchParams({
    lat: String(params.lat),
    lng: String(params.lng),
    place: params.place,
    date: params.date,
    days: String(params.days ?? 1),
  });
  return request(`/api/sky?${search.toString()}`);
}

export async function geocodePlace(query: string): Promise<{
  place: { label: string; latitude: number; longitude: number; timezone: string };
  sky: null;
}> {
  return request(`/api/sky?q=${encodeURIComponent(query)}`);
}

export async function getJoinInfo(code: string): Promise<{
  round: {
    id: string;
    title: string;
    placeLabel: string;
    scheduledDate: string | null;
    status: Round["status"];
    joinCode: string;
    createdAt: string;
  };
  alreadyPlaying: { displayName: string; ageBand: Member["ageBand"] }[];
}> {
  return request(`/api/join/${encodeURIComponent(code)}`);
}

export async function getDemo(): Promise<{
  demo: true;
  available: boolean;
  message?: string;
  round?: Round;
  members?: Member[];
  embers?: Ember[];
  result?: EngineResult;
  report?: ReportPayload;
  sky?: SkyEnvelope | null;
}> {
  return request("/api/demo");
}

/* ------------------------------------------------------------------ */
/* MCP                                                                 */
/* ------------------------------------------------------------------ */

export type RpcResponse = {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: {
    content?: { type: string; text: string }[];
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
    protocolVersion?: string;
    serverInfo?: { name: string; version: string };
    tools?: { name: string; description: string; inputSchema: Record<string, unknown> }[];
  };
  error?: { code: number; message: string; data?: unknown };
};

export async function callRpc(method: string, params: Record<string, unknown>): Promise<RpcResponse> {
  return request<RpcResponse>("/api/mcp", {
    method: "POST",
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
}