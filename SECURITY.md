# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Use GitHub's private reporting on the Security tab of
<https://github.com/aniruddhaadak80/emberwake>, or open a private advisory.

Include what an attacker could do, the steps to reproduce it, and the impact on
data belonging to other people. Please give a reasonable window to fix it before
disclosing publicly.

## What this application holds

Being precise about the threat model matters more than a long list.

- **Rounds, rosters and contributions.** Created by visitors, stored in Postgres.
- **Voice transcripts.** Text produced in the visitor's browser by an open-weight
  Whisper model.
- **Audio.** Never leaves the device. There is no upload endpoint and no audio
  storage anywhere in this project.
- **An anonymous session scope.** A random 32-byte value in an HTTP-only cookie,
  used to scope every database query.
- **Place name, coordinates and date.** Sent to Open-Meteo to fetch real sunrise
  and sunset, and only when the user enters them.

There are **no accounts, no passwords and no API keys** in this application. There
is no credential for an attacker to steal from the database.

## Controls already in place

| Control | Detail |
| --- | --- |
| Parameterized SQL | Every statement uses bound parameters. No user input is ever interpolated into SQL. |
| Scope isolation | Reads filter on `owner_scope`; a session cannot read another session's rounds. |
| Capability split | Host owns a round; a QR guest is a *player* — read and contribute, but never edit or delete. |
| Destructive confirmation | `DELETE` requires the round's join code in `x-emberwake-confirm`. |
| Input validation | Zod schemas bound every string length, enum, numeric range and request body size. |
| Error hygiene | Clients receive a stable envelope; underlying errors are logged server-side only. |
| No secrets in the client | No key is bundled, logged, or placed in any public manifest. |
| Append-only audit | Mutations extend a SHA-384 chain, so silent history edits are detectable by replay. |

## Known limitations, stated plainly

- **Rate limiting is best-effort.** Anonymous writes are limited by an in-memory
  fixed window. On serverless infrastructure instances are not shared and are
  recycled, so this stops casual scripted hammering from a single warm instance
  and nothing more. A determined attacker would need a hosted limiter at the
  edge. This is a real gap, not a solved problem.
- **The join code is a capability.** Anyone who can read a printed QR code can
  join that round and contribute. That is the intended design for a family game
  held in one room; it is not appropriate for sensitive data.
- **Transcripts are stored as text.** A voice ember's text is kept server-side and
  rendered as plain text, never as HTML. Do not paste untrusted markup into a
  transcript field expecting it to be sanitised later.
- **The service worker caches the shell, not API responses.** This is deliberate.
  If you find an `/api/` response being served from cache, that is a genuine bug
  worth reporting.

## Supported versions

Only the latest `main` branch is supported.