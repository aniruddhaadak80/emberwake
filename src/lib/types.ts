/**
 * Domain types shared by the UI, the REST API, the agent tools and the engine.
 *
 * Rule enforced throughout this file: external data is always normalized into a
 * `*Envelope` that says where it came from and whether it is live, so no screen
 * can ever present sealed fallback data as if it were current.
 */

/* ------------------------------------------------------------------ */
/* Ownership                                                           */
/* ------------------------------------------------------------------ */

/**
 * Anonymous ownership scope. No accounts in this product; a visitor gets an
 * unguessable scope minted as an HTTP-only cookie, and every query is filtered
 * by it so one anonymous session can never read another's records.
 */
export type OwnerScope = string;

/* ------------------------------------------------------------------ */
/* Core entities                                                       */
/* ------------------------------------------------------------------ */

export const AGE_BANDS = ["child", "teen", "adult", "elder"] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

export const EMBER_KINDS = ["spark", "voice", "note"] as const;
export type EmberKind = (typeof EMBER_KINDS)[number];

export const ROUND_STATUSES = ["open", "lit", "closed"] as const;
export type RoundStatus = (typeof ROUND_STATUSES)[number];

/** A person on the roster. Knowing they exist is what makes "left out" a fact. */
export type Member = {
  id: string;
  roundId: string;
  displayName: string;
  ageBand: AgeBand;
  /** How they arrived. Drives the QR job-to-be-done evidence. */
  joinedVia: "qr" | "link" | "host";
  createdAt: string;
};

/**
 * One contribution to the beacon.
 *
 * `facet` is the signature field: it is which of the beacon's 12 facets this
 * ember lit, and it is a real persisted mutation. The 3D scene renders beacon
 * geometry directly from the per-facet totals, so an unfair distribution is
 * visible as gapped, dim geometry rather than hidden in a number.
 */
export type Ember = {
  id: string;
  roundId: string;
  memberId: string;
  kind: EmberKind;
  /** Fuel contributed, 1..5. */
  weight: number;
  /** Beacon facet index, 0..11. */
  facet: number;
  /** Voice memo transcript, when the ember came from an on-device model. */
  transcript: string | null;
  /** Which model produced `transcript`, or "typed" when a human wrote it. */
  transcriptEngine: string | null;
  note: string | null;
  createdAt: string;
  deletedAt: string | null;
};

export type Round = {
  id: string;
  /** Short human-typable code that the QR encodes. */
  joinCode: string;
  title: string;
  placeLabel: string;
  latitude: number | null;
  longitude: number | null;
  /** Local calendar day the round is planned for, `YYYY-MM-DD`. */
  scheduledDate: string | null;
  status: RoundStatus;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

/** A round plus its roster and embers, which is what the engine consumes. */
export type RoundBundle = {
  round: Round;
  members: Member[];
  embers: Ember[];
  seal: string;
};

/* ------------------------------------------------------------------ */
/* Deterministic engine                                                */
/* ------------------------------------------------------------------ */

export const ENGINE_VERSION = "beacon-engine-v2026.10.1" as const;

export type EngineFactorId =
  | "reach"
  | "balance"
  | "glow"
  | "rhythm"
  | "goldenHour";

export type EngineFactor = {
  id: EngineFactorId;
  label: string;
  /** Share of the overall score this factor can move, 0..1. */
  weight: number;
  /** 0..100 after weighting. */
  score: number;
  /** Human-readable evidence the host can act on. */
  detail: string;
  /** Concrete numbers behind the score, surfaced in the UI and the agent. */
  evidence: string[];
};

export type EngineRecommendation = {
  /** Short verdict, e.g. "Three people were left out". */
  headline: string;
  detail: string;
  /** Ordered, specific next actions. Never empty unless the round is perfect. */
  actions: string[];
};

export type EngineResult = {
  version: typeof ENGINE_VERSION;
  scores: Record<EngineFactorId, number>;
  overall: number;
  factors: EngineFactor[];
  recommendation: EngineRecommendation;
  /**
   * Per-member participation. Computed inside the engine so the HUD, the
   * report, the REST endpoint and the agent tool can never disagree.
   */
  contributions: MemberContribution[];
  /** Current chain head for the round, so a score can be tied to history. */
  seal: string;
  /** True when there were no members at all, so the UI can show a real empty state. */
  empty: boolean;
};

/* ------------------------------------------------------------------ */
/* Integrity                                                           */
/* ------------------------------------------------------------------ */

export const AUDIT_ACTIONS = [
  "round.create",
  "round.update",
  "round.status",
  "round.delete",
  "member.join",
  "member.remove",
  "ember.create",
  "ember.delete",
  "round.analyze",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type AuditEvent = {
  seq: number;
  roundId: string;
  entityType: "round" | "member" | "ember";
  entityId: string;
  action: AuditAction;
  payload: Record<string, unknown>;
  prevSeal: string;
  seal: string;
  createdAt: string;
};

export type ReplayResult = {
  ok: boolean;
  /** Genesis value the chain starts from. */
  genesis: string;
  events: number;
  head: string | null;
  /** First broken link, or null when the chain is intact. */
  brokenAt: { seq: number; expected: string; actual: string } | null;
  /** Tombstones retained so a deleted round stays replayable. */
  tombstones: number;
};

/* ------------------------------------------------------------------ */
/* Live external data                                                  */
/* ------------------------------------------------------------------ */

export type SourceStatus = "live" | "fallback";

export type SkyDay = {
  /** Local calendar date at the requested place, `YYYY-MM-DD`. */
  date: string;
  /** Local ISO-ish timestamp from the provider, e.g. `2026-10-02T05:28`. */
  sunrise: string;
  sunset: string;
  /** Minutes between sunrise and sunset, precomputed and normalized. */
  daylightMinutes: number;
};

/**
 * Normalized sunrise/sunset envelope. `status` is authoritative: a `"fallback"`
 * payload must always be rendered with a visible offline label.
 */
export type SkyEnvelope = {
  status: SourceStatus;
  placeLabel: string;
  latitude: number;
  longitude: number;
  timezone: string;
  days: SkyDay[];
  /** When this payload was produced, ISO. */
  fetchedAt: string;
  /** Which provider answered, and its attribution string. */
  source: {
    name: string;
    url: string;
    attribution: string;
  };
  /** Present only on fallback, explaining why. */
  note?: string;
};

/* ------------------------------------------------------------------ */
/* API envelopes                                                       */
/* ------------------------------------------------------------------ */

export type ApiError = {
  error: {
    code: string;
    message: string;
    /** Field-level detail for 422 responses. */
    fields?: Record<string, string>;
  };
};

export type HealthReport = {
  status: "ok" | "degraded";
  /** Which adapter answered, so a production build can never look local. */
  store: {
    adapter: "neon-postgres" | "pglite-embedded" | "unconfigured";
    /** True when a real query round-tripped. */
    reachable: boolean;
    detail: string;
  };
  engine: { version: typeof ENGINE_VERSION };
  checkedAt: string;
};

/** Per-member participation, computed by the engine and reused by the report. */
export type MemberContribution = {
  memberId: string;
  displayName: string;
  ageBand: AgeBand;
  embers: number;
  fuel: number;
  share: number;
  /** 0..1. A member on the roster with no embers scores 0. */
  participation: number;
};