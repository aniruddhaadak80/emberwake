"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, TriangleAlert, Users } from "lucide-react";
import { addMember, ClientError, getJoinInfo } from "@/lib/client";
import { AGE_BANDS, type AgeBand } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * The page a QR code lands on.
 *
 * This is the whole join job-to-be-done: scan, type a name, play. No install, no
 * account, no app store. If anything here fails it says so, because a scanned
 * code that lands on an error page is the single most likely way this feature
 * gets abandoned.
 */
export function JoinRound({ code }: { code: string }) {
  const router = useRouter();
  const normalised = code.toUpperCase();

  const [info, setInfo] = useState<Awaited<ReturnType<typeof getJoinInfo>> | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [band, setBand] = useState<AgeBand>("adult");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await getJoinInfo(normalised);
        if (cancelled) return;
        setInfo(result);
        setState("ready");
      } catch (cause) {
        if (cancelled) return;
        setError(
          cause instanceof ClientError ? cause.message : "Could not look up that code.",
        );
        setState(cause instanceof ClientError && cause.status === 404 ? "missing" : "error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [normalised]);

  async function join() {
    if (name.trim().length === 0) return;
    setJoining(true);
    setJoinError(null);
    try {
      // Posting against the *join code* is what marks this browser as a player.
      const result = await addMember(normalised, {
        displayName: name.trim(),
        ageBand: band,
        joinedVia: "qr",
      });
      router.push(`/round/${result.roundId}`);
    } catch (cause) {
      setJoinError(
        cause instanceof ClientError ? cause.message : "Could not join that round. Try again.",
      );
      setJoining(false);
    }
  }

  if (state === "loading") {
    return (
      <p className="flex items-center gap-2 text-fog-200" role="status">
        <Loader2 size={16} className="animate-spin" aria-hidden="true" />
        Looking up round {normalised}…
      </p>
    );
  }

  if (state === "missing" || state === "error" || !info) {
    return (
      <div className="slab-flat p-6">
        <h1 className="text-xl font-semibold">That code did not work</h1>
        <p className="mt-2 text-sm text-fog-200">{error}</p>
        <p className="mt-3 text-sm text-fog-400">
          Ask the host for a fresh QR code. Codes stop working when a round is deleted.
        </p>
        <Link href="/" className="btn btn-ghost mt-5">
          Go to the start
        </Link>
      </div>
    );
  }

  const { round, alreadyPlaying } = info;
  const closed = round.status === "closed";

  return (
    <div className="mx-auto max-w-xl px-4 py-10 sm:px-6">
      <div className="slab p-6">
        <p className="datalabel">You were invited · code {round.joinCode}</p>
        <h1 className="mt-2 text-2xl font-semibold">{round.title}</h1>
        <p className="mt-1 text-sm text-fog-400">
          {round.placeLabel || "No place set"}
          {round.scheduledDate ? ` · ${round.scheduledDate}` : ""}
        </p>

        {alreadyPlaying.length > 0 ? (
          <div className="mt-5">
            <p className="datalabel">Already playing</p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {alreadyPlaying.map((player) => (
                <li
                  key={player.displayName}
                  className="rounded-full border border-tide-700 px-2.5 py-1 text-xs text-fog-200"
                >
                  {player.displayName}
                  <span className="ml-1.5 font-mono text-[0.6rem] text-fog-600">
                    {player.ageBand}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {closed ? (
          <p className="mt-5 flex items-start gap-2 rounded-xl border border-brass-500/40 bg-brass-500/10 p-3 text-sm">
            <TriangleAlert size={15} className="mt-0.5 shrink-0 text-brass-400" aria-hidden="true" />
            The host has closed this round, so you cannot join it any more.
          </p>
        ) : (
          <form
            className="mt-6"
            onSubmit={(event) => {
              event.preventDefault();
              void join();
            }}
          >
            <label htmlFor="join-name" className="datalabel">
              Your name
            </label>
            <input
              id="join-name"
              className="field mt-1.5"
              placeholder="Aunty Maya"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={60}
              autoComplete="name"
            />

            <label htmlFor="join-band" className="datalabel mt-4 block">
              Age band
            </label>
            <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label="Age band">
              {AGE_BANDS.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setBand(value)}
                  aria-pressed={band === value}
                  className={cn(
                    "rounded-full px-3 py-1.5 font-mono text-xs uppercase tracking-wider transition-colors",
                    band === value
                      ? "bg-ember-500/20 text-ember-300"
                      : "border border-tide-700 text-fog-400 hover:text-fog-050",
                  )}
                >
                  {value}
                </button>
              ))}
            </div>

            {joinError ? (
              <p className="mt-3 rounded-xl border border-leftout/40 bg-leftout/10 p-3 text-sm">
                {joinError}
              </p>
            ) : null}

            <button
              type="submit"
              className="btn btn-ember mt-5 w-full"
              disabled={joining || name.trim().length === 0}
            >
              {joining ? (
                <Loader2 size={15} className="animate-spin" aria-hidden="true" />
              ) : (
                <Users size={15} aria-hidden="true" />
              )}
              {joining ? "Joining…" : "Join the round"}
            </button>
            <p className="mt-3 text-xs text-fog-400">
              No account, no install. You will be able to light facets on this device, but not change
              or delete the round — that stays with the host.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}