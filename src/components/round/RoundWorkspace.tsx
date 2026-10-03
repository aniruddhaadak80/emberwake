"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, MapPin, Plus, Search, TriangleAlert } from "lucide-react";
import { ClientError, createRound, geocodePlace, listRounds } from "@/lib/client";
import type { Round } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * The round workspace: your rounds, and the form that makes a new one.
 *
 * The status filter lives in the URL, so a filtered list survives a refresh and
 * can be sent to somebody as a link.
 */
export function RoundWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const status = searchParams.get("status") ?? "all";
  const deleted = searchParams.get("deleted") === "1";

  const [rounds, setRounds] = useState<Round[]>([]);
  const [total, setTotal] = useState(0);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // The fetch lives in an async callback rather than in a directly-called
    // function, so the effect body itself performs no synchronous state write.
    // State already starts as "loading" and the filter buttons set their own.
    (async () => {
      try {
        const page = await listRounds({ status, limit: 50 });
        if (cancelled) return;
        setRounds(page.rounds);
        setTotal(page.total);
        setState("ready");
        setError(null);
      } catch (cause) {
        if (cancelled) return;
        setError(cause instanceof ClientError ? cause.message : "Could not load your rounds.");
        setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status]);

  function setStatus(next: string) {
    if (next !== status) setState("loading");
    const params = new URLSearchParams(searchParams.toString());
    if (next === "all") params.delete("status");
    else params.set("status", next);
    router.replace(`/round${params.toString() ? `?${params.toString()}` : ""}`, { scroll: false });
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      {deleted ? (
        <p className="mb-4 rounded-xl border border-brass-500/40 bg-brass-500/10 p-3 text-sm text-fog-050">
          That round was deleted. Its seal history was kept, so the record stays verifiable.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="datalabel">{total} round(s)</p>
          <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Filter rounds by status">
            {["all", "open", "lit", "closed"].map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setStatus(value)}
                aria-pressed={status === value}
                className={cn(
                  "rounded-full px-3 py-1.5 font-mono text-xs uppercase tracking-wider transition-colors",
                  status === value
                    ? "bg-ember-500/20 text-ember-300"
                    : "border border-tide-700 text-fog-400 hover:text-fog-050",
                )}
              >
                {value}
              </button>
            ))}
          </div>
        </div>

        <button type="button" className="btn btn-ember" onClick={() => setShowForm((v) => !v)}>
          <Plus size={15} aria-hidden="true" />
          New round
        </button>
      </div>

      {showForm ? (
        <div className="mt-5">
          <CreateRoundForm
            onCreated={(roundId) => {
              setShowForm(false);
              router.push(`/round/${roundId}`);
            }}
            onCancelled={() => setShowForm(false)}
          />
        </div>
      ) : null}

      <div className="mt-6">
        {state === "loading" ? (
          <p className="flex items-center gap-2 text-fog-200" role="status">
            <Loader2 size={15} className="animate-spin" aria-hidden="true" />
            Loading your rounds…
          </p>
        ) : null}

        {state === "error" ? (
          <p className="flex items-start gap-2 rounded-xl border border-leftout/40 bg-leftout/10 p-3 text-sm">
            <TriangleAlert size={15} className="mt-0.5 shrink-0 text-leftout" aria-hidden="true" />
            {error}
          </p>
        ) : null}

        {state === "ready" && rounds.length === 0 ? (
          <div className="slab-flat p-6">
            <p className="text-sm text-fog-200">
              {status === "all"
                ? "You have not made a round yet. Create one and you will get a QR code to hand out."
                : `No rounds with the status "${status}".`}
            </p>
            {status !== "all" ? (
              <button type="button" className="btn btn-ghost mt-4" onClick={() => setStatus("all")}>
                Show all rounds
              </button>
            ) : null}
          </div>
        ) : null}

        {state === "ready" && rounds.length > 0 ? (
          <ul className="grid gap-3 md:grid-cols-2">
            {rounds.map((round) => (
              <li key={round.id}>
                <Link href={`/round/${round.id}`} className="slab-flat block p-4 transition-colors hover:border-brass-500/50">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-base font-medium text-fog-050">{round.title}</p>
                      <p className="mt-1 text-xs text-fog-400">
                        {round.placeLabel || "No place"} · {round.scheduledDate ?? "no date"}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 font-mono text-[0.6rem] uppercase tracking-wider",
                        round.status === "open"
                          ? "bg-reached/15 text-reached"
                          : round.status === "lit"
                            ? "bg-ember-500/20 text-ember-300"
                            : "bg-tide-700 text-fog-400",
                      )}
                    >
                      {round.status}
                    </span>
                  </div>
                  <p className="mt-3 font-mono text-xs text-fog-400">
                    code {round.joinCode} · created {round.createdAt.slice(0, 10)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Creates a round.
 *
 * The place field performs a real geocode lookup against Open-Meteo, because the
 * round's daylight advice is only meaningful with real coordinates. A lookup that
 * fails is reported rather than silently storing an empty location.
 */
function CreateRoundForm({
  onCreated,
  onCancelled,
}: {
  onCreated: (roundId: string) => void;
  onCancelled: () => void;
}) {
  const [title, setTitle] = useState("");
  const [place, setPlace] = useState("");
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [date, setDate] = useState("");
  const [looking, setLooking] = useState(false);
  const [lookupMessage, setLookupMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function lookup() {
    if (place.trim().length < 2) return;
    setLooking(true);
    setLookupMessage(null);
    try {
      const result = await geocodePlace(place.trim());
      setCoords({ latitude: result.place.latitude, longitude: result.place.longitude });
      setPlace(result.place.label);
      setLookupMessage(`Found ${result.place.label}. Daylight will use real sunrise and sunset.`);
    } catch (cause) {
      setCoords(null);
      setLookupMessage(
        cause instanceof ClientError ? cause.message : "That place could not be looked up.",
      );
    } finally {
      setLooking(false);
    }
  }

  async function submit() {
    if (title.trim().length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const { round } = await createRound({
        title: title.trim(),
        placeLabel: place.trim(),
        latitude: coords?.latitude ?? null,
        longitude: coords?.longitude ?? null,
        scheduledDate: date || null,
      });
      onCreated(round.id);
    } catch (cause) {
      setError(cause instanceof ClientError ? cause.message : "Could not create that round.");
      setSaving(false);
    }
  }

  return (
    <div className="slab p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="round-title" className="datalabel">
            What is this round?
          </label>
          <input
            id="round-title"
            className="field mt-1.5"
            placeholder="Diwali Thursday"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={80}
          />
        </div>

        <div>
          <label htmlFor="round-date" className="datalabel">
            Planned date
          </label>
          <input
            id="round-date"
            type="date"
            className="field mt-1.5"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="round-place" className="datalabel">
            Where? (real sunrise and sunset)
          </label>
          <div className="mt-1.5 flex gap-2">
            <input
              id="round-place"
              className="field"
              placeholder="Kolkata"
              value={place}
              onChange={(event) => {
                setPlace(event.target.value);
                setCoords(null);
              }}
              maxLength={80}
            />
            <button
              type="button"
              className="btn btn-ghost shrink-0"
              onClick={lookup}
              disabled={looking || place.trim().length < 2}
            >
              {looking ? (
                <Loader2 size={14} className="animate-spin" aria-hidden="true" />
              ) : (
                <Search size={14} aria-hidden="true" />
              )}
              Look up
            </button>
          </div>
          {lookupMessage ? (
            <p className="mt-1.5 text-xs text-fog-400">{lookupMessage}</p>
          ) : null}
        </div>
      </div>

      {error ? (
        <p className="mt-3 rounded-xl border border-leftout/40 bg-leftout/10 p-3 text-sm">{error}</p>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-ember"
          onClick={submit}
          disabled={saving || title.trim().length === 0}
        >
          {saving ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Plus size={15} aria-hidden="true" />}
          Create round
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancelled} disabled={saving}>
          Cancel
        </button>
      </div>

      <p className="mt-3 flex items-start gap-2 text-xs text-fog-600">
        <MapPin size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
        Place and date are optional, but without them Emberwake cannot tell you whether playing
        outside was ever a good idea.
      </p>
    </div>
  );
}