# Contributing to Emberwake

Thanks for looking. This is a small project with one opinionated idea: **the 3D
scene is generated from the same data as the numbers**, so a fairness bug cannot
hide behind a good-looking render. Most contributions that fit naturally are
about that idea, the engine behind it, or the plumbing that keeps user data
honest.

## Getting set up

```bash
git clone https://github.com/aniruddhaadak80/emberwake.git
cd emberwake
pnpm install
pnpm dev
```

**You do not need a database, an API key, or any configuration.** The local
adapter embeds Postgres in-process, creates its own schema, and seeds a labelled
demo round on first request. If `npm run dev` asks you for a connection string,
something is wrong — it should never do that locally.

## Before you open a pull request

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

All four must pass. If a lint rule is fighting you, fix the code rather than
suppressing the rule — an eslint-disable in this repository should be rare enough
to be worth an explanation in the review.

## Where things live

| You want to change | Look here |
| --- | --- |
| The fairness scores | `src/lib/engine/beacon-engine.ts` |
| Factor weights | `WEIGHTS` in the same file, plus the table in the README |
| The sealing formula | `src/lib/integrity/seal.ts` |
| The 3D arena | `src/components/three/BeaconStage.tsx` |
| Database schema | `src/lib/db/schema.ts` |
| Datastore selection | `src/lib/db/client.ts` |
| Agent tools | `src/lib/mcp.ts` |
| Daylight data | `src/lib/sky.ts` and `src/lib/sun.ts` |
| Icons and the OG image | `scripts/gen-assets.mjs` |

## Changing the engine

The engine is the heart of the product and the easiest thing to break quietly.

1. **Bump `ENGINE_VERSION`.** It is returned in every score. Stored reports
   interpret themselves against it, so a silent semantic change would make old
   numbers untrustworthy.
2. **Keep it pure.** No `Date.now()`, no randomness, no I/O. Time arrives as an
   injected `now`. This is what lets an analysis be a hashable fact.
3. **Keep weights summing to 1.** There is a test that asserts it, because a
   silent change here quietly rescales every score.
4. **Give every factor its evidence.** A score a user cannot interrogate is a
   score they have to trust, which is the thing this project exists to avoid.
5. **Add tests for the boundary, not just the happy path.** The engine test file
   groups cases as *normal*, *boundary*, *empty*, *malformed* and
   *deterministic*. Please add to those groups rather than inventing a new shape.
6. **Update the README factor table** so the documentation does not drift from the
   code.

Two real bugs were caught by these tests during the initial build: a 100× scale
error in the overall score, and evening hours labelled `dawn` instead of `dusk`.
They were invisible by inspection and obvious to a boundary test.

## Changing the schema

- `src/lib/db/schema.ts` must stay valid on **both** Neon and PGlite. Use plain
  Postgres, no extensions, no stored procedures — that is what keeps one schema
  definition working in two very different environments.
- Every statement must be idempotent. `migrate()` runs on every cold start and on
  every concurrent serverless invocation.
- Never expose a production deployment to the embedded adapter. If `NODE_ENV` is
  `production` and `DATABASE_URL` is missing, the app must report itself as
  degraded rather than writing to a throwaway local file.

## Changing the API

- Validate every input with Zod in `src/lib/validation.ts` before it can reach a
  query.
- Keep one error envelope (`{ error: { code, message, fields? } }`).
- Never echo an underlying error to the client. It may contain a connection
  string, a SQL fragment or a path. Log it server-side and return something
  honest.
- Adding a mutating tool means adding it to `src/lib/mcp.ts` **through the same
  repository function the UI uses**. If an agent can reach state the product
  cannot, that is a bug, not a feature.

## Local verification against a running server

```bash
pnpm dev
node scripts/verify-live.mjs http://localhost:3000
```

This performs 140 real HTTP checks — create, read back, update, analyse, an MCP
mutation with idempotent replay, integrity replay, export, join-by-QR, and
deletion. It keeps a cookie jar, so it exercises ownership properly.

## Reporting a bug

Open an issue with what you did, what you expected, what happened, and whether
`/settings` showed anything unusual. A screenshot of the beacon with a broken
facet pattern is genuinely useful.

## Code of conduct

Be decent. Assume good faith. Review the work, not the person.