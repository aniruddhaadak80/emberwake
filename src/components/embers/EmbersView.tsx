"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Mic, Square, TriangleAlert } from "lucide-react";
import { getRoundBundle, listRounds, ClientError } from "@/lib/client";
import type { Ember, Member, Round } from "@/lib/types";
import { formatWhen } from "@/lib/utils";

/**
 * The ember log.
 *
 * Everything that has actually been said and lit, in order, with the provenance of
 * each voice ember. This is the page that answers "what did we actually say on
 * Thursday?" — which is the thing a family group chat loses within a day.
 */
export function EmbersView() {
  const [rounds, setRounds] = useState<Round[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [embers, setEmbers] = useState<Ember[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const page = await listRounds({ limit: 50 });
        setRounds(page.rounds);
        if (page.rounds.length > 0) setSelected(page.rounds[0].id);
      } catch {
        setRounds([]);
      }
    })();
  }, []);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    // The "loading" state is set by the event that changes `selected`; writing it
    // here as well would be a synchronous state update in an effect body.
    (async () => {
      try {
        const { bundle } = await getRoundBundle(selected);
        if (cancelled) return;
        setEmbers(bundle?.embers ?? []);
        setMembers(bundle?.members ?? []);
        setState("ready");
        setError(null);
      } catch (cause) {
        if (cancelled) return;
        setError(cause instanceof ClientError ? cause.message : "Could not load that round.");
        setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const voices = embers.filter((e) => e.transcript);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="embers-round" className="datalabel">
          Round
        </label>
        <select
          id="embers-round"
          className="field max-w-xs"
          value={selected ?? ""}
          onChange={(event) => {
            setState("loading");
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
            Loading…
          </span>
        ) : null}
      </div>

      {rounds.length === 0 && state !== "loading" ? (
        <div className="slab-flat mt-6 p-6">
          <p className="text-sm text-fog-200">
            No rounds in this session yet. Once a round exists, every contribution and every
            transcribed voice memo shows up here in order.
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

      {state === "ready" && embers.length === 0 ? (
        <div className="slab-flat mt-6 p-6">
          <p className="text-sm text-fog-200">
            Nothing has been lit in this round yet. Open it and tap a facet of the beacon.
          </p>
        </div>
      ) : null}

      {state === "ready" && embers.length > 0 ? (
        <>
          <p className="mt-6 text-sm text-fog-400">
            {embers.length} contribution(s) · {voices.length} voice ember(s)
          </p>

          <ol className="mt-4 grid gap-2">
            {embers.map((ember) => {
              const who = members.find((m) => m.id === ember.memberId);
              return (
                <li key={ember.id} className="slab-flat flex gap-3 p-3">
                  <span
                    aria-hidden="true"
                    className={
                      ember.kind === "voice"
                        ? "mt-0.5 shrink-0 text-ember-400"
                        : "mt-0.5 shrink-0 text-fog-600"
                    }
                  >
                    {ember.kind === "voice" ? <Mic size={15} /> : <Square size={12} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-fog-050">
                      {who?.displayName ?? "Removed player"}
                      <span className="ml-2 font-mono text-[0.65rem] text-fog-600">
                        facet {ember.facet} · {ember.weight} fuel · {ember.kind}
                      </span>
                    </p>
                    {ember.transcript ? (
                      <p className="mt-1.5 text-sm leading-relaxed text-fog-100">
                        &ldquo;{ember.transcript}&rdquo;
                      </p>
                    ) : ember.note ? (
                      <p className="mt-1.5 text-sm text-fog-200">{ember.note}</p>
                    ) : null}
                    <p className="mt-1.5 font-mono text-[0.6rem] text-fog-600">
                      {formatWhen(ember.createdAt)}
                      {ember.transcriptEngine ? ` · ${ember.transcriptEngine}` : ""}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      ) : null}
    </div>
  );
}