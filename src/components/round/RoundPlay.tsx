"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Trash2, TriangleAlert, Users } from "lucide-react";
import { BeaconStageCanvas } from "@/components/three/BeaconStageCanvas";
import { QrCode } from "@/components/QrCode";
import { VoiceEmber } from "@/components/VoiceEmber";
import {
  ContributionTable,
  FactorBars,
  FacetStrip,
  LightPanel,
  ScoreDial,
} from "@/components/ReportPanels";
import {
  ClientError,
  addEmber,
  addMember,
  analyzeRound,
  deleteEmber,
  deleteRound,
  getRoundBundle,
  removeMember,
  type BundleShape,
} from "@/lib/client";
import { AGE_BANDS, type AgeBand, type EngineResult, type SkyEnvelope } from "@/lib/types";
import { SITE_URL } from "@/config/site";
import { cn } from "@/lib/utils";

/**
 * The round play view.
 *
 * This is where the whole product is joined up: the 3D arena, the real CRUD
 * loop, the engine and the QR invite. Every control here performs a real network
 * mutation and then re-reads the round, so the numbers on screen are always a
 * consequence of what is actually stored.
 */
export function RoundPlay({ roundId }: { roundId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [bundle, setBundle] = useState<BundleShape | null>(null);
  const [result, setResult] = useState<EngineResult | null>(null);
  const [sky, setSky] = useState<SkyEnvelope | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [weight, setWeight] = useState(3);
  const [confirmCode, setConfirmCode] = useState("");
  const [showDelete, setShowDelete] = useState(false);

  // Selection lives in the URL so passing a phone to the next person keeps the
  // same view, and so a link can point at "Grandma's turn".
  const activeMemberId = searchParams.get("as");
  const activeMember = useMemo(
    () => bundle?.members.find((m) => m.id === activeMemberId) ?? null,
    [bundle, activeMemberId],
  );

  const facets = useMemo(() => {
    const values = new Array<number>(12).fill(0);
    for (const ember of bundle?.embers ?? []) {
      if (ember.facet >= 0 && ember.facet < 12) values[ember.facet] += ember.weight;
    }
    return values;
  }, [bundle]);

  const refresh = useCallback(async () => {
    const { bundle: next } = await getRoundBundle(roundId);
    if (!next) {
      setLoadState("missing");
      return;
    }
    setBundle(next);
    const analysis = await analyzeRound(roundId);
    setResult(analysis.result);
    setSky(analysis.sky);
  }, [roundId]);

  useEffect(() => {
    let cancelled = false;
    // No synchronous `setLoadState` here: state already starts as "loading", and
    // later refreshes keep the current view visible instead of flashing a
    // spinner over content the player is in the middle of using.
    (async () => {
      try {
        await refresh();
        if (!cancelled) setLoadState("ready");
      } catch (cause) {
        if (cancelled) return;
        setLoadError(cause instanceof ClientError ? cause.message : "Could not load this round.");
        setLoadState(cause instanceof ClientError && cause.status === 404 ? "missing" : "error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  function selectMember(memberId: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (next.get("as") === memberId) next.delete("as");
    else next.set("as", memberId);
    router.replace(`?${next.toString()}`, { scroll: false });
  }

  /** Runs a mutation with honest loading, success and failure states. */
  async function run(label: string, action: () => Promise<string | void>) {
    setPending(label);
    setActionError(null);
    setNotice(null);
    try {
      const message = await action();
      await refresh();
      if (message) setNotice(message);
    } catch (cause) {
      setActionError(cause instanceof ClientError ? cause.message : "That did not work. Try again.");
    } finally {
      setPending(null);
    }
  }

  function lightFacet(facet: number) {
    if (!bundle) return;
    if (!activeMember) {
      setActionError("Choose who is playing before lighting a facet.");
      return;
    }
    void run(`facet:${facet}`, async () => {
      const { ember } = await addEmber(bundle.round.id, {
        memberId: activeMember.id,
        kind: "spark",
        weight,
        facet,
      });
      return `${activeMember.displayName} lit facet ${facet} with ${ember.weight} fuel.`;
    });
  }

  function removeOne(emberId: string) {
    if (!bundle) return;
    void run(`delete:${emberId}`, async () => {
      await deleteEmber(bundle.round.id, emberId);
      return "Ember removed. It stays in the seal history as a tombstone.";
    });
  }

  function addPlayer(name: string, band: AgeBand) {
    if (!bundle) return;
    void run("add-member", async () => {
      await addMember(bundle.round.id, { displayName: name, ageBand: band, joinedVia: "host" });
      return `${name} joined the roster.`;
    });
  }

  function removePlayer(memberId: string, displayName: string) {
    if (!bundle) return;
    void run(`remove-member:${memberId}`, async () => {
      await removeMember(bundle.round.id, memberId);
      return `${displayName} was removed from the roster.`;
    });
  }

  function saveVoice(payload: { text: string; engine: string }) {
    if (!bundle || !activeMember) {
      setActionError("Choose who is playing before saving a voice ember.");
      return Promise.reject(new Error("No active player."));
    }
    // A voice ember still lights a facet: pick the dimmest one so the geometry
    // stays honest about how much fuel has actually been shared.
    const dimmest = facets.indexOf(Math.min(...facets));
    return run("voice", async () => {
      const { ember } = await addEmber(bundle.round.id, {
        memberId: activeMember.id,
        kind: "voice",
        weight: 2,
        facet: dimmest < 0 ? 0 : dimmest,
        transcript: payload.text,
        transcriptEngine: payload.engine,
      });
      return `Voice ember saved as facet ${ember.facet}.`;
    });
  }

  function destroy() {
    if (!bundle) return;
    void run("delete-round", async () => {
      await deleteRound(bundle.round.id, confirmCode);
      router.push("/round?deleted=1");
    });
  }

  /* ----------------------------- states ----------------------------- */

  if (loadState === "loading") {
    return (
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <p className="flex items-center gap-2 text-fog-200" role="status">
          <Loader2 size={16} className="animate-spin" aria-hidden="true" />
          Loading the round…
        </p>
      </div>
    );
  }

  if (loadState === "missing" || !bundle) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <h1 className="text-2xl font-semibold">That round is not here</h1>
        <p className="mt-3 text-fog-200">
          {loadError ??
            "Either it was deleted, or it belongs to a different browser session. Emberwake keeps rounds under an anonymous session cookie, so a round made in another browser is not visible here."}
        </p>
        <Link href="/round" className="btn btn-ember mt-6">
          Back to your rounds
        </Link>
      </div>
    );
  }

  const { round } = bundle;
  const joinUrl = `${SITE_URL}/join/${round.joinCode}`;
  const busy = pending !== null;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="datalabel">
            Round {round.joinCode} · {round.status}
          </p>
          <h1 className="mt-1 text-3xl font-semibold">{round.title}</h1>
          <p className="mt-1 text-sm text-fog-400">
            {round.placeLabel || "No place set"}
            {round.scheduledDate ? ` · ${round.scheduledDate}` : " · no date set"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/report?round=${round.id}`} className="btn btn-ghost">
            Full report
          </Link>
          <Link href={`/verify?round=${round.id}`} className="btn btn-ghost">
            Verify seals
          </Link>
        </div>
      </header>

      {/* Truthful feedback region for every mutation */}
      <div aria-live="polite" className="mt-4 grid gap-2">
        {actionError ? (
          <p className="flex items-start gap-2 rounded-xl border border-leftout/40 bg-leftout/10 p-3 text-sm text-fog-050">
            <TriangleAlert size={15} className="mt-0.5 shrink-0 text-leftout" aria-hidden="true" />
            {actionError}
          </p>
        ) : null}
        {notice ? (
          <p className="rounded-xl border border-reached/40 bg-reached/10 p-3 text-sm text-fog-050">{notice}</p>
        ) : null}
        {pending ? (
          <p className="flex items-center gap-2 rounded-xl border border-brass-500/30 p-3 text-sm text-fog-200">
            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
            Saving…
          </p>
        ) : null}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        {/* ---------------- 3D stage ---------------- */}
        <div className="slab overflow-hidden">
          <div className="h-[20rem] w-full sm:h-[26rem]">
            <BeaconStageCanvas
              facets={facets}
              members={bundle.members.map((m) => ({
                id: m.id,
                displayName: m.displayName,
                ageBand: m.ageBand,
                participation: bundle.embers.some((e) => e.memberId === m.id) ? 1 : 0,
              }))}
              activeMemberId={activeMemberId}
              sunrise={sky?.days.find((d) => d.date === round.scheduledDate)?.sunrise ?? null}
              sunset={sky?.days.find((d) => d.date === round.scheduledDate)?.sunset ?? null}
              timezone={sky?.timezone ?? "auto"}
              disabled={busy}
              onPickFacet={lightFacet}
              onSelectMember={(id) => selectMember(id)}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-brass-500/15 p-3">
            <p className="text-xs text-fog-400">
              {activeMember
                ? `${activeMember.displayName} is on turn. Click a facet of the beacon to light it.`
                : "Tap a spark on the headland to choose who is playing."}
            </p>
            <label className="flex items-center gap-2 text-xs text-fog-400">
              Fuel
              <input
                type="range"
                min={1}
                max={5}
                value={weight}
                onChange={(event) => setWeight(Number(event.target.value))}
                className="w-24 accent-[color:var(--color-ember-500)]"
                aria-label="Fuel to contribute, 1 to 5"
              />
              <span className="font-mono text-fog-050">{weight}</span>
            </label>
          </div>
        </div>

        {/* ---------------- HUD ---------------- */}
        <div className="grid gap-4">
          <div className="slab-flat p-5">
            {result ? (
              <>
                <ScoreDial value={result.overall} label="overall" />
                <p className="mt-2 text-sm font-medium text-ember-300">
                  {result.recommendation.headline}
                </p>
                <ul className="mt-3 grid gap-1.5">
                  {result.recommendation.actions.map((action) => (
                    <li key={action} className="text-sm text-fog-200">
                      · {action}
                    </li>
                  ))}
                </ul>
                <p className="mt-3 font-mono text-[0.65rem] text-fog-600">engine {result.version}</p>
              </>
            ) : null}
          </div>

          <div className="slab-flat p-5">
            <p className="datalabel">Who is playing</p>
            {bundle.members.length === 0 ? (
              <p className="mt-2 text-sm text-fog-200">
                The roster is empty. Add the people who are actually here — until then &ldquo;who was
                left out&rdquo; cannot be computed.
              </p>
            ) : (
              <ul className="mt-3 grid gap-2">
                {result?.contributions.map((row) => {
                  const member = bundle.members.find((m) => m.id === row.memberId);
                  if (!member) return null;
                  const selected = member.id === activeMemberId;
                  return (
                    <li key={member.id}>
                      <div
                        className={cn(
                          "flex items-center gap-2 rounded-xl border p-2 transition-colors",
                          selected
                            ? "border-ember-500/60 bg-ember-500/10"
                            : "border-tide-700 hover:border-brass-500/40",
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => selectMember(member.id)}
                          className="flex-1 text-left"
                          disabled={busy}
                        >
                          <span className="block text-sm font-medium text-fog-050">
                            {member.displayName}
                          </span>
                          <span className="block font-mono text-[0.65rem] text-fog-400">
                            {member.ageBand} · {member.joinedVia} · {row.embers} turn(s)
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => removePlayer(member.id, member.displayName)}
                          className="btn btn-danger px-3 py-1.5 text-xs"
                          disabled={busy}
                          aria-label={`Remove ${member.displayName} from the roster`}
                        >
                          Remove
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <AddPlayer onAdd={addPlayer} disabled={busy} />
          </div>

          <div className="slab-flat p-5">
            <FacetStrip facets={facets} />
          </div>
        </div>
      </div>

      {/* ---------------- Voice + invite + history ---------------- */}
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_0.85fr]">
        <div className="grid gap-4">
          <div>
            <p className="datalabel">Voice ember</p>
            <p className="mt-1 mb-3 text-sm text-fog-400">
              For whoever would rather talk than type. Transcribed on this device.
            </p>
            <VoiceEmber onSubmit={saveVoice} disabled={busy || !activeMember} />
          </div>

          <div className="slab-flat p-5">
            <p className="datalabel">Contributions</p>
            {bundle.embers.length === 0 ? (
              <p className="mt-2 text-sm text-fog-200">Nothing lit yet.</p>
            ) : (
              <ul className="mt-3 grid gap-1.5">
                {[...bundle.embers].reverse().map((ember) => {
                  const who = bundle.members.find((m) => m.id === ember.memberId);
                  return (
                    <li
                      key={ember.id}
                      className="flex items-start justify-between gap-3 rounded-lg border border-tide-800 p-2.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm text-fog-050">
                          {who?.displayName ?? "Removed player"} · facet {ember.facet} · {ember.weight}{" "}
                          fuel
                        </p>
                        {ember.transcript ? (
                          <p className="mt-1 text-xs text-fog-300">&ldquo;{ember.transcript}&rdquo;</p>
                        ) : null}
                        {ember.transcriptEngine ? (
                          <p className="mt-0.5 font-mono text-[0.6rem] text-fog-600">
                            {ember.transcriptEngine}
                          </p>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => removeOne(ember.id)}
                        className="btn btn-danger shrink-0 px-2.5 py-1 text-xs"
                        disabled={busy}
                        aria-label="Remove this ember"
                      >
                        <Trash2 size={12} aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <div className="grid content-start gap-4">
          <div className="slab-flat flex flex-col items-center gap-3 p-5">
            <p className="datalabel">Scan to join this round</p>
            <QrCode value={joinUrl} size={168} alt={`QR code joining round ${round.joinCode}`} />
            <p className="text-center font-mono text-xs text-fog-200">{joinUrl}</p>
            <p className="text-center text-xs text-fog-400">
              Code <span className="font-mono text-fog-200">{round.joinCode}</span> · works on any
              device, no install, no account.
            </p>
          </div>

          {result ? <LightPanel light={lightFromSky(sky, round.scheduledDate)} /> : null}

          {/*
            Shows the chain head only. It deliberately does NOT claim the chain
            is verified: replay is real work that belongs on /verify, where the
            verdict comes from recomputing every seal.
          */}
          {result ? (
            <div className="slab-flat p-4">
              <p className="datalabel">Current chain head</p>
              <p className="mt-2 break-all font-mono text-[0.7rem] text-fog-400">{result.seal}</p>
              <Link href={`/verify?round=${round.id}`} className="btn btn-ghost mt-3 text-xs">
                Replay and verify this chain
              </Link>
            </div>
          ) : null}

          <div className="slab-flat p-5">
            <p className="datalabel">Danger zone</p>
            {showDelete ? (
              <div className="mt-3">
                <p className="text-sm text-fog-200">
                  Deleting keeps the seal history so the round stays auditable, but removes it from
                  your list. Type the join code to confirm.
                </p>
                <input
                  className="field mt-2 font-mono"
                  placeholder={round.joinCode}
                  value={confirmCode}
                  onChange={(event) => setConfirmCode(event.target.value.toUpperCase())}
                  aria-label="Join code confirmation"
                />
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={destroy}
                    disabled={busy || confirmCode !== round.joinCode}
                  >
                    Delete this round
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => setShowDelete(false)}>
                    Keep it
                  </button>
                </div>
                {confirmCode.length > 0 && confirmCode !== round.joinCode ? (
                  <p className="mt-2 text-xs text-leftout">
                    That does not match this round&apos;s join code.
                  </p>
                ) : null}
              </div>
            ) : (
              <button
                type="button"
                className="btn btn-danger mt-3"
                onClick={() => setShowDelete(true)}
                disabled={busy}
              >
                <Trash2 size={14} aria-hidden="true" />
                Delete this round
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ---------------- Full breakdown ---------------- */}
      {result ? (
        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <div className="slab-flat p-5">
            <p className="datalabel">Factor breakdown</p>
            <div className="mt-4">
              <FactorBars factors={result.factors} />
            </div>
          </div>
          <div className="grid content-start gap-4">
            <div className="slab-flat p-5">
              <p className="datalabel">Participation</p>
              <div className="mt-3">
                <ContributionTable contributions={result.contributions} />
              </div>
            </div>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() =>
                void run("re-analyze", async () => {
                  await analyzeRound(round.id, { record: true });
                  return "Analysis re-run and recorded in the seal chain.";
                })
              }
              disabled={busy}
            >
              Re-run analysis and record it
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AddPlayer({ onAdd, disabled }: { onAdd: (name: string, band: AgeBand) => void; disabled: boolean }) {
  const [name, setName] = useState("");
  const [band, setBand] = useState<AgeBand>("adult");

  return (
    <form
      className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_auto]"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim().length === 0) return;
        onAdd(name.trim(), band);
        setName("");
      }}
    >
      <label className="sr-only" htmlFor="new-player">
        Player name
      </label>
      <input
        id="new-player"
        className="field"
        placeholder="Add a player"
        value={name}
        onChange={(event) => setName(event.target.value)}
        maxLength={60}
      />
      <label className="sr-only" htmlFor="new-player-band">
        Age band
      </label>
      <select
        id="new-player-band"
        className="field"
        value={band}
        onChange={(event) => setBand(event.target.value as AgeBand)}
      >
        {AGE_BANDS.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
      <button type="submit" className="btn btn-ghost" disabled={disabled || name.trim().length === 0}>
        <Users size={14} aria-hidden="true" />
        Add
      </button>
    </form>
  );
}

/** Projects a sky envelope into the shape `LightPanel` expects. */
function lightFromSky(sky: SkyEnvelope | null, scheduledDate: string | null) {
  const day = sky && scheduledDate ? sky.days.find((d) => d.date === scheduledDate) : undefined;
  return {
    status: sky?.status ?? ("fallback" as const),
    sunrise: day?.sunrise ?? null,
    sunset: day?.sunset ?? null,
    daylightMinutes: day?.daylightMinutes ?? null,
    timezone: sky?.timezone ?? "unknown",
    placeLabel: sky?.placeLabel ?? "",
    fetchedAt: sky?.fetchedAt ?? null,
    source: sky?.source ?? null,
    note: sky?.note ?? null,
  };
}