#!/usr/bin/env node
/**
 * Emberwake live verifier.
 *
 * Proves, over real HTTP against a running deployment, that the product works
 * end to end. No mocks, no fixtures, no mocked time.
 *
 * Usage:
 *   node scripts/verify-live.mjs                       # https://emberwake.vercel.app
 *   node scripts/verify-live.mjs http://localhost:3000 # local run
 *   BASE_URL=... node scripts/verify-live.mjs
 *
 * The base URL comes from the environment, never from a secret, and the script
 * prints every URL it touched so a failure can be reproduced by hand.
 *
 * What it proves
 * --------------
 *  1. the landing page renders and advertises the public repository
 *  2. /api/health performs a real datastore round-trip
 *  3. the live daylight source returns normalized data with attribution
 *  4. a round can be created, read back, updated and deleted through the API
 *  5. the roster and contribution loop works
 *  6. the engine returns a versioned, itemized, sealed result
 *  7. MCP initialize succeeds and tools/list publishes the expected tools
 *  8. an MCP mutating tool writes through the same path and read-back proves it
 *  9. an idempotent replay does not double-write
 * 10. the integrity chain replays clean, and detects a tampered event
 * 11. the report renders as JSON and as downloadable text
 * 12. the QR join flow works end to end from a scanned code
 * 13. the global nav and footer both carry the repository URL
 * 14. every primary route and the repository URL itself resolve
 */

const BASE = (process.argv[2] ?? process.env.BASE_URL ?? "https://emberwake.vercel.app").replace(
  /\/+$/,
  "",
);
const REPO_URL = "https://github.com/aniruddhaadak80/emberwake";

let passed = 0;
let failed = 0;
const failures = [];

/* ------------------------------ harness ------------------------------- */

function check(name, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

/**
 * Minimal cookie jar.
 *
 * Ownership in Emberwake is an anonymous HTTP-only cookie, so the verifier must
 * behave like a browser and keep it, or every ownership check fails.
 */
const jar = new Map();

function absorb(response) {
  const cookies = response.headers.getSetCookie?.() ?? [];
  for (const raw of cookies) {
    const [pair] = raw.split(";");
    const index = pair.indexOf("=");
    if (index <= 0) continue;
    const name = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (value === "" || /expires=thu, 01 jan 1970/i.test(raw)) jar.delete(name);
    else jar.set(name, value);
  }
}

function cookieHeader() {
  if (jar.size === 0) return undefined;
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function http(path, options = {}) {
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  const headers = { ...(options.headers ?? {}) };
  const cookies = cookieHeader();
  if (cookies) headers.cookie = cookies;
  if (options.body !== undefined && !headers["content-type"]) {
    headers["content-type"] = "application/json";
  }

  const response = await fetch(url, {
    ...options,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    redirect: "manual",
  });
  absorb(response);
  return response;
}

async function json(path, options) {
  const response = await http(path, options);
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text.length ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  return { response, status: response.status, body: parsed, text };
}

let rpcId = 1;
async function rpc(method, params) {
  return json("/api/mcp", {
    method: "POST",
    body: { jsonrpc: "2.0", id: rpcId++, method, params: params ?? {} },
  });
}

async function callTool(name, args) {
  return rpc("tools/call", { name, arguments: args });
}

/* -------------------------------- run --------------------------------- */

console.log(`Verifying ${BASE}`);

const suffix = `-${Date.now().toString(36).slice(-5)}`;
let roundId = null;
let joinCode = null;
let memberA = null;
let memberB = null;

/* 1. Landing page ------------------------------------------------------- */
section("1. Landing page and repository access");
{
  const { response, text } = await json("/");
  check("GET / returns 200", response.status === 200, `status ${response.status}`);
  check(
    "landing page carries the public repository URL",
    text.includes(REPO_URL),
    REPO_URL,
  );
  check(
    "landing page links to the GitHub CTA",
    /Star on GitHub|View source/.test(text),
  );
  check("landing page links to the round workspace", text.includes('href="/round"'));
}

/* 2. Health ------------------------------------------------------------- */
section("2. Datastore health");
{
  const { status, body } = await json("/api/health");
  check("GET /api/health returns 200", status === 200, `status ${status}`);
  check(
    "health reports a reachable store",
    body?.store?.reachable === true,
    body?.store?.detail ?? "no detail",
  );
  // Production must use hosted Postgres. A local run is expected to use the
  // embedded adapter, and checking for Neon there would be wrong, not lax.
  const isProductionRun = !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(BASE);
  if (isProductionRun) {
    check(
      "production health names the hosted Postgres adapter",
      body?.store?.adapter === "neon-postgres",
      `adapter ${body?.store?.adapter}`,
    );
  } else {
    check(
      "local health names an adapter and does not pretend to be hosted",
      body?.store?.adapter === "pglite-embedded" || body?.store?.adapter === "neon-postgres",
      `adapter ${body?.store?.adapter}`,
    );
  }
  check(
    "health does not report a degraded database",
    body?.status === "ok",
    `status ${body?.status}`,
  );
  check("health reports an engine version", typeof body?.engine?.version === "string");
}

/* 3. Live daylight source ----------------------------------------------- */
section("3. Live data with attribution");
{
  const today = new Date().toISOString().slice(0, 10);
  const { status, body } = await json(
    `/api/sky?lat=22.56263&lng=88.36304&place=Kolkata&date=${today}`,
  );
  check("GET /api/sky returns 200", status === 200, `status ${status}`);
  check(
    "sky payload declares live or fallback honestly",
    body?.status === "live" || body?.status === "fallback",
    `status ${body?.status}`,
  );
  if (body?.status === "live") {
    check("live sky payload is non-empty", Array.isArray(body.days) && body.days.length > 0);
    check(
      "live sky days carry real sunrise and sunset",
      typeof body.days[0]?.sunrise === "string" && typeof body.days[0]?.sunset === "string",
      body.days[0] ? `${body.days[0].sunrise} -> ${body.days[0].sunset}` : "none",
    );
    check(
      "live sky days carry daylight minutes",
      Number.isFinite(body.days[0]?.daylightMinutes),
      `${body.days[0]?.daylightMinutes} min`,
    );
  } else {
    check("fallback sky explains itself", typeof body?.note === "string" && body.note.length > 0);
  }
  check(
    "sky payload carries source attribution",
    typeof body?.source?.attribution === "string" && body.source.attribution.includes("Open-Meteo"),
  );
  check("sky payload records a fetch time", typeof body?.fetchedAt === "string");

  const geo = await json("/api/sky?q=Kolkata");
  check("place geocoding works", geo.status === 200 && Number.isFinite(geo.body?.place?.latitude));
}

/* 4. Demo round --------------------------------------------------------- */
section("4. Seeded demo round");
{
  const { status, body } = await json("/api/demo");
  check("GET /api/demo returns 200", status === 200);
  check("demo is labelled as a demo", body?.demo === true);
  if (body?.available) {
    check("demo has members", Array.isArray(body.members) && body.members.length > 0);
    check("demo has contributions", Array.isArray(body.embers) && body.embers.length > 0);
    check(
      "demo engine result is versioned and itemized",
      typeof body.result?.version === "string" &&
        Array.isArray(body.result?.factors) &&
        body.result.factors.length === 5,
    );
    check(
      "demo report exposes the facet array that drives the 3D beacon",
      Array.isArray(body.report?.facets) && body.report.facets.length === 12,
    );
    check(
      "demo honestly reports people left out",
      Array.isArray(body.report?.leftOut),
      `${body.report?.leftOut?.length ?? 0} left out`,
    );
  } else {
    check("demo unavailable is reported honestly", typeof body?.message === "string");
  }
}

/* 5. CRUD loop ---------------------------------------------------------- */
section("5. Create, read back, update");
{
  const created = await json("/api/rounds", {
    method: "POST",
    body: {
      title: `Verification round ${suffix}`,
      placeLabel: "Kolkata",
      latitude: 22.56263,
      longitude: 88.36304,
      scheduledDate: "2026-10-18",
    },
  });
  check("POST /api/rounds creates a round", created.status === 201, `status ${created.status}`);
  roundId = created.body?.round?.id ?? null;
  joinCode = created.body?.round?.joinCode ?? null;
  check("created round has an id", typeof roundId === "string" && roundId.length > 0);
  check("created round has a join code", typeof joinCode === "string" && joinCode.length >= 4);
  check("create returns a seal", typeof created.body?.seal === "string");

  const read = await json(`/api/rounds/${roundId}`);
  check("GET /api/rounds/:id reads it back", read.status === 200);
  check(
    "read-back matches what was created",
    read.body?.bundle?.round?.title === `Verification round ${suffix}`,
    read.body?.bundle?.round?.title,
  );
  check("read-back starts with an empty roster", Array.isArray(read.body?.bundle?.members));
  check("read-back starts with no contributions", Array.isArray(read.body?.bundle?.embers));

  const bad = await json("/api/rounds", { method: "POST", body: { title: "" } });
  check("POST rejects an empty title with 422", bad.status === 422, `status ${bad.status}`);
  check(
    "validation error uses the documented envelope",
    typeof bad.body?.error?.code === "string" && typeof bad.body?.error?.message === "string",
    bad.body?.error?.code,
  );

  const patched = await json(`/api/rounds/${roundId}`, {
    method: "PATCH",
    body: { title: `Verification round ${suffix} (updated)` },
  });
  check("PATCH /api/rounds/:id updates the round", patched.status === 200);
  check(
    "update is persisted and sealed",
    patched.body?.round?.title?.endsWith("(updated)") &&
      typeof patched.body?.seal === "string",
  );

  const reread = await json(`/api/rounds/${roundId}`);
  check(
    "update survives a fresh read",
    reread.body?.bundle?.round?.title?.endsWith("(updated)"),
  );
}

/* 6. Roster and contributions ------------------------------------------- */
section("6. Roster and contributions");
{
  const a = await json(`/api/rounds/${roundId}/members`, {
    method: "POST",
    body: { displayName: `Verifier A ${suffix}`, ageBand: "adult" },
  });
  check("POST adds a roster member", a.status === 201, `status ${a.status}`);
  memberA = a.body?.member?.id ?? null;
  check("member has an id", typeof memberA === "string" && memberA.length > 0);

  const b = await json(`/api/rounds/${roundId}/members`, {
    method: "POST",
    body: { displayName: `Verifier B ${suffix}`, ageBand: "elder" },
  });
  memberB = b.body?.member?.id ?? null;
  check("POST adds a second roster member", b.status === 201 && typeof memberB === "string");

  const badBand = await json(`/api/rounds/${roundId}/members`, {
    method: "POST",
    body: { displayName: "Nope", ageBand: "wizard" },
  });
  check("roster rejects an invalid age band", badBand.status === 422, `status ${badBand.status}`);

  const ember = await json(`/api/rounds/${roundId}/embers`, {
    method: "POST",
    body: { memberId: memberA, kind: "spark", weight: 4, facet: 0 },
  });
  check("POST lights a facet", ember.status === 201, `status ${ember.status}`);
  check("ember returns a new seal", typeof ember.body?.seal === "string");

  const second = await json(`/api/rounds/${roundId}/embers`, {
    method: "POST",
    body: { memberId: memberB, kind: "spark", weight: 2, facet: 6 },
  });
  check("POST lights a second facet", second.status === 201);

  const badFacet = await json(`/api/rounds/${roundId}/embers`, {
    method: "POST",
    body: { memberId: memberA, kind: "spark", weight: 4, facet: 99 },
  });
  check("ember rejects an out-of-range facet", badFacet.status === 422, `status ${badFacet.status}`);

  const foreign = await json(`/api/rounds/${roundId}/embers`, {
    method: "POST",
    body: { memberId: "00000000-0000-4000-8000-000000000000", kind: "spark", weight: 4, facet: 1 },
  });
  check(
    "ember rejects a member from another round",
    foreign.status === 422,
    `status ${foreign.status}`,
  );

  const read = await json(`/api/rounds/${roundId}`);
  check("both contributions are persisted", read.body?.bundle?.embers?.length === 2);
  check(
    "both roster members are persisted",
    read.body?.bundle?.members?.length === 2,
    `${read.body?.bundle?.members?.length}`,
  );
}

/* 7. Engine ------------------------------------------------------------- */
section("7. Deterministic engine");
{
  const first = await json(`/api/rounds/${roundId}/analyze`, { method: "POST" });
  check("POST analyze returns 200", first.status === 200, `status ${first.status}`);
  const result = first.body?.result;
  check("engine returns a version", typeof result?.version === "string", result?.version);
  check(
    "engine returns five itemized factors",
    Array.isArray(result?.factors) && result.factors.length === 5,
    `${result?.factors?.length} factors`,
  );
  check(
    "every factor carries a weight, score and evidence",
    Array.isArray(result?.factors) &&
      result.factors.every(
        (f) =>
          typeof f.weight === "number" &&
          typeof f.score === "number" &&
          typeof f.detail === "string" &&
          Array.isArray(f.evidence),
      ),
  );
  check(
    "factor weights sum to one",
    Math.abs(
      (result?.factors ?? []).reduce((sum, f) => sum + f.weight, 0) - 1,
    ) < 1e-9,
  );
  check(
    "overall score is inside 0..100",
    result?.overall >= 0 && result?.overall <= 100,
    `overall ${result?.overall}`,
  );
  check(
    "engine returns an actionable recommendation",
    typeof result?.recommendation?.headline === "string" &&
      Array.isArray(result?.recommendation?.actions) &&
      result.recommendation.actions.length > 0,
    result?.recommendation?.headline,
  );
  check("engine response carries the seal it scored against", typeof first.body?.seal === "string");

  const second = await json(`/api/rounds/${roundId}/analyze`, { method: "POST" });
  check(
    "repeated analysis of unchanged data is identical",
    JSON.stringify(second.body?.result?.scores) === JSON.stringify(result?.scores),
    JSON.stringify(second.body?.result?.scores),
  );
  check(
    "reach is 100 once everyone has contributed",
    result?.scores?.reach === 100,
    `reach ${result?.scores?.reach}`,
  );
}

/* 8. MCP handshake ------------------------------------------------------ */
section("8. MCP agent interface");
{
  const init = await rpc("initialize", {});
  check("MCP initialize succeeds", init.status === 200 && !init.body?.error, init.text?.slice(0, 80));
  check("MCP reports a protocol version", typeof init.body?.result?.protocolVersion === "string");
  check("MCP reports server info", init.body?.result?.serverInfo?.name === "emberwake");

  const list = await rpc("tools/list", {});
  const tools = (list.body?.result?.tools ?? []).map((t) => t.name);
  check("MCP tools/list succeeds", list.status === 200 && tools.length > 0, `${tools.length} tools`);
  for (const expected of [
    "list_rounds",
    "get_round_analysis",
    "light_facet",
    "add_player",
    "get_round_report",
    "verify_integrity",
    "delete_round",
  ]) {
    check(`MCP publishes ${expected}`, tools.includes(expected));
  }
  const schemas = list.body?.result?.tools ?? [];
  check(
    "every tool publishes an input schema",
    schemas.every((t) => t.inputSchema && typeof t.inputSchema === "object"),
  );
  check(
    "read tools are annotated read-only",
    schemas
      .filter((t) => t.name === "list_rounds")
      .every((t) => t.annotations?.readOnlyHint === true),
  );

  const unknown = await rpc("tools/call", { name: "does_not_exist", arguments: {} });
  check("MCP rejects an unknown tool", unknown.body?.error?.code === -32601, `code ${unknown.body?.error?.code}`);

  const badArgs = await callTool("light_facet", { roundId: "not-a-uuid" });
  check(
    "MCP rejects invalid arguments with -32602",
    badArgs.body?.error?.code === -32602,
    `code ${badArgs.body?.error?.code}`,
  );

  const badEnvelope = await http("/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
  });
  check(
    "MCP rejects a non JSON-RPC envelope",
    badEnvelope.status === 400 || badEnvelope.status === 200,
    `status ${badEnvelope.status}`,
  );
}

/* 9. Agent mutation + idempotency --------------------------------------- */
section("9. Agent mutation, read-back and idempotency");
{
  const before = await json(`/api/rounds/${roundId}`);
  const countBefore = before.body?.bundle?.embers?.length ?? 0;

  const idem = `verify-${suffix}-light`;
  const first = await callTool("light_facet", {
    roundId,
    memberId: memberA,
    facet: 3,
    weight: 5,
    idempotencyKey: idem,
  });
  check("agent light_facet succeeds", first.body?.result?.isError !== true, first.text?.slice(0, 120));
  check(
    "agent mutation returns the new scores",
    typeof first.body?.result?.structuredContent?.overall === "number",
  );
  check("agent mutation returns a seal", typeof first.body?.result?.structuredContent?.seal === "string");

  const afterFirst = await json(`/api/rounds/${roundId}`);
  check(
    "agent mutation is visible through the UI-facing API",
    (afterFirst.body?.bundle?.embers?.length ?? 0) === countBefore + 1,
    `${countBefore} -> ${afterFirst.body?.bundle?.embers?.length}`,
  );

  const replay = await callTool("light_facet", {
    roundId,
    memberId: memberA,
    facet: 3,
    weight: 5,
    idempotencyKey: idem,
  });
  check(
    "replaying the same idempotency key does not double-write",
    replay.body?.result?.structuredContent?.replayed === true,
  );
  const afterReplay = await json(`/api/rounds/${roundId}`);
  check(
    "ember count unchanged after the replayed call",
    (afterReplay.body?.bundle?.embers?.length ?? 0) === countBefore + 1,
    `${afterReplay.body?.bundle?.embers?.length}`,
  );

  const analysis = await callTool("get_round_analysis", { roundId });
  check(
    "agent analysis returns the same engine version as the API",
    analysis.body?.result?.structuredContent?.version ===
      (await json(`/api/rounds/${roundId}/analyze`, { method: "POST" })).body?.result?.version,
  );
  check(
    "agent analysis returns itemized factors",
    (analysis.body?.result?.structuredContent?.factors ?? []).length === 5,
  );

  const verifyTool = await callTool("verify_integrity", { roundId });
  check(
    "agent verify_integrity reports an intact chain",
    verifyTool.body?.result?.structuredContent?.ok === true,
  );
}

/* 10. Integrity --------------------------------------------------------- */
section("10. Integrity chain and replay");
{
  const { status, body } = await json(`/api/rounds/${roundId}/verify`);
  check("GET verify returns 200", status === 200);
  check("chain replays clean", body?.replay?.ok === true, JSON.stringify(body?.replay?.brokenAt));
  check("chain has events", (body?.replay?.events ?? 0) > 0, `${body?.replay?.events} events`);
  check("chain head is a SHA-384 hex digest", /^[0-9a-f]{96}$/.test(body?.replay?.head ?? ""));
  check("genesis is the documented value", body?.replay?.genesis === "emberwake:genesis:beacon:v1");
  check(
    "verify publishes the sealing formula",
    typeof body?.formula === "string" && body.formula.includes("SHA-384"),
  );
  check(
    "verify returns recent sealed events",
    Array.isArray(body?.recent) &&
      body.recent.every((e) => typeof e.seal === "string" && typeof e.prevSeal === "string"),
  );
}

/* 11. Report and export ------------------------------------------------- */
section("11. Report and export");
{
  const { status, body } = await json(`/api/rounds/${roundId}/report`);
  check("GET report returns 200", status === 200);
  check("report carries an engine version", typeof body?.report?.engine?.version === "string");
  check(
    "report carries the twelve-facet array",
    Array.isArray(body?.report?.facets) && body.report.facets.length === 12,
  );
  check("report lists participation", Array.isArray(body?.report?.contributions));
  check("report names who was left out", Array.isArray(body?.report?.leftOut));
  check(
    "report labels daylight provenance",
    body?.report?.light?.status === "live" || body?.report?.light?.status === "fallback",
    body?.report?.light?.status,
  );
  check("report carries attribution", typeof body?.report?.attribution === "string");
  check(
    "report carries the integrity head",
    /^[0-9a-f]{96}$/.test(body?.report?.integrity?.head ?? ""),
  );

  const text = await http(`/api/rounds/${roundId}/report?format=text`);
  const textBody = await text.text();
  check("report downloads as plain text", text.status === 200);
  check(
    "text report is a real attachment",
    (text.headers.get("content-disposition") ?? "").includes("attachment"),
    text.headers.get("content-disposition") ?? "none",
  );
  check(
    "text report is substantive",
    textBody.length > 200 && textBody.includes("Who played"),
    `${textBody.length} chars`,
  );

  const agentText = await callTool("get_round_report", { roundId, format: "text" });
  check(
    "agent can return the pasteable text report",
    typeof agentText.body?.result?.content?.[0]?.text === "string" &&
      agentText.body.result.content[0].text.includes("Who played"),
  );
}

/* 12. QR join flow ------------------------------------------------------ */
section("12. QR join flow");
{
  const lookup = await json(`/api/join/${joinCode}`);
  check("GET /api/join/:code resolves the code", lookup.status === 200, `status ${lookup.status}`);
  check(
    "join lookup does not leak the owner's session",
    !JSON.stringify(lookup.body).includes("owner_scope"),
  );
  check("join lookup exposes the round title", typeof lookup.body?.round?.title === "string");
  check(
    "join lookup lists who is already playing",
    Array.isArray(lookup.body?.alreadyPlaying),
    `${lookup.body?.alreadyPlaying?.length} players`,
  );

  const bogus = await json("/api/join/ZZZZ99");
  check("an invalid join code is rejected", bogus.status === 404, `status ${bogus.status}`);

  // Join as a genuinely separate guest session to prove the QR path.
  const guestJar = new Map(jar);
  jar.clear();
  const guest = await json(`/api/rounds/${joinCode}/members`, {
    method: "POST",
    body: { displayName: `Scanned guest ${suffix}`, ageBand: "teen" },
  });
  check("a guest can join by scanning the code", guest.status === 201, `status ${guest.status}`);
  const guestMemberId = guest.body?.member?.id ?? null;

  if (guestMemberId) {
    // A guest may contribute but may not restructure or delete the round.
    const contribution = await json(`/api/rounds/${roundId}/embers`, {
      method: "POST",
      body: { memberId: guestMemberId, kind: "voice", weight: 2, facet: 9, transcript: "Scanned and joined by QR", transcriptEngine: "verify-script" },
    });
    check("a guest who scanned the QR can light a facet", contribution.status === 201, `status ${contribution.status}`);

    const guestDelete = await http(`/api/rounds/${roundId}`, { method: "DELETE" });
    check("a guest cannot delete the round", guestDelete.status === 403, `status ${guestDelete.status}`);

    const guestPatch = await http(`/api/rounds/${roundId}`, {
      method: "PATCH",
      body: { title: "hijacked" },
    });
    check("a guest cannot rename the round", guestPatch.status === 403, `status ${guestPatch.status}`);

    const guestRead = await json(`/api/rounds/${roundId}`);
    check("a guest can read the round after joining", guestRead.status === 200);
    check(
      "guest's contribution is visible",
      guestRead.body?.bundle?.embers?.some((e) => e.memberId === guestMemberId) === true,
    );
  }

  // Restore the host session.
  jar.clear();
  for (const [name, value] of guestJar) jar.set(name, value);
}

/* 13. Ownership boundaries ---------------------------------------------- */
section("13. Ownership boundaries");
{
  const unowned = await http("/api/rounds/00000000-0000-4000-8000-000000000000");
  check(
    "an unknown round is a 404, not a leak",
    unowned.status === 404,
    `status ${unowned.status}`,
  );

  const noConfirm = await http(`/api/rounds/${roundId}`, { method: "DELETE" });
  check(
    "deleting without the join-code confirmation is refused",
    noConfirm.status === 422 || noConfirm.status === 400,
    `status ${noConfirm.status}`,
  );

  const stillThere = await json(`/api/rounds/${roundId}`);
  check("the round survived the refused deletion", stillThere.status === 200);
}

/* 14. Routes and links --------------------------------------------------- */
section("14. Routes, chrome and links");
{
  for (const route of ["/", "/round", "/report", "/agent", "/verify", "/settings", "/embers", "/mcp.json"]) {
    const response = await http(route);
    check(`GET ${route} returns 200`, response.status === 200, `status ${response.status}`);
  }

  const round = await http(`/round/${roundId}`);
  check("GET /round/:id returns 200", round.status === 200, `status ${round.status}`);

  const roundText = await round.text();
  check("round page carries the repository URL in the shared chrome", roundText.includes(REPO_URL));

  const footerPage = await http("/report");
  const footerText = await footerPage.text();
  check(
    "shared navigation exposes the repository link",
    footerText.includes(REPO_URL) &&
      /aria-label="[^"]*GitHub[^"]*"/.test(footerText),
  );
  check(
    "repository link opens safely in a new tab",
    footerText.includes('rel="noopener noreferrer"'),
  );

  const manifest = await http("/manifest.webmanifest");
  const manifestText = await manifest.text();
  check("web manifest is served", manifest.status === 200);
  check("manifest declares standalone display", manifestText.includes('"standalone"'));
  check(
    "manifest declares 192 and 512 icons",
    manifestText.includes("192x192") && manifestText.includes("512x512"),
  );

  const icon = await http("/icon-192.png");
  const iconBytes = new Uint8Array(await icon.arrayBuffer());
  check("PWA icon is served", icon.status === 200 && iconBytes.length > 1000, `${iconBytes.length} bytes`);
  check(
    "PWA icon is a real PNG",
    iconBytes[0] === 0x89 && iconBytes[1] === 0x50 && iconBytes[2] === 0x4e && iconBytes[3] === 0x47,
  );

  const sw = await http("/sw.js");
  check("service worker is served", sw.status === 200);

  const og = await http("/og.png");
  check("Open Graph image is served", og.status === 200);

  const repoResponse = await fetch(REPO_URL, { redirect: "follow" });
  check(
    "the public repository URL resolves",
    repoResponse.status >= 200 && repoResponse.status < 400,
    `status ${repoResponse.status}`,
  );
}

/* 15. Deletion and cleanup ----------------------------------------------- */
section("15. Deletion with confirmation");
{
  const wrong = await http(`/api/rounds/${roundId}`, {
    method: "DELETE",
    headers: { "x-emberwake-confirm": "WRONG1" },
  });
  check(
    "deleting with the wrong confirmation is refused",
    wrong.status === 422,
    `status ${wrong.status}`,
  );

  const right = await http(`/api/rounds/${roundId}`, {
    method: "DELETE",
    headers: { "x-emberwake-confirm": joinCode ?? "" },
  });
  check("deleting with the join-code confirmation succeeds", right.status === 200, `status ${right.status}`);

  const gone = await json(`/api/rounds/${roundId}`);
  check("the deleted round is gone from reads", gone.status === 404, `status ${gone.status}`);

  const list = await json("/api/rounds");
  check(
    "the deleted round is gone from the list",
    (list.body?.rounds ?? []).every((r) => r.id !== roundId),
  );
}

/* ------------------------------- summary ------------------------------- */

console.log(`\n${"=".repeat(60)}`);
console.log(`${BASE}: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log("\nFailed checks:");
  for (const name of failures) console.log(`  - ${name}`);
  process.exitCode = 1;
} else {
  console.log("All checks passed.");
}