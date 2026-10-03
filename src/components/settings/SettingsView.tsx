"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CircleCheck, CircleX, Loader2 } from "lucide-react";
import { GithubMark } from "@/components/site/GithubMark";
import { InstallButton } from "@/components/InstallButton";
import { fetchSky } from "@/lib/client";
import { SITE_URL, site } from "@/config/site";
import type { HealthReport } from "@/lib/types";

/**
 * Settings and runtime status.
 *
 * Everything on this page is measured live: the datastore check is a real query,
 * the daylight row is a real Open-Meteo response, and the tool count comes from
 * the agent endpoint's own discovery document. Nothing here is a hard-coded
 * badge.
 */
export function SettingsView() {
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [healthState, setHealthState] = useState<"loading" | "ready">("loading");
  const [sky, setSky] = useState<{ status: string; note: string | null; day: string } | null>(null);
  const [toolCount, setToolCount] = useState<number | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/health", { cache: "no-store" });
        setHealth((await response.json()) as HealthReport);
      } catch {
        setHealth(null);
      } finally {
        setHealthState("ready");
      }

      try {
        const discovery = (await (await fetch("/api/mcp")).json()) as { tools?: unknown[] };
        setToolCount(Array.isArray(discovery.tools) ? discovery.tools.length : null);
      } catch {
        setToolCount(null);
      }

      try {
        // Probe a real place so the daylight row is genuine, not illustrative.
        const envelope = await fetchSky({
          lat: 51.5074,
          lng: -0.1278,
          place: "London",
          date: new Date().toISOString().slice(0, 10),
        });
        const day = envelope.days[0];
        setSky({
          status: envelope.status,
          note: envelope.note ?? null,
          day: day
            ? `${day.date}: sunrise ${day.sunrise.slice(11)}, sunset ${day.sunset.slice(11)} (${day.daylightMinutes} min)`
            : "no data",
        });
      } catch {
        setSky(null);
      }
    })();
  }, []);

  const healthy = health?.status === "ok" && health.store.reachable;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <section className="slab-flat p-5">
        <p className="datalabel">Runtime status</p>
        {healthState === "loading" ? (
          <p className="mt-3 flex items-center gap-2 text-sm text-fog-200" role="status">
            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
            Checking the datastore…
          </p>
        ) : (
          <ul className="mt-3 grid gap-2.5">
            <StatusRow
              label="Datastore"
              ok={Boolean(healthy)}
              value={
                health
                  ? `${health.store.adapter} · ${healthy ? "reachable" : "unreachable"}`
                  : "no response"
              }
              detail={health?.store.detail}
            />
            <StatusRow
              label="Engine"
              ok={Boolean(health?.engine.version)}
              value={health?.engine.version ?? "unknown"}
              detail="The version the scores are computed by."
            />
            <StatusRow
              label="Agent tools"
              ok={toolCount !== null}
              value={toolCount === null ? "unreachable" : `${toolCount} published`}
              detail="Discovered from GET /api/mcp."
            />
            <StatusRow
              label="Live daylight"
              ok={sky?.status === "live"}
              value={sky ? sky.status : "no response"}
              detail={sky ? `${sky.day}${sky.note ? ` — ${sky.note}` : ""}` : undefined}
            />
          </ul>
        )}
      </section>

      <section className="slab-flat mt-4 p-5">
        <p className="datalabel">About this build</p>
        <dl className="mt-3 grid gap-2.5 text-sm">
          <Row label="Product" value={site.name} />
          <Row label="Live app" value={SITE_URL} />
          <Row label="Agent endpoint" value={`${SITE_URL}/api/mcp`} />
          <Row label="Repository" value={site.repoUrl} />
          <Row label="License" value="MIT" />
        </dl>
        <a
          href={site.repoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-ghost mt-4"
          aria-label="View the Emberwake source on GitHub — opens in a new tab"
        >
          <GithubMark />
          View source
        </a>
      </section>

      <section className="slab-flat mt-4 p-5">
        <p className="datalabel">Install</p>
        <p className="mt-2 text-sm text-fog-200">
          Emberwake is one codebase that runs as a Progressive Web App in any browser and is
          configured with Capacitor for native Android, iOS, Windows and Mac builds. There is no
          store binary published from this repository, and this page does not pretend otherwise.
        </p>
        <div className="mt-4">
          <InstallButton />
        </div>
      </section>

      <section className="slab-flat mt-4 p-5">
        <p className="datalabel">Privacy</p>
        <ul className="mt-3 grid gap-1.5 text-sm text-fog-200">
          <li>· No account. Rounds belong to an anonymous browser session cookie.</li>
          <li>· Voice is recorded and transcribed in your browser; audio is never uploaded.</li>
          <li>· Only the place name, coordinates and date you type are sent to Open-Meteo.</li>
          <li>· Deleting a round keeps its seal history so it stays verifiable, not readable.</li>
        </ul>
      </section>

      <section className="mt-4 rounded-xl border border-brass-500/30 p-4">
        <p className="text-sm text-fog-200">
          <strong className="text-fog-050">Emberwake is a family game.</strong> It reports how
          people spent time together. It is not medical, psychological, legal or financial advice,
          and a low Balance score is an observation about one evening, not about anybody.
        </p>
        <Link href="/report" className="btn btn-ghost mt-3">
          Open a round report
        </Link>
      </section>
    </div>
  );
}

function StatusRow({
  label,
  ok,
  value,
  detail,
}: {
  label: string;
  ok: boolean;
  value: string;
  detail?: string;
}) {
  return (
    <li className="flex items-start gap-2.5">
      {ok ? (
        <CircleCheck size={16} className="mt-0.5 shrink-0 text-reached" aria-hidden="true" />
      ) : (
        <CircleX size={16} className="mt-0.5 shrink-0 text-brass-400" aria-hidden="true" />
      )}
      <div className="min-w-0">
        <p className="text-sm text-fog-050">
          <span className="font-mono text-xs text-fog-400">{label}</span> — {value}
        </p>
        {detail ? <p className="mt-0.5 text-xs text-fog-400">{detail}</p> : null}
      </div>
    </li>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-2 border-b border-tide-800/70 pb-2">
      <dt className="datalabel">{label}</dt>
      <dd className="break-all font-mono text-xs text-fog-100">{value}</dd>
    </div>
  );
}