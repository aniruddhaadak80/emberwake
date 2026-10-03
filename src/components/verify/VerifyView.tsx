"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Loader2, TriangleAlert, XCircle } from "lucide-react";
import { ClientError, listRounds, verifyRound } from "@/lib/client";
import type { Round } from "@/lib/types";

type Replay = Awaited<ReturnType<typeof verifyRound>>;

/**
 * Integrity replay.
 *
 * Recomputes the whole SHA-384 chain from the genesis value and reports the first
 * broken link, rather than only saying whether it passed. The formula is printed
 * on the page so the reader can verify a seal independently instead of trusting
 * this endpoint.
 */
export function VerifyView() {
  const searchParams = useSearchParams();
  const roundParam = searchParams.get("round");

  const [rounds, setRounds] = useState<Round[]>([]);
  const [selected, setSelected] = useState<string | null>(roundParam);
  const [data, setData] = useState<Replay | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const page = await listRounds({ limit: 50 });
        setRounds(page.rounds);
        if (!roundParam && page.rounds.length > 0) setSelected(page.rounds[0].id);
      } catch {
        setRounds([]);
      }
    })();
  }, [roundParam]);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    // "loading" is set by the picker below rather than here, to avoid a
    // synchronous state update inside the effect body.
    (async () => {
      try {
        const result = await verifyRound(selected);
        if (cancelled) return;
        setData(result);
        setState("ready");
      } catch (cause) {
        if (cancelled) return;
        setError(cause instanceof ClientError ? cause.message : "Could not replay that chain.");
        setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="verify-round" className="datalabel">
          Round
        </label>
        <select
          id="verify-round"
          className="field max-w-xs"
          value={selected ?? ""}
          onChange={(event) => {
            setState("loading");
            setError(null);
            setSelected(event.target.value || null);
          }}
          disabled={rounds.length === 0}
        >
          {rounds.length === 0 ? <option value="">No rounds yet</option> : null}
          {rounds.map((round) => (
            <option key={round.id} value={round.id}>
              {round.title} · {round.joinCode}
            </option>
          ))}
        </select>
        {state === "loading" ? (
          <span className="flex items-center gap-2 text-sm text-fog-200" role="status">
            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
            Replaying…
          </span>
        ) : null}
      </div>

      {rounds.length === 0 && state !== "loading" ? (
        <div className="slab-flat mt-6 p-6">
          <p className="text-sm text-fog-200">
            No rounds in this session, so there is nothing to replay yet. A chain is built as you
            play — every create, contribution and delete adds one sealed event.
          </p>
          <Link href="/round" className="btn btn-ember mt-4">
            Start a round
          </Link>
        </div>
      ) : null}

      {state === "error" ? (
        <p className="mt-6 flex items-start gap-2 rounded-xl border border-leftout/40 bg-leftout/10 p-3 text-sm">
          <TriangleAlert size={15} className="mt-0.5 shrink-0 text-leftout" aria-hidden="true" />
          {error}
        </p>
      ) : null}

      {data && state === "ready" ? (
        <>
          <div
            className={`mt-6 flex items-start gap-3 rounded-xl border p-4 ${
              data.replay.ok ? "border-reached/40 bg-reached/10" : "border-leftout/50 bg-leftout/10"
            }`}
            role="status"
          >
            {data.replay.ok ? (
              <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-reached" aria-hidden="true" />
            ) : (
              <XCircle size={18} className="mt-0.5 shrink-0 text-leftout" aria-hidden="true" />
            )}
            <div>
              <p className="text-sm font-medium text-fog-050">
                {data.replay.ok
                  ? `Chain verified: ${data.replay.events} events, no broken link`
                  : `Chain broken at event ${data.replay.brokenAt?.seq}`}
              </p>
              <p className="mt-1 break-all font-mono text-xs text-fog-400">
                genesis {data.replay.genesis} → head {data.replay.head ?? "none"}
              </p>
              {data.replay.brokenAt ? (
                <div className="mt-2 break-all font-mono text-xs text-leftout">
                  <p>expected {data.replay.brokenAt.expected}</p>
                  <p>stored {data.replay.brokenAt.actual}</p>
                </div>
              ) : null}
              {data.replay.tombstones > 0 ? (
                <p className="mt-1 text-xs text-fog-400">
                  {data.replay.tombstones} deletion tombstone(s) retained so deleted rounds stay
                  replayable.
                </p>
              ) : null}
            </div>
          </div>

          <div className="slab-flat mt-4 p-4">
            <p className="datalabel">How each seal is computed</p>
            <code className="mt-2 block overflow-x-auto font-mono text-xs text-ember-300">
              {data.formula}
            </code>
            <p className="mt-2 text-xs leading-relaxed text-fog-400">
              Object keys are sorted recursively before hashing, so the same event always produces
              the same bytes no matter what order a client sent the fields in. Change one historical
              row directly in the database and every seal after it fails to recompute.
            </p>
          </div>

          <div className="mt-6">
            <p className="datalabel">Recent sealed events (newest first)</p>
            {data.recent.length === 0 ? (
              <p className="mt-2 text-sm text-fog-400">No events recorded for this round yet.</p>
            ) : (
              <ol className="mt-3 grid gap-2">
                {data.recent.map((event) => (
                  <li key={`${event.seq}-${event.seal}`} className="slab-flat p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-sm text-ember-300">#{event.seq} {event.action}</span>
                      <span className="font-mono text-[0.65rem] text-fog-600">
                        {event.createdAt.slice(0, 19).replace("T", " ")}Z
                      </span>
                    </div>
                    <p className="mt-1 break-all font-mono text-[0.65rem] text-fog-400">
                      seal {event.seal}
                    </p>
                    <p className="mt-0.5 break-all font-mono text-[0.6rem] text-fog-600">
                      prev {event.prevSeal}
                    </p>
                    {Object.keys(event.payload).length > 0 ? (
                      <pre className="mt-2 overflow-auto whitespace-pre-wrap font-mono text-[0.6rem] text-fog-400">
                        {JSON.stringify(event.payload, null, 2)}
                      </pre>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}