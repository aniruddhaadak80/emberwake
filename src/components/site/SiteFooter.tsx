import Link from "next/link";
import { GithubMark } from "@/components/site/GithubMark";
import { navigation, site } from "@/config/site";

/**
 * Shared site footer. Server component, so it ships no JavaScript.
 *
 * Carries the same repository link as the header and landing CTA, all reading
 * from `site.repoUrl`, plus the data attribution the product is required to
 * carry: Open-Meteo supplies the live sunrise/sunset.
 */
export function SiteFooter() {
  return (
    <footer className="mt-20 border-t border-brass-500/15 bg-tide-950">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-3">
        <div>
          <p className="text-base font-semibold text-fog-050">{site.name}</p>
          <p className="mt-2 max-w-xs text-sm text-fog-400">{site.tagline}</p>
          <a
            href={site.repoUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="View source on GitHub — opens in a new tab"
            className="btn btn-ghost mt-4 text-sm"
          >
            <GithubMark />
            View source
          </a>
        </div>

        <nav aria-label="Footer">
          <p className="datalabel">Pages</p>
          <ul className="mt-3 grid gap-2">
            {navigation.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="text-sm text-fog-200 hover:text-ember-300">
                  {item.label}
                </Link>
              </li>
            ))}
            <li>
              <Link href="/" className="text-sm text-fog-200 hover:text-ember-300">
                Home
              </Link>
            </li>
          </ul>
        </nav>

        <div>
          <p className="datalabel">Open source</p>
          <ul className="mt-3 grid gap-2">
            <li>
              <a
                href={site.repoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-fog-200 hover:text-ember-300"
              >
                GitHub repository
              </a>
            </li>
            <li>
              <a
                href={site.issuesUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-fog-200 hover:text-ember-300"
              >
                Issues
              </a>
            </li>
            <li>
              <a
                href={site.liveUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-fog-200 hover:text-ember-300"
              >
                Live app
              </a>
            </li>
          </ul>
          <p className="mt-4 text-xs leading-relaxed text-fog-600">
            Sunrise, sunset and place names come from{" "}
            <a
              href="https://open-meteo.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-fog-400"
            >
              Open-Meteo
            </a>
            . Voice transcription runs in your browser with open-weight Whisper. No
            audio is uploaded to a server.
          </p>
          <p className="mt-3 text-xs text-fog-600">
            {site.name} is a family game. It is not medical, legal or financial advice.
          </p>
        </div>
      </div>
    </footer>
  );
}