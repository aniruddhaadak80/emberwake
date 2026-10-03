/**
 * Report panels.
 *
 * Server-safe presentational components shared by the round page, the report
 * route, the agent console output and the export. They take already-computed
 * values and never recompute a score, so the HUD and the report cannot drift.
 */

import type { EngineFactor, MemberContribution } from "@/lib/types";
import type { ReportPayload } from "@/lib/report";
import { cn } from "@/lib/utils";

/** Wide mono number used for every headline metric. */
export function ScoreDial({ value, label, size = "lg" }: { value: number; label: string; size?: "lg" | "sm" }) {
  const clamped = Math.max(0, Math.min(100, value));
  const tone =
    clamped >= 75 ? "text-reached" : clamped >= 45 ? "text-brass-400" : "text-leftout";

  return (
    <div className="flex items-baseline gap-2">
      <span
        className={cn(
          "font-mono font-semibold tabular-nums",
          tone,
          size === "lg" ? "text-5xl" : "text-2xl",
        )}
      >
        {Math.round(clamped)}
      </span>
      <span className="datalabel">{label}</span>
    </div>
  );
}

export function FactorBars({ factors }: { factors: EngineFactor[] }) {
  return (
    <ul className="grid gap-3">
      {factors.map((factor) => {
        const clamped = Math.max(0, Math.min(100, factor.score));
        const bar =
          clamped >= 75 ? "bg-reached" : clamped >= 45 ? "bg-brass-500" : "bg-leftout";
        return (
          <li key={factor.id}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-medium text-fog-050">
                {factor.label}
                <span className="ml-2 font-mono text-[0.65rem] text-fog-600">
                  weight {factor.weight.toFixed(2)}
                </span>
              </span>
              <span className="font-mono text-sm tabular-nums text-fog-200">
                {Math.round(clamped)}
              </span>
            </div>
            <div
              className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-tide-800"
              role="img"
              aria-label={`${factor.label}: ${Math.round(clamped)} out of 100`}
            >
              <div
                className={cn("h-full rounded-full transition-[width] duration-500", bar)}
                style={{ width: `${clamped}%` }}
              />
            </div>
            <p className="mt-1.5 text-sm text-fog-200">{factor.detail}</p>
            {factor.evidence.length > 0 ? (
              <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                {factor.evidence.map((line) => (
                  <li key={line} className="font-mono text-[0.7rem] text-fog-400">
                    {line}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Who actually played.
 *
 * Members who never contributed are shown explicitly and in a distinct colour.
 * Hiding them behind a count would defeat the entire purpose of the product.
 */
export function ContributionTable({ contributions }: { contributions: MemberContribution[] }) {
  if (contributions.length === 0) {
    return (
      <p className="rounded-xl border border-brass-500/25 bg-tide-900/60 p-4 text-sm text-fog-200">
        Nobody is on the roster yet. Add the people who are actually playing and the fairness
        numbers will start to mean something.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[26rem] border-collapse text-left">
        <thead>
          <tr className="border-b border-brass-500/20">
            <th scope="col" className="datalabel py-2">Player</th>
            <th scope="col" className="datalabel py-2">Age band</th>
            <th scope="col" className="datalabel py-2 text-right">Turns</th>
            <th scope="col" className="datalabel py-2 text-right">Fuel</th>
            <th scope="col" className="datalabel py-2 text-right">Share</th>
            <th scope="col" className="datalabel py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {contributions.map((row) => (
            <tr key={row.memberId} className="border-b border-tide-800/70">
              <th scope="row" className="py-2.5 pr-3 text-sm font-medium text-fog-050">
                {row.displayName}
              </th>
              <td className="py-2.5 pr-3 text-sm text-fog-400">{row.ageBand}</td>
              <td className="py-2.5 pr-3 text-right font-mono text-sm tabular-nums text-fog-200">
                {row.embers}
              </td>
              <td className="py-2.5 pr-3 text-right font-mono text-sm tabular-nums text-fog-200">
                {row.fuel}
              </td>
              <td className="py-2.5 pr-3 text-right font-mono text-sm tabular-nums text-fog-200">
                {Math.round(row.share * 100)}%
              </td>
              <td className="py-2.5">
                {row.participation > 0 ? (
                  <span className="rounded-full bg-reached/15 px-2 py-0.5 font-mono text-[0.65rem] uppercase tracking-wider text-reached">
                    played
                  </span>
                ) : (
                  <span className="rounded-full bg-leftout/15 px-2 py-0.5 font-mono text-[0.65rem] uppercase tracking-wider text-leftout">
                    left out
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Live vs offline labelling for external data.
 *
 * `fallback` is deliberately loud. A sealed sample must never read as today's
 * real light.
 */
export function LightPanel({ light }: { light: ReportPayload["light"] }) {
  const live = light.status === "live";
  return (
    <div className="slab-flat p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="datalabel">Daylight on the day</p>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 font-mono text-[0.65rem] uppercase tracking-wider",
            live ? "bg-reached/15 text-reached" : "bg-brass-500/15 text-brass-400",
          )}
        >
          {live ? "live data" : "offline sample"}
        </span>
      </div>

      {light.sunrise && light.sunset ? (
        <>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <div>
              <p className="datalabel">Sunrise</p>
              <p className="mt-1 font-mono text-lg tabular-nums text-fog-050">
                {light.sunrise.slice(11)}
              </p>
            </div>
            <div>
              <p className="datalabel">Sunset</p>
              <p className="mt-1 font-mono text-lg tabular-nums text-fog-050">
                {light.sunset.slice(11)}
              </p>
            </div>
            <div>
              <p className="datalabel">Daylight</p>
              <p className="mt-1 font-mono text-lg tabular-nums text-fog-050">
                {light.daylightMinutes}m
              </p>
            </div>
          </div>
          <p className="mt-3 text-xs text-fog-400">
            {light.timezone} · {light.placeLabel}
            {light.fetchedAt ? ` · fetched ${light.fetchedAt.slice(0, 16).replace("T", " ")}Z` : ""}
          </p>
        </>
      ) : (
        <p className="mt-2 text-sm text-fog-200">
          No sunrise or sunset available. Set a place and a date on the round to get a real light
          window.
        </p>
      )}

      {!live && light.note ? <p className="mt-2 text-xs text-brass-400">{light.note}</p> : null}
      {light.source ? <p className="mt-2 text-xs text-fog-600">Source: {light.source.attribution}</p> : null}
    </div>
  );
}

export function IntegrityChip({
  integrity,
}: {
  integrity: ReportPayload["integrity"];
}) {
  return (
    <div
      className={cn(
        "slab-flat p-4",
        integrity.ok ? "border-reached/30" : "border-leftout/50",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="datalabel">Seal chain</p>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 font-mono text-[0.65rem] uppercase tracking-wider",
            integrity.ok ? "bg-reached/15 text-reached" : "bg-leftout/20 text-leftout",
          )}
        >
          {integrity.ok ? `${integrity.events} events verified` : `broken at event ${integrity.brokenAt?.seq}`}
        </span>
      </div>
      <p className="mt-2 break-all font-mono text-[0.7rem] text-fog-400">
        genesis {integrity.genesis} → head {integrity.head}
      </p>
    </div>
  );
}

/** The twelve-facet distribution, rendered as a readable strip. */
export function FacetStrip({ facets }: { facets: number[] }) {
  const max = Math.max(1, ...facets);
  return (
    <div>
      <p className="datalabel">Beacon facets</p>
      <div className="mt-2 flex items-end gap-1" role="img" aria-label="Fuel per beacon facet">
        {facets.map((fuel, index) => (
          <div key={index} className="flex flex-1 flex-col items-center gap-1">
            <div
              className={cn(
                "w-full rounded-t-sm",
                fuel > 0 ? "bg-ember-500" : "bg-tide-700",
              )}
              style={{ height: `${Math.max(3, (fuel / max) * 56)}px` }}
              title={`Facet ${index}: ${fuel} fuel`}
            />
            <span className="font-mono text-[0.55rem] text-fog-600">{index}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-fog-400">
        A gap means nobody lit that facet. The 3D beacon shows exactly these gaps as missing geometry.
      </p>
    </div>
  );
}