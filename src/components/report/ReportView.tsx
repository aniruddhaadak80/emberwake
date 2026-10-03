"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Check, Copy, Download, Loader2, TriangleAlert } from "lucide-react";
import {
  ClientError,
  getReport,
  listRounds,
  type BundleShape,
} from "@/lib/client";
import { getRoundBundle } from "@/lib/client";
import {
  ContributionTable,
  FactorBars,
  FacetStrip,
  IntegrityChip,
  LightPanel,
  ScoreDial,
} from "@/components/ReportPanels";
import type { Round } from "@/lib/types";

/**
 * The report route.
 *
 * The takeaway artifact: a round you can paste into a family group chat. It is
 * generated from the same engine the 3D arena uses, so the numbers in the report
 * and the shape of the beacon are always the same numbers.
 */
export function ReportView() {
  const searchParams = useSearchParams();
  const roundParam = searchParams.get("round");

  const [rounds, setRounds] = useState<Round[]>([]);
  const [selected, setSelected] = useState<string | null>(roundParam);
  const [bundle, setBundle] = useState<BundleShape | null>(null);
  const [report, setReport] = useState<Awaited<ReturnType<typeof getReport>>["report"] | null>(null);
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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
    // "loading" is set by the picker below, not here: a synchronous setState in an
    // effect body causes an extra render pass.
    (async () => {
      try {
        const [nextBundle, nextReport, textReport] = await Promise.all([
          getRoundBundle(selected),
          getReport(selected),
          fetch(`/api/rounds/${selected}/report?format=text`).then((r) => r.text()),
        ]);
        if (cancelled) return;
        setBundle(nextBundle.bundle);
        setReport(nextReport.report);
        setText(textReport);
        setState("ready");
      } catch (cause) {
        if (cancelled) return;
        setError(cause instanceof ClientError ? cause.message : "Could not build that report.");
        setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const downloadName = useMemo(
    () => `emberwake-report-${bundle?.round.joinCode ?? "round"}.txt`,
    [bundle],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      setError("This browser blocked clipboard access. Use the download instead.");
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="round-picker" className="datalabel">
          Round
        </label>
        <select
          id="round-picker"
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
            Building…
          </span>
        ) : null}
      </div>

      {rounds.length === 0 && state !== "loading" ? (
        <div className="slab-flat mt-6 p-6">
          <p className="text-sm text-fog-200">
            You have no rounds in this browser session yet. Create one and come back — the report is
            generated from whatever has actually been played.
          </p>
          <Link href="/round" className="btn btn-ember mt-4">
            Create a round
          </Link>
        </div>
      ) : null}

      {state === "error" ? (
        <p className="mt-6 flex items-start gap-2 rounded-xl border border-leftout/40 bg-leftout/10 p-3 text-sm">
          <TriangleAlert size={15} className="mt-0.5 shrink-0 text-leftout" aria-hidden="true" />
          {error}
        </p>
      ) : null}

      {report && state === "ready" ? (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <a
              href={`/api/rounds/${selected}/report?format=text`}
              download={downloadName}
              className="btn btn-ember"
            >
              <Download size={15} aria-hidden="true" />
              Download report
            </a>
            <button type="button" className="btn btn-ghost" onClick={copy}>
              {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
              {copied ? "Copied" : "Copy for the group chat"}
            </button>
            <Link href={`/verify?round=${selected}`} className="btn btn-ghost">
              Verify the seal chain
            </Link>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_0.9fr]">
            <div className="grid gap-4">
              <div className="slab-flat p-5">
                <p className="datalabel">{report.round.title}</p>
                <div className="mt-3">
                  <ScoreDial value={report.engine.overall} label="overall" />
                </div>
                <p className="mt-2 text-sm font-medium text-ember-300">{report.headline}</p>
                <p className="mt-1 text-sm text-fog-400">{report.engine.recommendation.detail}</p>
                <ul className="mt-4 grid gap-1.5">
                  {report.engine.recommendation.actions.map((action) => (
                    <li key={action} className="text-sm text-fog-200">
                      · {action}
                    </li>
                  ))}
                </ul>
                <p className="mt-3 font-mono text-[0.65rem] text-fog-600">
                  engine {report.engine.version} · generated {report.generatedAt.slice(0, 16).replace("T", " ")}Z
                </p>
              </div>

              <div className="slab-flat p-5">
                <p className="datalabel">Participation</p>
                <div className="mt-3">
                  <ContributionTable contributions={report.contributions} />
                </div>
              </div>

              <div className="slab-flat p-5">
                <FacetStrip facets={report.facets} />
              </div>
            </div>

            <div className="grid content-start gap-4">
              <div className="slab-flat p-5">
                <p className="datalabel">Factors</p>
                <div className="mt-4">
                  <FactorBars factors={report.engine.factors} />
                </div>
              </div>
              <LightPanel light={report.light} />
              <IntegrityChip integrity={report.integrity} />
            </div>
          </div>

          <details className="slab-flat mt-6 p-4">
            <summary className="cursor-pointer text-sm font-medium text-fog-050">
              Pasteable plain-text report
            </summary>
            <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-fog-200">
              {text}
            </pre>
          </details>

          <p className="mt-4 text-xs text-fog-600">{report.attribution}</p>
        </>
      ) : null}
    </div>
  );
}