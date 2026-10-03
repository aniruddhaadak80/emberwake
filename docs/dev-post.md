## What I Built

I built **Emberwake** for the person I will name: my family.

Every few weeks we play something together. Diwali, a birthday, someone's visiting. And every single time, the same thing happens without anyone saying it out loud — the same two people take most of the turns. Somebody has to explain the rules, so somebody always gets to play. My grandfather, who genuinely loves these evenings, gets skipped for most of them. And because nobody ever wrote down who played, **the exact same round happens again next month with the exact same imbalance.**

That last part is the real problem. It is not that the imbalance happens. It is that it is invisible, unwritten, and therefore unfixable.

Emberwake is a small game that makes it visible.

Everyone joins by scanning one QR code — no account, no install, any phone or laptop. Each person gets a **Spark** on a 3D headland at night. Lighting the shared **Beacon** is a turn-based cooperative round. When you light a facet, your spark flies in and that facet of the tower brightens.

Then it tells you the truth: a deterministic engine scores **Reach** (who actually played), **Balance** (how evenly the fuel was shared, via Gini), **Glow**, **Rhythm**, and **Golden hour** (whether there was enough real daylight to be outside) — and it names the people who never got a turn.

The part I care about most: **the beacon's geometry is generated from the same array of numbers the report prints.** Not "inspired by" it. The same twelve numbers. If the tower looks lopsided, the fuel genuinely is lopsided. I could not make the unfairness disappear with a nicer render, and that was deliberate.

Here is the seeded demo round, analysed live on the production deployment — two elders on the roster who never lit a facet, which is exactly the gap in my own family:

![Emberwake: the 3D beacon with real fuel data, a score of 66, and Aunty Maya and Grandpa Ravi marked "left out"](https://raw.githubusercontent.com/aniruddhaadak80/emberwake/main/docs/demo-beacon.png)

The takeaway is a plain-text report you can paste straight into a family group chat: who played, who did not, how the light was shared, and what to do about it next time.

## Demo

**Live app:** https://emberwake-lyart.vercel.app

It is a Progressive Web App, so you can open it on any phone — Android, iPhone, Windows, Mac — and install it. Scan the QR code on the landing page and you are there; no app store, no install step. The repository also ships a real Capacitor configuration so the same build wraps into native Android and iOS apps, though no store binary is published from this repo and I do not pretend otherwise.

Things worth clicking:

- **`/round`** — make a round, get a QR code, hand it to your family.
- **`/round/[id]`** — the game. Pick a player, click a facet of the 3D beacon, watch the score recompute from what was actually stored.
- **`/agent`** — a live agent console (more below).
- **`/verify`** — replay the audit chain yourself.

## Code

**https://github.com/aniruddhaadak80/emberwake** — MIT licensed.

Local development needs **zero environment variables**. Clone, install, `npm run dev`. An embedded Postgres creates its own schema and seeds a demo round on first request.

There are no API keys anywhere in the product. Sunrise, sunset and place names come from Open-Meteo, which needs none.

## How I Built It

Next.js 16 (App Router), TypeScript in strict mode, Tailwind v4, Three.js for the arena, Neon Postgres in production, and Transformers.js for on-device speech recognition.

**Five decisions I would defend in review:**

**1. The 3D is the data, not decoration.** The beacon is twelve facet meshes whose emissive intensity and radial recession come straight from `report.facets[i]` — the same per-facet fuel totals that produce the report. An unlit facet is physically recessed, leaving a real gap in the tower. This is why I did not add a globe, particles, or ambient gradient: the scene has to be doing work.

**2. The engine is pure, and shared.** `analyzeRound()` takes stored data and returns a versioned, itemized result. It is called by the 3D HUD, by `POST /api/rounds/[id]/analyze`, and by the agent tool. There is no second implementation anywhere. It takes the clock as an injected argument, so it never reads the wall clock, which is what lets an analysis be a hashable fact.

**3. Every change is sealed.** Each mutation appends to a per-round chain:

```
seal_n = SHA-384( UTF-8(prevSeal) || canonicalJson(event_n) )
```

Canonical JSON recursively sorts object keys, so the same logical event always hashes identically. Because each seal covers the previous one, editing a historical row directly in the database breaks every seal after it — and `/verify` tells you exactly which event broke. Deletions keep tombstones so the history stays replayable.

The tests check the seal against an **independently implemented** oracle of that formula, not against the code that produced it.

**4. The agent is not a mock-up.** `POST /api/mcp` speaks JSON-RPC 2.0 with `initialize`, `tools/list` and `tools/call`, and seven typed tools. The mutating ones call the same repository functions as the UI — an agent cannot reach state the product cannot. They accept an `idempotencyKey`, and the key is stored *inside* the audit event, so even the replay guard is covered by the hash chain. Run the same call twice and the second returns `{"replayed": true}` and writes nothing.

**5. Host and guest are different capabilities.** The host owns a round. Someone who scans the QR is a **player**: they can read the round and light facets, but they cannot rename it, remove people, delete it, or append audit events. This sounds like over-engineering until you try the alternative — without it, the QR lets someone join and then be unable to take a turn, which makes the QR the least useful control in the product.

**Things that were wrong, and how I found out:**

The engine tests caught two real defects I would not have caught by reading the code. The overall score was 100× too large because I rescaled a weighted mean that was already on a 0–100 scale. And the daylight model labelled the evening `dawn`, so the scene lit the wrong way at dusk. Both were invisible on inspection and obvious to a boundary test.

A third bug was subtler and more embarrassing: the QR join path passed a join code into a query against a `uuid` column, so Postgres raised `22P02 invalid input syntax` and the single most important feature in the product returned a 500. My live verifier caught it because it joins as a genuinely separate session with a separate cookie jar, exactly like a real guest scanning a phone. It now checks the shape before it reaches the database and answers 404.

**Verification is a checked-in script, not a claim.** `npm run verify:live` runs 140 real HTTP checks against a deployment: create, read back, update, roster, contributions, engine output, MCP handshake, an idempotent mutation plus its replay, integrity replay, the report as text, the QR join flow, ownership boundaries, destructive confirmation, deletion, and every route and asset. It keeps a cookie jar so it exercises ownership properly. All 140 pass against production, on Neon, after a redeploy — with data from the previous run still in the database.

## Why Does Open Innovation Matter?

**The audio never leaves the house.**

The person who talks least in my family is the person I most want in the record. So Emberwake lets anyone record a 30-second voice ember instead of typing — and it is transcribed by `whisper-tiny.en` running **in their own browser** via WebAssembly, through Transformers.js.

Three consequences that a hosted API could not have given me:

- **It works with no signal.** A family gathering is often in a place with terrible reception. Once the model is cached, transcription works offline.
- **My grandfather's voice never reaches a server.** Not because of a policy page — because there is no upload endpoint in the codebase. There is no place for it to go.
- **It costs nothing and cannot be switched off.** No key, no quota, no vendor deprecating the endpoint. It is open weights running on hardware the family already owns.

The same reasoning drove the storage decision. Locally, the app runs on **PGlite**, an embedded Postgres compiled to WASM — same SQL dialect, same schema file, zero setup. In production it runs on **Neon**. One schema definition, one repository interface, two adapters, and a deliberate hard failure: a production build without `DATABASE_URL` reports itself as `degraded` rather than quietly writing to a throwaway local file.

And the whole thing is MIT with the weights readable. If your family's imbalance looks different from the one this solves, you should be able to change the factors yourself — and the engine returns its evidence so you can see exactly what moved.

## My Agent Session

I did not record a DevRelay session for this, so I have nothing to embed there.

What I do have is a working agent interface, which you can drive from the `/agent` page or with curl:

```bash
curl -s -X POST https://emberwake-lyart.vercel.app/api/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

The console is not a mock-up: it issues real JSON-RPC, shows the request and the response verbatim including failures, and the `light_facet` button calls the same mutation the on-screen beacon does.

## Prize Categories

**None.**

I want to be straightforward about this rather than pad the list. I did not use Render, Tinker, TabPFN, Arduino, DigitalOcean, Gemma, Backboard, ElevenLabs, Entire, Copilot, Mastra, MongoDB Atlas, Sentry, SerpApi, Temporal or Tiger Data, so I am not entering any partner or featured category. The rules are explicit that no partner technology is needed to be eligible for the overall prize, and I would rather submit honestly than claim a track I did not build with.

The open-source choices here were driven by the problem, not by a prize category: open-weight Whisper because a family gathering has no signal and a grandparent's voice should not need a server, and PGlite because anyone trying this should not have to sign up for a database before they can see whether it is useful.

## A few honest limitations

- **No store binaries.** Capacitor is configured and the commands work, but producing signed Android and iOS builds needs toolchains I did not have. The PWA is the path I actually verified end to end, and it is the one I would tell you to use.
- **Rate limiting is best-effort.** It is an in-memory window. On serverless, instances are not shared and get recycled, so it stops casual hammering and not much more. A hosted limiter at the edge would be the real answer.
- **A round lives in one browser.** There are no accounts, which means clearing cookies loses your own rounds. Exporting a round to re-import it would fix that without introducing signups.
- **The daylight model is simplified.** The sunrise and sunset *times* are real provider data, but the arc between them is my own simplification, not an ephemeris. I documented it as such rather than implying astronomical precision.

## Attribution

Sunrise, sunset and place names by [Open-Meteo](https://open-meteo.com) (CC BY 4.0). Speech recognition by [`onnx-community/whisper-tiny.en`](https://huggingface.co/onnx-community/whisper-tiny.en) via [Transformers.js](https://github.com/huggingface/transformers.js). The beacon's lighting is computed from real sunrise and sunset times, so opening the app at 9pm genuinely shows you a dark headland.

The icons and the Open Graph image are generated procedurally by `scripts/gen-assets.mjs`, so there are no unattributed assets in the repo.

**Repo:** https://github.com/aniruddhaadak80/emberwake
**Live:** https://emberwake-lyart.vercel.app

If you have a family, a group chat, and one person who always gets skipped — I built this for you.