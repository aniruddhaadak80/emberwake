## What this changes

<!-- One or two sentences. What is different after this PR? -->

## Why

<!-- The problem being solved. If it touches the engine or the fairness model,
     say what was wrong with the previous behaviour. -->

## How it was verified

<!-- Be specific — "tests pass" is not evidence. -->

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm run test`
- [ ] `npm run build`
- [ ] Verified against a running server with `node scripts/verify-live.mjs <url>`

## Checklist

- [ ] Every visible control performs a real mutation and shows truthful
      loading, empty, success and failure states
- [ ] No secrets, tokens, `.env` values or private URLs in the diff
- [ ] If the engine changed, `ENGINE_VERSION` was bumped and the README factor
      table updated
- [ ] If the schema changed, the migration is idempotent and valid on both Neon
      and PGlite
- [ ] New user-facing routes and API endpoints are listed in the README project
      map
- [ ] Any new external data source carries attribution and an honest fallback

## Screenshots

<!-- Especially for anything touching the 3D arena, the HUD, or report layout. -->

## Notes for reviewers

<!-- Anything you would particularly like checked, or a decision you were unsure
     about and would like a second opinion on. -->