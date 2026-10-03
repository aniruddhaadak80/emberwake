/**
 * The beacon arena.
 *
 * This is the signature interaction, not a decoration. The beacon's twelve
 * facets are rendered from the *same* per-facet fuel array that produces the
 * numbers in the HUD, so:
 *
 *  - a facet with no fuel is recessed and dark, leaving a real geometric gap;
 *  - an even distribution produces a symmetric, fully lit beacon;
 *  - a lopsided distribution produces a visibly lopsided one.
 *
 * A bug in the fairness maths therefore cannot hide behind a pretty render, and
 * a visitor can see who was left out without reading a single label.
 *
 * Lighting is driven by real sunrise/sunset data via `src/lib/sun.ts`.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { AgeBand } from "@/lib/types";
import { skyPalette, sunState } from "@/lib/sun";

export type StageMember = {
  id: string;
  displayName: string;
  ageBand: AgeBand;
  participation: number;
};

export type BeaconStageProps = {
  /** Per-facet fuel totals, index 0..11. Same array the report uses. */
  facets: number[];
  members: StageMember[];
  activeMemberId: string | null;
  sunrise: string | null;
  sunset: string | null;
  timezone: string;
  disabled?: boolean;
  onPickFacet?: (facet: number) => void;
  onSelectMember?: (memberId: string) => void;
};

type FacetRef = {
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  index: number;
};

type SceneState = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  facetRefs: FacetRef[];
  sparkGroup: THREE.Group;
  beaconLight: THREE.PointLight;
  sunLight: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  sea: THREE.Mesh | null;
  seaBase: Float32Array | null;
  frame: number;
  disposed: boolean;
};

/** Age band maps to a stable warm/cool hue so players are recognisable. */
const BAND_HUE: Record<AgeBand, number> = {
  child: 0xffd166,
  teen: 0x8ecae6,
  adult: 0xff7a3d,
  elder: 0xc9a7ff,
};

const FACETS = 12;
const RING_RADIUS = 5.4;
const FACET_PANEL_WIDTH = 0.78;
const FACET_PANEL_HEIGHT = 1.5;
const BEACON_BASE_Y = 1.15;

export default function BeaconStage(props: BeaconStageProps): React.ReactElement {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef<SceneState | null>(null);
  const propsRef = useRef(props);
  const [webglError, setWebglError] = useState<string | null>(null);

  // Capability check during render, so a browser without WebGL never attempts to
  // mount a canvas at all.
  const [webglAvailable] = useState(() => supportsWebGL());

  // The render loop samples the latest props from a ref so changing the facet
  // distribution never tears down and rebuilds the WebGL context. Mirroring into
  // the ref happens in an effect rather than during render, which React 19
  // requires; the scene is built once and reads current values every frame.
  useEffect(() => {
    propsRef.current = props;
  }, [props]);

  useEffect(() => {
    if (!webglAvailable) return;
    const mount = mountRef.current;
    if (!mount) return;

    let state: SceneState | null = null;
    try {
      state = buildScene(mount, propsRef.current);
    } catch {
      // Deferring the state update out of the effect body keeps this a genuine
      // asynchronous reaction rather than a synchronous render-phase write.
      queueMicrotask(() =>
        setWebglError("This browser could not start WebGL, so the 3D arena is unavailable."),
      );
      return;
    }
    stateRef.current = state;

    const resize = () => {
      if (!state) return;
      const { clientWidth: w, clientHeight: h } = mount;
      if (w === 0 || h === 0) return;
      state.camera.aspect = w / h;
      state.camera.updateProjectionMatrix();
      state.renderer.setSize(w, h, false);
    };
    resize();

    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const clock = new THREE.Clock();
    let elapsed = 0;

    const loop = () => {
      if (!state || state.disposed) return;
      state.frame = requestAnimationFrame(loop);
      const dt = Math.min(clock.getDelta(), 0.05);
      if (!reduced) elapsed += dt;

      const current = propsRef.current;
      animateSea(state, elapsed, reduced);
      applyFacets(state, current.facets, elapsed, reduced);
      animateSparks(state, current.members, current.activeMemberId, elapsed, reduced);

      const sun = sunState(current.sunrise, current.sunset, localNowMinutes(current.timezone));
      applyLighting(state, sun, current.activeMemberId);

      state.renderer.render(state.scene, state.camera);
    };
    loop();

    return () => {
      observer.disconnect();
      if (state) {
        state.disposed = true;
        cancelAnimationFrame(state.frame);
        disposeScene(state);
      }
      stateRef.current = null;
    };
    // Mount-only by design: every live update flows through `propsRef`, so the
    // WebGL context is created exactly once per mount.
  }, [webglAvailable]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const onPointerMove = (event: PointerEvent) => {
      const state = stateRef.current;
      if (!state) return;
      const hit = pick(state, mount, event);
      mount.style.cursor = hit ? "pointer" : "default";
    };

    const onClick = (event: MouseEvent) => {
      const state = stateRef.current;
      if (!state) return;
      const current = propsRef.current;
      if (current.disabled) return;
      const hit = pick(state, mount, event);
      if (!hit) return;

      if (hit.kind === "facet") current.onPickFacet?.(hit.index);
      else current.onSelectMember?.(hit.id);
    };

    mount.addEventListener("pointermove", onPointerMove);
    mount.addEventListener("click", onClick);
    return () => {
      mount.removeEventListener("pointermove", onPointerMove);
      mount.removeEventListener("click", onClick);
    };
  }, []);

  if (webglError || !webglAvailable) {
    return (
      <div
        className="grid h-full w-full place-items-center rounded-slab border border-brass-500/20 bg-tide-900/60 p-6 text-center"
        role="status"
      >
        <p className="max-w-sm text-sm text-fog-200">
          {webglError ??
            "This browser does not support WebGL, so the 3D arena is unavailable."}
        </p>
        <p className="mt-2 text-xs text-fog-400">
          Every number on this page still works without the 3D scene.
        </p>
      </div>
    );
  }

  return <div ref={mountRef} className="h-full w-full touch-pan-y" aria-label="3D beacon arena" role="img" />;
}

/** True when this browser can create a WebGL context. */
function supportsWebGL(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl2") ??
      canvas.getContext("webgl") ??
      canvas.getContext("experimental-webgl");
    return gl !== null && gl !== undefined;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Scene construction                                                  */
/* ------------------------------------------------------------------ */

function buildScene(mount: HTMLElement, props: BeaconStageProps): SceneState {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  mount.appendChild(renderer.domElement);
  renderer.domElement.style.display = "block";

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x08151f, 0.028);

  const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 220);
  camera.position.set(0, 5.4, 13.5);
  camera.lookAt(0, BEACON_BASE_Y + 0.4, 0);

  // Sky dome. Vertex colours give a vertical gradient for almost no cost.
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(120, 24, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x03080f) },
        bottomColor: { value: new THREE.Color(0x0d2233) },
      },
      vertexShader: `
        varying vec3 vPos;
        void main() {
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        varying vec3 vPos;
        void main() {
          float h = clamp(normalize(vPos).y * 0.5 + 0.5, 0.0, 1.0);
          vec3 c = mix(bottomColor, topColor, pow(h, 0.7));
          gl_FragColor = vec4(c, 1.0);
        }
      `,
    }),
  );
  scene.add(sky);

  // Sea.
  const seaGeometry = new THREE.PlaneGeometry(160, 160, 48, 48);
  const seaMaterial = new THREE.MeshStandardMaterial({
    color: 0x0b2434,
    roughness: 0.35,
    metalness: 0.15,
    flatShading: true,
  });
  const sea = new THREE.Mesh(seaGeometry, seaMaterial);
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = -0.35;
  scene.add(sea);
  const seaBase = Float32Array.from(seaGeometry.attributes.position.array as ArrayLike<number>);

  // Headland: a low-poly rock so the scene has a silhouette.
  const rock = new THREE.Mesh(
    new THREE.CylinderGeometry(4.6, 5.4, 1.1, 9, 1),
    new THREE.MeshStandardMaterial({ color: 0x1b2b33, roughness: 0.95, flatShading: true }),
  );
  rock.position.y = 0.2;
  scene.add(rock);

  const rockTop = new THREE.Mesh(
    new THREE.CylinderGeometry(4.55, 4.6, 0.22, 9, 1),
    new THREE.MeshStandardMaterial({ color: 0x24393f, roughness: 0.9, flatShading: true }),
  );
  rockTop.position.y = 0.85;
  scene.add(rockTop);

  // Beacon tower.
  const tower = new THREE.Mesh(
    new THREE.CylinderGeometry(0.46, 0.72, 2.4, 8, 1),
    new THREE.MeshStandardMaterial({ color: 0x2b3f47, roughness: 0.7, metalness: 0.3, flatShading: true }),
  );
  tower.position.y = 2.1;
  scene.add(tower);

  // The twelve facet panels. Each is its own mesh so its emissive intensity can
  // be driven independently by real data.
  const facetRefs: FacetRef[] = [];
  for (let i = 0; i < FACETS; i++) {
    const angle = (i / FACETS) * Math.PI * 2;
    const material = new THREE.MeshStandardMaterial({
      color: 0x16262d,
      emissive: new THREE.Color(0x000000),
      emissiveIntensity: 0,
      roughness: 0.45,
      metalness: 0.1,
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(FACET_PANEL_WIDTH, FACET_PANEL_HEIGHT, 0.14), material);
    const radius = 0.62;
    mesh.position.set(Math.cos(angle) * radius, BEACON_BASE_Y + 0.35, Math.sin(angle) * radius);
    mesh.rotation.y = -angle;
    mesh.userData = { kind: "facet", index: i };
    scene.add(mesh);
    facetRefs.push({ mesh, material, index: i });
  }

  // Lamp housing.
  const lamp = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.3, 0.34, 8, 1),
    new THREE.MeshStandardMaterial({
      color: 0x3a4b52,
      emissive: new THREE.Color(0xff7a3d),
      emissiveIntensity: 0.4,
      roughness: 0.4,
    }),
  );
  lamp.position.y = 3.42;
  scene.add(lamp);

  const cap = new THREE.Mesh(
    new THREE.ConeGeometry(0.42, 0.44, 8, 1),
    new THREE.MeshStandardMaterial({ color: 0x8a6a2c, roughness: 0.6, flatShading: true }),
  );
  cap.position.y = 3.82;
  scene.add(cap);

  const beaconLight = new THREE.PointLight(0xffa257, 6, 26, 2);
  beaconLight.position.set(0, 3.42, 0);
  scene.add(beaconLight);

  // One spark per roster member.
  const sparkGroup = new THREE.Group();
  scene.add(sparkGroup);
  buildSparks(sparkGroup, props.members, props.activeMemberId);

  const hemi = new THREE.HemisphereLight(0x9fc4d6, 0x0b2029, 0.5);
  scene.add(hemi);

  const sunLight = new THREE.DirectionalLight(0xfff3d6, 0.5);
  sunLight.position.set(14, 18, -8);
  scene.add(sunLight);

  return {
    renderer,
    scene,
    camera,
    facetRefs,
    sparkGroup,
    beaconLight,
    sunLight,
    hemi,
    sea,
    seaBase,
    frame: 0,
    disposed: false,
  };
}

function buildSparks(group: THREE.Group, members: StageMember[], activeId: string | null): void {
  // Clear and rebuild so the member list can change length.
  for (const child of [...group.children]) {
    group.remove(child);
    const mesh = child as THREE.Mesh;
    mesh.geometry?.dispose();
    const material = mesh.material as THREE.Material | undefined;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else material?.dispose();
  }

  members.forEach((member, i) => {
    // Distribute evenly around the ring, offset so nobody sits at dead centre.
    const angle = (i / Math.max(1, members.length)) * Math.PI * 2 + 0.35;
    const colour = BAND_HUE[member.ageBand] ?? 0xffffff;
    const material = new THREE.MeshStandardMaterial({
      color: colour,
      emissive: new THREE.Color(colour),
      // A member who never played is dim; that is legible without a label.
      emissiveIntensity: member.participation > 0 ? 1.5 : 0.16,
      roughness: 0.3,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), material);
    mesh.position.set(Math.cos(angle) * RING_RADIUS, 1.15, Math.sin(angle) * RING_RADIUS);
    mesh.userData = { kind: "spark", id: member.id, index: i };
    group.add(mesh);
  });

  setActiveSpark(group, activeId);
}

function setActiveSpark(group: THREE.Group, activeId: string | null): void {
  for (const child of group.children) {
    const mesh = child as THREE.Mesh;
    const userData = mesh.userData as { kind?: string; id?: string; index?: number };
    if (userData.kind !== "spark") continue;
    const active = activeId !== null && userData.id === activeId;
    mesh.scale.setScalar(active ? 1.45 : 1);
  }
}

/* ------------------------------------------------------------------ */
/* Per-frame updates                                                   */
/* ------------------------------------------------------------------ */

function applyFacets(
  state: SceneState,
  facets: number[],
  elapsed: number,
  reduced: boolean,
): void {
  let max = 1;
  for (const value of facets) if (value > max) max = value;

  for (const ref of state.facetRefs) {
    const fuel = facets[ref.index] ?? 0;
    const share = fuel / max;
    const lit = fuel > 0;

    // Recess unlit facets inward so an unfair split leaves a *geometric* gap,
    // not just a dark panel.
    const targetScale = lit ? 1 : 0.42;
    ref.mesh.scale.z += (targetScale - ref.mesh.scale.z) * 0.18;

    const flicker = reduced ? 1 : 1 + Math.sin(elapsed * 2.4 + ref.index * 0.7) * 0.06;
    ref.material.emissiveIntensity = lit ? share * 2.1 * flicker : 0;
    ref.material.emissive.setHex(lit ? mixHex(0xff5a1f, 0xffc46b, share) : 0x000000);
    ref.material.color.setHex(lit ? mixHex(0x1c2b2f, 0x3a2a1c, share) : 0x101c22);
  }
}

function animateSea(state: SceneState, elapsed: number, reduced: boolean): void {
  const { sea, seaBase } = state;
  if (!sea || !seaBase || reduced) return;
  const position = sea.geometry.attributes.position as THREE.BufferAttribute;
  const array = position.array as Float32Array;
  for (let i = 0; i < array.length; i += 3) {
    const x = seaBase[i];
    const y = seaBase[i + 1];
    array[i + 2] = Math.sin(x * 0.16 + elapsed * 0.9) * 0.16 + Math.cos(y * 0.13 - elapsed * 0.7) * 0.14;
  }
  position.needsUpdate = true;
  sea.geometry.computeVertexNormals();
}

function animateSparks(
  state: SceneState,
  members: StageMember[],
  activeId: string | null,
  elapsed: number,
  reduced: boolean,
): void {
  const count = state.sparkGroup.children.length;
  if (count !== members.length) {
    buildSparks(state.sparkGroup, members, activeId);
    return;
  }
  if (!reduced) {
    state.sparkGroup.children.forEach((child, i) => {
      const mesh = child as THREE.Mesh;
      const bob = Math.sin(elapsed * 1.6 + i * 0.9) * 0.12;
      mesh.position.y = 1.15 + bob;
    });
  }
}

function applyLighting(state: SceneState, sun: ReturnType<typeof sunState>, activeId: string | null): void {
  const palette = skyPalette(sun?.altitude ?? -0.5);

  const skyMaterial = state.scene.children.find(
    (child) => (child as THREE.Mesh).material instanceof THREE.ShaderMaterial,
  ) as THREE.Mesh | undefined;
  if (skyMaterial) {
    const uniforms = (skyMaterial.material as THREE.ShaderMaterial).uniforms;
    uniforms.topColor.value = new THREE.Color(palette.zenith);
    uniforms.bottomColor.value = new THREE.Color(palette.horizon);
  }

  state.scene.fog = new THREE.FogExp2(palette.fog, 0.028);

  state.hemi.intensity = palette.ambient;
  state.hemi.color = new THREE.Color(palette.sun);

  if (sun) {
    const azimuth = (sun.azimuth * Math.PI) / 180;
    const altitude = Math.max(0.08, sun.altitude) * 22;
    state.sunLight.position.set(
      Math.cos(azimuth) * altitude,
      altitude,
      Math.sin(azimuth) * altitude,
    );
    state.sunLight.color = new THREE.Color(palette.sun);
    state.sunLight.intensity = sun.altitude > 0 ? 1.6 * sun.altitude + 0.15 : 0;
  } else {
    state.sunLight.intensity = 0;
  }

  // The beacon reads brightest at night, which is when it matters.
  const hasActive = activeId !== null;
  // The beacon reads brightest at night, which is when it matters, and lifts
  // slightly when someone is on turn.
  state.beaconLight.intensity = 4 + palette.beaconContrast * 7 + (hasActive ? 1.5 : 0);
  state.beaconLight.color = new THREE.Color(0xffa257);
}

/* ------------------------------------------------------------------ */
/* Picking and teardown                                               */
/* ------------------------------------------------------------------ */

type Hit = { kind: "facet"; index: number } | { kind: "spark"; id: string };

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function pick(state: SceneState, mount: HTMLElement, event: MouseEvent | PointerEvent): Hit | null {
  const rect = mount.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, state.camera);

  const targets: THREE.Object3D[] = [
    ...state.facetRefs.map((ref) => ref.mesh),
    ...state.sparkGroup.children,
  ];
  const hits = raycaster.intersectObjects(targets, false);
  if (hits.length === 0) return null;

  const userData = hits[0].object.userData as { kind?: string; index?: number; id?: string };
  if (userData.kind === "facet" && typeof userData.index === "number") {
    return { kind: "facet", index: userData.index };
  }
  if (userData.kind === "spark" && typeof userData.id === "string") {
    return { kind: "spark", id: userData.id };
  }
  return null;
}

function disposeScene(state: SceneState): void {
  state.scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    mesh.geometry?.dispose?.();
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else if (material) {
      // A ShaderMaterial holds a compiled program that must be released too.
      (material as THREE.ShaderMaterial).dispose?.();
    }
  });
  state.renderer.dispose();
  state.renderer.domElement.remove();
}

function mixHex(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

function localNowMinutes(timezone: string): number | null {
  if (!timezone || timezone === "auto" || timezone === "unknown") {
    const now = new Date();
    return now.getUTCHours() * 60 + now.getUTCMinutes();
  }
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date());
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "NaN");
    const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "NaN");
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    return (hour % 24) * 60 + minute;
  } catch {
    return null;
  }
}