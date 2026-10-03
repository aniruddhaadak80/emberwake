/**
 * Single source of truth for product identity and outbound links.
 *
 * Every component that needs the repository URL imports it from here so the
 * header, mobile menu, landing CTA, footer, OG metadata and MCP manifest can
 * never drift apart.
 */

const REPO_SLUG = "emberwake";

/** Public repository. Used by nav, footer, landing CTA, OG and MCP manifest. */
export const REPO_URL = `https://github.com/aniruddhaadak80/${REPO_SLUG}`;

/** Issues page, linked directly from the README and nav. */
export const ISSUES_URL = `${REPO_URL}/issues`;

/**
 * Canonical live origin. Overridable so preview deployments stay self
 * describing; defaults to the production alias that Phase 7 verifies.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://emberwake.vercel.app"
).replace(/\/+$/, "");

export const site = {
  name: "Emberwake",
  /** One line, used for metadata and the README subtitle. */
  outcome:
    "A 3D beacon game for a real family, where the beacon's geometry is literally the fairness metric.",
  description:
    "Emberwake turns a family game night into a measurable thing. Each member gets a Spark on a 3D headland; lighting the shared Beacon is a turn-based cooperative round, and the beacon's geometry shows how evenly the light was shared. A deterministic engine scores Reach, Balance, Glow and Rhythm, and the round report tells you who played and who was left out.",
  tagline: "Light the beacon together. See who got to play.",
  repoUrl: REPO_URL,
  issuesUrl: ISSUES_URL,
  liveUrl: SITE_URL,
  license: "MIT",
} as const;

export type NavItem = {
  href: string;
  label: string;
  /** Short line used in the mobile sheet and as an aria description. */
  hint: string;
};

/** Primary navigation. Kept short so it survives a 360px viewport. */
export const navigation: readonly NavItem[] = [
  { href: "/round", label: "Round", hint: "Play the 3D beacon round" },
  { href: "/embers", label: "Embers", hint: "Every spark and voice memo" },
  { href: "/report", label: "Report", hint: "Who played, who was left out" },
  { href: "/agent", label: "Agent", hint: "Live MCP tool console" },
  { href: "/verify", label: "Verify", hint: "Replay the seal chain" },
  { href: "/settings", label: "Settings", hint: "Place, roster and theme" },
] as const;

export const ogImage = `${SITE_URL}/og.png`;