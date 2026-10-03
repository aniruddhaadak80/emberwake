/**
 * Domain repository.
 *
 * Every read and write the product performs goes through this module, which is
 * what makes three guarantees cheap:
 *
 *  1. Ownership. Reads are filtered by `owner_scope`, so one anonymous session
 *     can never see or mutate another's round. The only unscoped read is by
 *     `join_code`, which is the deliberate "scan the QR and join" path.
 *  2. Auditability. Nothing changes without an appended audit event, and the
 *     seal is computed by the same `computeSeal` the verifier re-uses.
 *  3. Portability. Only plain SQL, no extensions, no stored procedures, so the
 *     identical statements run on Neon and on embedded PGlite.
 */

import { randomInt, randomUUID } from "node:crypto";
import type { SqlClient } from "@/lib/db/types";
import { toIso, toIsoOrNull, toNumberOrNull } from "@/lib/db/types";
import { DEMO_SCOPE } from "@/lib/db/schema";
import { GENESIS, computeSeal } from "@/lib/integrity/seal";
import type {
  AgeBand,
  AuditAction,
  AuditEvent,
  Ember,
  EmberKind,
  Member,
  MemberContribution,
  Round,
  RoundBundle,
  RoundStatus,
} from "@/lib/types";

/* ------------------------------------------------------------------ */
/* Row mappers                                                         */
/* ------------------------------------------------------------------ */

type Row = Record<string, unknown>;

function mapRound(r: Row): Round {
  return {
    id: String(r.id),
    joinCode: String(r.join_code),
    title: String(r.title),
    placeLabel: String(r.place_label ?? ""),
    latitude: toNumberOrNull(r.latitude),
    longitude: toNumberOrNull(r.longitude),
    scheduledDate: r.scheduled_date === null || r.scheduled_date === undefined
      ? null
      : String(r.scheduled_date).slice(0, 10),
    status: String(r.status) as RoundStatus,
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
    deletedAt: toIsoOrNull(r.deleted_at),
  };
}

function mapMember(r: Row): Member {
  return {
    id: String(r.id),
    roundId: String(r.round_id),
    displayName: String(r.display_name),
    ageBand: String(r.age_band) as AgeBand,
    joinedVia: String(r.joined_via) as Member["joinedVia"],
    createdAt: toIso(r.created_at),
  };
}

function mapEmber(r: Row): Ember {
  return {
    id: String(r.id),
    roundId: String(r.round_id),
    memberId: String(r.member_id),
    kind: String(r.kind) as EmberKind,
    weight: Number(r.weight),
    facet: Number(r.facet),
    transcript: r.transcript === null || r.transcript === undefined ? null : String(r.transcript),
    transcriptEngine:
      r.transcript_engine === null || r.transcript_engine === undefined
        ? null
        : String(r.transcript_engine),
    note: r.note === null || r.note === undefined ? null : String(r.note),
    createdAt: toIso(r.created_at),
    deletedAt: toIsoOrNull(r.deleted_at),
  };
}

function mapAudit(r: Row): AuditEvent {
  let payload: Record<string, unknown> = {};
  const raw = r.payload;
  if (typeof raw === "string") {
    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      payload = {};
    }
  } else if (raw && typeof raw === "object") {
    payload = raw as Record<string, unknown>;
  }
  return {
    seq: Number(r.seq),
    roundId: String(r.round_id),
    entityType: String(r.entity_type) as AuditEvent["entityType"],
    entityId: String(r.entity_id),
    action: String(r.action) as AuditAction,
    payload,
    prevSeal: String(r.prev_seal),
    seal: String(r.seal),
    createdAt: toIso(r.created_at),
  };
}

/* ------------------------------------------------------------------ */
/* Join codes                                                          */
/* ------------------------------------------------------------------ */

/** Ambiguity-free alphabet: no 0/O, 1/I/L, 2/Z, 5/S, 8/B. */
const CODE_ALPHABET = "34679ACDEFGHJKMNPQRTUVWXY";

/** Human-typable and, more importantly, readable off a printed QR card. */
export function makeJoinCode(length = 6): string {
  let out = "";
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

export function isValidJoinCode(code: string): boolean {
  if (!/^[0-9A-Z]{4,8}$/.test(code)) return false;
  return [...code].every((ch) => CODE_ALPHABET.includes(ch));
}

/**
 * True when a path segment is a real UUID.
 *
 * Necessary because `rounds.id` is a `uuid` column: handing Postgres a join code
 * where it expects a UUID raises `22P02 invalid input syntax`, which surfaces as
 * an opaque 500. Checking first lets the route answer 404 (or fall through to the
 * join-code path) instead of exploding.
 */
export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/* ------------------------------------------------------------------ */
/* Audit chain                                                         */
/* ------------------------------------------------------------------ */

/**
 * Appends one event to a round's hash chain.
 *
 * Reads the current head, computes the seal in JS using the documented formula,
 * then inserts with an explicit `seq`. `(round_id, seq)` is a primary key and the
 * insert uses `on conflict do nothing`, so two writers racing for the same
 * sequence cannot fork the chain: exactly one wins and the loser retries. This
 * avoids needing an interactive transaction, which Neon's HTTP driver does not
 * support across round-trips.
 */
export async function appendAudit(
  db: SqlClient,
  input: {
    roundId: string;
    entityType: AuditEvent["entityType"];
    entityId: string;
    action: AuditAction;
    payload: Record<string, unknown>;
    /** Injected so appends stay deterministic in tests. */
    createdAt: string;
  },
): Promise<AuditEvent> {
  const attempts = 5;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const head = await db.query<Row>(
      `select seq, seal from audit_events where round_id = $1 order by seq desc limit 1`,
      [input.roundId],
    );
    const previous = head.rows[0];
    const seq = previous ? Number(previous.seq) + 1 : 1;
    const prevSeal = previous ? String(previous.seal) : GENESIS;

    const sealable = {
      seq,
      roundId: input.roundId,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      payload: input.payload,
      createdAt: input.createdAt,
    };
    const seal = computeSeal(prevSeal, sealable);

    const inserted = await db.query<Row>(
      `insert into audit_events
         (round_id, seq, entity_type, entity_id, action, payload, prev_seal, seal, created_at)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
       on conflict (round_id, seq) do nothing
       returning seq, seal, prev_seal, created_at`,
      [
        input.roundId,
        seq,
        input.entityType,
        input.entityId,
        input.action,
        JSON.stringify(input.payload),
        prevSeal,
        seal,
        input.createdAt,
      ],
    );

    if (inserted.rows.length > 0) {
      return {
        seq,
        roundId: input.roundId,
        entityType: input.entityType,
        entityId: input.entityId,
        action: input.action,
        payload: input.payload,
        prevSeal,
        seal,
        createdAt: input.createdAt,
      };
    }
    // Lost the race for this sequence number: re-read the head and try again.
  }

  throw new Error("Could not append an audit event after repeated conflicts.");
}

export async function listAudit(db: SqlClient, roundId: string): Promise<AuditEvent[]> {
  const { rows } = await db.query<Row>(
    `select * from audit_events where round_id = $1 order by seq asc`,
    [roundId],
  );
  return rows.map(mapAudit);
}

/** Current chain head, or the genesis value when a round has no events yet. */
export async function headSeal(db: SqlClient, roundId: string): Promise<string> {
  const { rows } = await db.query<Row>(
    `select seal from audit_events where round_id = $1 order by seq desc limit 1`,
    [roundId],
  );
  return rows[0] ? String(rows[0].seal) : GENESIS;
}

/* ------------------------------------------------------------------ */
/* Rounds                                                              */
/* ------------------------------------------------------------------ */

export type CreateRoundInput = {
  ownerScope: string;
  title: string;
  placeLabel: string;
  latitude: number | null;
  longitude: number | null;
  scheduledDate: string | null;
  now: string;
};

export async function createRound(db: SqlClient, input: CreateRoundInput): Promise<Round> {
  const id = randomUUID();
  // Retry on the rare join-code collision rather than failing the request.
  for (let attempt = 0; attempt < 6; attempt++) {
    const joinCode = makeJoinCode();
    const { rows } = await db.query<Row>(
      `insert into rounds
         (id, join_code, owner_scope, title, place_label, latitude, longitude,
          scheduled_date, status, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 'open', $9, $9)
       on conflict (join_code) do nothing
       returning *`,
      [
        id,
        joinCode,
        input.ownerScope,
        input.title,
        input.placeLabel,
        input.latitude,
        input.longitude,
        input.scheduledDate,
        input.now,
      ],
    );
    if (rows.length > 0) {
      const round = mapRound(rows[0]);
      await appendAudit(db, {
        roundId: round.id,
        entityType: "round",
        entityId: round.id,
        action: "round.create",
        payload: { title: round.title, joinCode: round.joinCode, status: round.status },
        createdAt: input.now,
      });
      return round;
    }
  }
  throw new Error("Could not allocate a unique join code.");
}

const ROUND_COLUMNS = `id, join_code, owner_scope, title, place_label, latitude, longitude,
  scheduled_date, status, created_at, updated_at, deleted_at`;

export async function listRounds(
  db: SqlClient,
  ownerScope: string,
  opts: { limit: number; offset: number; status?: RoundStatus | "all" },
): Promise<{ rounds: Round[]; total: number }> {
  const statusFilter = opts.status && opts.status !== "all" ? opts.status : null;

  const countResult = await db.query<Row>(
    `select count(*)::int as n from rounds
       where owner_scope = $1 and deleted_at is null
         and ($2::text is null or status = $2)`,
    [ownerScope, statusFilter],
  );
  const total = Number(countResult.rows[0]?.n ?? 0);

  const { rows } = await db.query<Row>(
    `select ${ROUND_COLUMNS} from rounds
       where owner_scope = $1 and deleted_at is null
         and ($2::text is null or status = $2)
       order by created_at desc
       limit $3 offset $4`,
    [ownerScope, statusFilter, opts.limit, opts.offset],
  );

  return { rounds: rows.map(mapRound), total };
}

/** Scoped read. Returns null for another session's round, which surfaces as 404. */
export async function getRound(
  db: SqlClient,
  ownerScope: string,
  id: string,
): Promise<Round | null> {
  const { rows } = await db.query<Row>(
    `select ${ROUND_COLUMNS} from rounds
       where id = $1 and owner_scope = $2 and deleted_at is null`,
    [id, ownerScope],
  );
  return rows[0] ? mapRound(rows[0]) : null;
}

/**
 * Unscoped lookup by join code. This is the QR join path: holding the code is
 * the capability, which is exactly why it returns a minimal record rather than
 * the full bundle. New members still join under their own anonymous scope.
 */
export async function getRoundByJoinCode(
  db: SqlClient,
  joinCode: string,
): Promise<Round | null> {
  const { rows } = await db.query<Row>(
    `select ${ROUND_COLUMNS} from rounds
       where join_code = $1 and deleted_at is null
       and owner_scope <> $2`,
    [joinCode, DEMO_SCOPE],
  );
  return rows[0] ? mapRound(rows[0]) : null;
}

export type UpdateRoundInput = {
  title?: string;
  placeLabel?: string;
  latitude?: number | null;
  longitude?: number | null;
  scheduledDate?: string | null;
  status?: RoundStatus;
  now: string;
};

const UPDATABLE: Record<string, string> = {
  title: "title",
  placeLabel: "place_label",
  latitude: "latitude",
  longitude: "longitude",
  scheduledDate: "scheduled_date",
  status: "status",
};

export async function updateRound(
  db: SqlClient,
  ownerScope: string,
  id: string,
  patch: UpdateRoundInput,
): Promise<Round | null> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  for (const [key, column] of Object.entries(UPDATABLE)) {
    if (!(key in patch)) continue;
    const value = (patch as Record<string, unknown>)[key];
    params.push(value);
    sets.push(`${column} = $${i}`);
    i++;
  }

  if (sets.length === 0) return getRound(db, ownerScope, id);

  sets.push(`updated_at = $${i}`);
  params.push(patch.now);
  i++;

  params.push(id, ownerScope);

  const { rows } = await db.query<Row>(
    `update rounds set ${sets.join(", ")}
       where id = $${i} and owner_scope = $${i + 1} and deleted_at is null
       returning ${ROUND_COLUMNS}`,
    params,
  );

  if (rows.length === 0) return null;

  const round = mapRound(rows[0]);
  const changed: Record<string, unknown> = {};
  for (const key of Object.keys(UPDATABLE)) {
    if (key in patch) changed[key] = (patch as Record<string, unknown>)[key];
  }
  await appendAudit(db, {
    roundId: round.id,
    entityType: "round",
    entityId: round.id,
    action: "status" in changed ? "round.status" : "round.update",
    payload: changed,
    createdAt: patch.now,
  });
  return round;
}

/**
 * Soft delete. The row stays with `deleted_at` set so the audit chain and its
 * tombstones stay replayable, and `listRounds` filters it out of every view.
 */
export async function deleteRound(
  db: SqlClient,
  ownerScope: string,
  id: string,
  now: string,
): Promise<Round | null> {
  const { rows } = await db.query<Row>(
    `update rounds set deleted_at = $1, updated_at = $1, status = 'closed'
       where id = $2 and owner_scope = $3 and deleted_at is null
       returning ${ROUND_COLUMNS}`,
    [now, id, ownerScope],
  );
  if (rows.length === 0) return null;

  const round = mapRound(rows[0]);
  await appendAudit(db, {
    roundId: round.id,
    entityType: "round",
    entityId: round.id,
    action: "round.delete",
    payload: { deletedAt: now, joinCode: round.joinCode },
    createdAt: now,
  });
  return round;
}

/* ------------------------------------------------------------------ */
/* Members                                                             */
/* ------------------------------------------------------------------ */

export async function listMembers(db: SqlClient, roundId: string): Promise<Member[]> {
  const { rows } = await db.query<Row>(
    `select * from members where round_id = $1 order by created_at asc`,
    [roundId],
  );
  return rows.map(mapMember);
}

export async function addMember(
  db: SqlClient,
  input: {
    roundId: string;
    displayName: string;
    ageBand: AgeBand;
    joinedVia: Member["joinedVia"];
    now: string;
  },
): Promise<Member> {
  const id = randomUUID();
  const { rows } = await db.query<Row>(
    `insert into members (id, round_id, display_name, age_band, joined_via, created_at)
     values ($1, $2, $3, $4, $5, $6)
     returning *`,
    [id, input.roundId, input.displayName, input.ageBand, input.joinedVia, input.now],
  );
  const member = mapMember(rows[0]);
  await appendAudit(db, {
    roundId: input.roundId,
    entityType: "member",
    entityId: member.id,
    action: "member.join",
    payload: { displayName: member.displayName, ageBand: member.ageBand, joinedVia: member.joinedVia },
    createdAt: input.now,
  });
  return member;
}

export async function removeMember(
  db: SqlClient,
  roundId: string,
  memberId: string,
  now: string,
): Promise<boolean> {
  const { rows } = await db.query<Row>(
    `delete from members where id = $1 and round_id = $2 returning id`,
    [memberId, roundId],
  );
  if (rows.length === 0) return false;
  await appendAudit(db, {
    roundId,
    entityType: "member",
    entityId: memberId,
    action: "member.remove",
    payload: {},
    createdAt: now,
  });
  return true;
}

/* ------------------------------------------------------------------ */
/* Embers                                                              */
/* ------------------------------------------------------------------ */

export async function listEmbers(db: SqlClient, roundId: string): Promise<Ember[]> {
  const { rows } = await db.query<Row>(
    `select * from embers
       where round_id = $1 and deleted_at is null
       order by created_at asc`,
    [roundId],
  );
  return rows.map(mapEmber);
}

export async function addEmber(
  db: SqlClient,
  input: {
    roundId: string;
    memberId: string;
    kind: EmberKind;
    weight: number;
    facet: number;
    transcript?: string | null;
    transcriptEngine?: string | null;
    note?: string | null;
    now: string;
  },
): Promise<Ember> {
  const id = randomUUID();
  const { rows } = await db.query<Row>(
    `insert into embers
       (id, round_id, member_id, kind, weight, facet, transcript, transcript_engine, note, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     returning *`,
    [
      id,
      input.roundId,
      input.memberId,
      input.kind,
      input.weight,
      input.facet,
      input.transcript ?? null,
      input.transcriptEngine ?? null,
      input.note ?? null,
      input.now,
    ],
  );
  const ember = mapEmber(rows[0]);
  await appendAudit(db, {
    roundId: input.roundId,
    entityType: "ember",
    entityId: ember.id,
    action: "ember.create",
    payload: {
      memberId: ember.memberId,
      kind: ember.kind,
      weight: ember.weight,
      facet: ember.facet,
      transcriptEngine: ember.transcriptEngine,
      hasTranscript: ember.transcript !== null,
    },
    createdAt: input.now,
  });
  return ember;
}

/** Soft delete so the ember's creation event remains part of a replayable chain. */
export async function deleteEmber(
  db: SqlClient,
  roundId: string,
  emberId: string,
  now: string,
): Promise<boolean> {
  const { rows } = await db.query<Row>(
    `update embers set deleted_at = $1
       where id = $2 and round_id = $3 and deleted_at is null
       returning id, member_id, facet, weight`,
    [now, emberId, roundId],
  );
  if (rows.length === 0) return false;
  const row = rows[0];
  await appendAudit(db, {
    roundId,
    entityType: "ember",
    entityId: emberId,
    action: "ember.delete",
    payload: {
      memberId: String(row.member_id),
      facet: Number(row.facet),
      weight: Number(row.weight),
    },
    createdAt: now,
  });
  return true;
}

/* ------------------------------------------------------------------ */
/* Bundles                                                             */
/* ------------------------------------------------------------------ */

/** Round + roster + embers + current seal. This is what the engine consumes. */
export async function getBundle(db: SqlClient, roundId: string): Promise<RoundBundle | null> {
  const { rows } = await db.query<Row>(
    `select ${ROUND_COLUMNS} from rounds where id = $1 and deleted_at is null`,
    [roundId],
  );
  if (rows.length === 0) return null;

  const [members, embers, seal] = await Promise.all([
    listMembers(db, roundId),
    listEmbers(db, roundId),
    headSeal(db, roundId),
  ]);

  return { round: mapRound(rows[0]), members, embers, seal };
}

/** Read-only bundle for the labelled public demo round. Never owned by a user. */
export async function getDemoBundle(db: SqlClient): Promise<RoundBundle | null> {
  const { rows } = await db.query<Row>(
    `select ${ROUND_COLUMNS} from rounds
       where owner_scope = $1 and deleted_at is null
       order by created_at asc limit 1`,
    [DEMO_SCOPE],
  );
  if (rows.length === 0) return null;
  return getBundle(db, String(rows[0].id));
}

/** Round id for the seeded demo, used by seeder idempotency checks. */
export async function findDemoRoundId(db: SqlClient): Promise<string | null> {
  const { rows } = await db.query<Row>(
    `select id from rounds where owner_scope = $1 limit 1`,
    [DEMO_SCOPE],
  );
  return rows[0] ? String(rows[0].id) : null;
}

export type { MemberContribution };