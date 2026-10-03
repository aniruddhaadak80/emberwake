/**
 * Shared site header.
 *
 * A client component because the mobile sheet is interactive. The repository
 * link is read from the single site config, never hard-coded, and appears in
 * both the desktop bar and the mobile sheet.
 */
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, useState } from "react";
import { Menu, X } from "lucide-react";
import { GithubMark } from "@/components/site/GithubMark";
import { navigation, site } from "@/config/site";
import { cn } from "@/lib/utils";

const GITHUB_LABEL = "Star on GitHub";

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const panelId = useId();

  // A route change must always close the sheet, otherwise it covers the page the
  // visitor just asked for. Adjusting state during render is React's
  // recommended alternative to an effect for this: it avoids a wasted render
  // pass and cannot briefly paint the old menu over the new page.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

  return (
    <header className="sticky top-0 z-50 border-b border-brass-500/15 bg-tide-950/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2.5 text-fog-050"
          aria-label={`${site.name} home`}
        >
          <span
            aria-hidden="true"
            className="grid h-8 w-8 place-items-center rounded-full bg-ember-500/15 ring-1 ring-ember-500/40"
          >
            <span className="h-2.5 w-2.5 rounded-full bg-ember-500 shadow-[0_0_12px_2px] shadow-ember-500/60" />
          </span>
          <span className="text-lg font-semibold tracking-tight">{site.name}</span>
        </Link>

        <nav aria-label="Primary" className="ml-auto hidden items-center gap-1 md:flex">
          {navigation.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-full px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-ember-500/15 text-ember-300"
                    : "text-fog-200 hover:bg-tide-800 hover:text-fog-050",
                )}
              >
                {item.label}
              </Link>
            );
          })}
          <a
            href={site.repoUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${GITHUB_LABEL} — opens in a new tab`}
            className="btn btn-ghost ml-2 text-sm"
          >
            <GithubMark />
            GitHub
          </a>
        </nav>

        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={panelId}
          className="btn btn-ghost ml-auto h-10 w-10 p-0 md:hidden"
        >
          {open ? <X size={20} /> : <Menu size={20} />}
          <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
        </button>
      </div>

      {open ? (
        <div id={panelId} className="border-t border-brass-500/15 bg-tide-900/95 md:hidden">
          <nav aria-label="Primary mobile" className="mx-auto flex max-w-6xl flex-col p-3">
            {navigation.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex flex-col rounded-xl px-4 py-3 transition-colors",
                    active ? "bg-ember-500/15" : "hover:bg-tide-800",
                  )}
                >
                  <span className={cn("font-medium", active ? "text-ember-300" : "text-fog-050")}>
                    {item.label}
                  </span>
                  <span className="text-xs text-fog-400">{item.hint}</span>
                </Link>
              );
            })}
            <a
              href={site.repoUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${GITHUB_LABEL} — opens in a new tab`}
              className="btn btn-ghost mt-2 w-full"
            >
              <GithubMark />
              Star on GitHub
            </a>
          </nav>
        </div>
      ) : null}
    </header>
  );
}