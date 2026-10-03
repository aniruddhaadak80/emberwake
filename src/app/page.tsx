import Link from "next/link";
import {
  ArrowRight,
  Flame,
  QrCode as QrIcon,
  ShieldCheck,
  Users,
} from "lucide-react";
import { InstallButton } from "@/components/InstallButton";
import { QrCode } from "@/components/QrCode";
import { GithubMark } from "@/components/site/GithubMark";
import { BeaconStageCanvas } from "@/components/three/BeaconStageCanvas";
import { ContributionTable, ScoreDial } from "@/components/ReportPanels";
import { analyzeRound } from "@/lib/engine/beacon-engine";
import { buildReport } from "@/lib/report";
import { dateWindow, fetchSky } from "@/lib/sky";
import { SITE_URL, site } from "@/config/site";

export const dynamic = "force-dynamic";

/**
 * The landing page.
 *
 * The demo round below is not a screenshot or a fixture: it is the seeded round
 * read out of the database and analysed by the real engine on every request. If
 * the datastore is unreachable the page says so instead of showing a fake chart.
 */
export default async function HomePage() {
  const demo = await loadDemo();

  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1.15fr_0.85fr] lg:py-20">
          <div>
            <p className="datalabel">Build for a Friend</p>
            <h1 className="mt-3 text-4xl leading-[1.05] font-semibold sm:text-5xl lg:text-6xl">
              The beacon&apos;s shape
              <br />
              <span className="text-ember-400">is the fairness metric.</span>
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-fog-200 sm:text-lg">
              {site.description}
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/round" className="btn btn-ember">
                Start a round
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
              <InstallButton />
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <a
                href={site.repoUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Star Emberwake on GitHub — opens in a new tab"
                className="btn btn-ghost"
              >
                <GithubMark />
                Star on GitHub
              </a>
              <Link href="/agent" className="btn btn-ghost">
                Try the agent tools
              </Link>
            </div>

            <p className="mt-6 max-w-lg text-sm text-fog-400">
              No account. No API key. Voice is transcribed on your own device and never uploaded.
            </p>
          </div>

          <div className="slab flex flex-col items-center justify-center gap-4 p-6">
            <p className="datalabel">Scan to open it on a phone</p>
            <QrCode
              value={SITE_URL}
              size={184}
              alt={`QR code linking to ${SITE_URL}`}
            />
            <p className="text-center text-xs text-fog-400">
              Works on any phone, tablet or laptop. Android, iPhone, Windows, Mac — one link, no
              install required.
            </p>
          </div>
        </div>
      </section>

      {/* The problem, stated honestly */}
      <section className="border-y border-brass-500/15 bg-tide-900/40">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
          <h2 className="text-2xl font-semibold">The problem nobody writes down</h2>
          <div className="mt-5 grid gap-5 md:grid-cols-3">
            {[
              {
                icon: Users,
                title: "Two people always dominate",
                body: "The same two voices take most turns. Everyone can feel it. Nobody can point to it, so it never gets fixed.",
              },
              {
                icon: Flame,
                title: "Grandparents get skipped",
                body: "Somebody has to explain the rules, so somebody always plays. The quiet person at the table quietly stops enjoying it.",
              },
              {
                icon: ShieldCheck,
                title: "It repeats every single time",
                body: "With no record of who played, the same round happens again next week with the same imbalance.",
              },
            ].map((item) => (
              <div key={item.title} className="slab-flat p-5">
                <item.icon size={20} className="text-ember-400" aria-hidden="true" />
                <h3 className="mt-3 text-base font-semibold text-fog-050">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-fog-200">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* The live demo, analysed for real */}
      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="datalabel">Real data, real engine</p>
            <h2 className="mt-2 text-2xl font-semibold sm:text-3xl">
              A round where two people never played
            </h2>
          </div>
          <span className="rounded-full border border-brass-500/40 bg-brass-500/10 px-3 py-1 font-mono text-[0.65rem] uppercase tracking-wider text-brass-400">
            seeded demo round
          </span>
        </div>

        {demo ? (
          <div className="mt-7 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="slab overflow-hidden">
              <div className="h-[22rem] w-full sm:h-[26rem]">
                <BeaconStageCanvas
                  facets={demo.report.facets}
                  members={demo.members}
                  activeMemberId={null}
                  sunrise={demo.report.light.sunrise}
                  sunset={demo.report.light.sunset}
                  timezone={demo.report.light.timezone}
                />
              </div>
              <p className="border-t border-brass-500/15 p-3 text-xs text-fog-400">
                This is the demo round&apos;s actual facet data. The gaps in the tower are the two
                people who never lit a facet — not an artistic choice.
              </p>
            </div>

            <div className="grid gap-4">
              <div className="slab-flat p-5">
                <ScoreDial value={demo.result.overall} label="overall" />
                <p className="mt-2 text-sm font-medium text-ember-300">
                  {demo.result.recommendation.headline}
                </p>
                <p className="mt-1 text-sm text-fog-400">{demo.result.recommendation.detail}</p>
              </div>

              <div className="slab-flat p-5">
                <ContributionTable contributions={demo.result.contributions} />
              </div>
            </div>
          </div>
        ) : (
          <div className="slab-flat mt-7 p-6">
            <p className="text-sm text-fog-200">
              The demo round could not be loaded, which usually means the datastore is not configured
              in this environment. The rest of the app still works, and you can create your own round.
            </p>
          </div>
        )}
      </section>

      {/* How it works */}
      <section className="border-y border-brass-500/15 bg-tide-900/40">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <h2 className="text-2xl font-semibold sm:text-3xl">What actually happens</h2>
          <ol className="mt-7 grid gap-6 md:grid-cols-3">
            {[
              {
                step: "01",
                title: "Hand out one QR code",
                body: "The host makes a round and shows a code. Anyone on any device scans it and is on the roster. No install, no account, no app store.",
              },
              {
                step: "02",
                title: "Light a facet, or say something",
                body: "Each player lights a facet of the beacon with real fuel. Anyone can record a voice ember instead, transcribed on their own phone by open-weight Whisper.",
              },
              {
                step: "03",
                title: "Read the report, change the plan",
                body: "A deterministic engine scores Reach, Balance, Glow, Rhythm and the real daylight window, then tells you exactly who to hand the next turn to.",
              },
            ].map((item) => (
              <li key={item.step} className="slab-flat p-5">
                <p className="font-mono text-sm text-ember-400">{item.step}</p>
                <h3 className="mt-2 text-base font-semibold text-fog-050">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-fog-200">{item.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <h2 className="text-2xl font-semibold sm:text-3xl">✨ Features</h2>
        <ul className="mt-7 grid gap-4 md:grid-cols-2">
          {[
            ["A game you can actually play", "Turn-based, cooperative, and short enough for a living room. Twelve facets, real fuel, a real tower that fills up."],
            ["Fairness you can see", "The 3D beacon is generated from the same per-facet array as the numbers, so an unfair split cannot hide behind a good-looking render."],
            ["Voice that needs no typing", "Whisper-tiny runs in the browser via WebAssembly or WebGPU. Your family's audio never leaves the device."],
            ["A report worth sending", "A plain-text report you can paste straight into a family group chat, plus a JSON download and a verifiable seal chain."],
            ["Real sunlight", "Sunrise and sunset for your actual place and date, from Open-Meteo with no key. It tells you whether outside is even viable."],
            ["An agent interface", "A live MCP JSON-RPC endpoint with seven typed tools, including idempotent mutations that share the UI's code path."],
            ["Installs everywhere", "One codebase: Progressive Web App in any browser, Capacitor configuration for Android, iOS, Windows and Mac."],
            ["Auditable by construction", "Every change appends to a SHA-384 hash chain. Replay it yourself and see exactly where a record changed."],
          ].map(([title, body]) => (
            <li key={title} className="slab-flat p-5">
              <h3 className="text-base font-semibold text-fog-050">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-fog-200">{body}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* GitHub */}
      <section className="border-t border-brass-500/15 bg-tide-900/40">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-5 px-4 py-14 sm:px-6 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-semibold sm:text-3xl">It is open source</h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-fog-200">
              The engine, the integrity chain, the 3D arena and the agent tools are all readable. If
              your family&apos;s imbalance looks different from the one this solves, you should be able
              to change the weights and know exactly what moved.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <a
              href={site.repoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-ember"
              aria-label="View the Emberwake source on GitHub — opens in a new tab"
            >
              <GithubMark />
              View source
            </a>
            <Link href="/agent" className="btn btn-ghost">
              <QrIcon size={15} aria-hidden="true" />
              See the agent tools
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

type DemoShape = {
  result: ReturnType<typeof analyzeRound>;
  report: ReturnType<typeof buildReport>;
  members: { id: string; displayName: string; ageBand: "child" | "teen" | "adult" | "elder"; participation: number }[];
};

/** Reads and analyses the seeded demo round. Returns null rather than faking it. */
async function loadDemo(): Promise<DemoShape | null> {
  try {
    const { ensureSchema, getDb } = await import("@/lib/db/client");
    const { getDemoBundle, listAudit } = await import("@/lib/db/repository");
    await ensureSchema();
    const db = await getDb();
    const bundle = await getDemoBundle(db);
    if (!bundle) return null;

    let sky = null;
    if (bundle.round.latitude !== null && bundle.round.longitude !== null && bundle.round.scheduledDate) {
      const window = dateWindow(bundle.round.scheduledDate, 1);
      sky = await fetchSky(
        bundle.round.latitude,
        bundle.round.longitude,
        bundle.round.placeLabel,
        window.start,
        window.end,
      );
    }

    const generatedAt = new Date().toISOString();
    const result = analyzeRound(bundle, { now: generatedAt, sky });
    const report = buildReport(bundle, result, sky, await listAudit(db, bundle.round.id), generatedAt);

    return {
      result,
      report,
      members: result.contributions.map((row) => ({
        id: row.memberId,
        displayName: row.displayName,
        ageBand: row.ageBand,
        participation: row.participation,
      })),
    };
  } catch {
    return null;
  }
}