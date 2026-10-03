"use client";

import dynamic from "next/dynamic";
import type { BeaconStageProps } from "./BeaconStage";

/**
 * Client-only wrapper for the WebGL arena.
 *
 * Three.js must never be imported from a server component, so it is loaded
 * through `next/dynamic` with `ssr: false` and a skeleton that states what is
 * loading. The scene is decorative to correctness — every number it visualises is
 * also available as text — so if it never loads, the page still works.
 */
const BeaconStage = dynamic(() => import("./BeaconStage"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full w-full place-items-center" role="status" aria-live="polite">
      <div className="text-center">
        <div className="mx-auto h-10 w-10 animate-pulse rounded-full bg-ember-500/30" />
        <p className="mt-3 text-sm text-fog-400">Building the headland…</p>
      </div>
    </div>
  ),
});

export function BeaconStageCanvas(props: BeaconStageProps) {
  return <BeaconStage {...props} />;
}