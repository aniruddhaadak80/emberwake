/**
 * Schema and first-run migration.
 *
 * Written in plain Postgres DDL that runs identically on Neon and PGlite, so
 * there is exactly one schema definition in the repository and no chance of the
 * local database drifting away from production.
 *
 * Every statement is idempotent (`if not exists`), so `migrate` is safe to run
 * on every cold start and on every concurrent serverless invocation.
 */

import type { SqlClient } from "@/lib/db/types";

/** Owner scope used only by the clearly-labelled public demo round. */
export const DEMO_SCOPE = "demo-public";

const STATEMENTS: readonly string[] = [
  `create table if not exists rounds (
     id             uuid primary key,
     join_code      text not null unique,
     owner_scope    text not null,
     title          text not null,
     place_label    text not null default '',
     latitude       double precision,
     longitude      double precision,
     scheduled_date date,
     status         text not null default 'open',
     created_at     timestamptz not null default now(),
     updated_at     timestamptz not null default now(),
     deleted_at     timestamptz,
     constraint rounds_status_check check (status in ('open','lit','closed')),
     constraint rounds_lat_check check (latitude is null or (latitude between -90 and 90)),
     constraint rounds_lng_check check (longitude is null or (longitude between -180 and 180))
   )`,

  `create index if not exists rounds_owner_idx
     on rounds (owner_scope) where deleted_at is null`,
  `create index if not exists rounds_join_code_idx on rounds (join_code)`,

  `create table if not exists members (
     id           uuid primary key,
     round_id     uuid not null references rounds(id) on delete cascade,
     display_name text not null,
     age_band     text not null,
     joined_via   text not null default 'link',
     created_at   timestamptz not null default now(),
     constraint members_age_band_check check (age_band in ('child','teen','adult','elder')),
     constraint members_joined_via_check check (joined_via in ('qr','link','host')),
     constraint members_name_length_check check (char_length(display_name) between 1 and 60)
   )`,

  `create index if not exists members_round_idx on members (round_id)`,

  `create table if not exists embers (
     id               uuid primary key,
     round_id         uuid not null references rounds(id) on delete cascade,
     member_id        uuid not null references members(id) on delete cascade,
     kind             text not null default 'spark',
     weight           int not null default 3,
     facet            int not null,
     transcript       text,
     transcript_engine text,
     note             text,
     created_at       timestamptz not null default now(),
     deleted_at       timestamptz,
     constraint embers_kind_check check (kind in ('spark','voice','note')),
     constraint embers_weight_check check (weight between 1 and 5),
     constraint embers_facet_check check (facet between 0 and 11),
     constraint embers_transcript_length_check check (transcript is null or char_length(transcript) <= 4000),
     constraint embers_note_length_check check (note is null or char_length(note) <= 280)
   )`,

  `create index if not exists embers_round_live_idx
     on embers (round_id) where deleted_at is null`,
  `create index if not exists embers_member_idx on embers (member_id)`,

  /*
    The append-only ledger. `(round_id, seq)` is the primary key, which is what
    makes a concurrent append fail loudly instead of silently forking the chain.
  */
  `create table if not exists audit_events (
     round_id    uuid not null,
     seq         int not null,
     entity_type text not null,
     entity_id   uuid not null,
     action      text not null,
     payload     jsonb not null default '{}'::jsonb,
     prev_seal   text not null,
     seal        text not null,
     created_at  timestamptz not null,
     primary key (round_id, seq),
     constraint audit_entity_type_check check (entity_type in ('round','member','ember'))
   )`,

  `create index if not exists audit_round_idx on audit_events (round_id, seq)`,
];

export async function migrate(db: SqlClient): Promise<void> {
  for (const statement of STATEMENTS) {
    await db.query(statement);
  }
}