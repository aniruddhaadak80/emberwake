/**
 * Layout diagnostic.
 *
 * Finds the elements actually wider than the viewport, using Chrome DevTools
 * Protocol. Guessing at CSS causes is unreliable; this measures.
 *
 *   node scripts/diagnose-layout.mjs <url> [width]
 */

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const URL_TARGET = process.argv[2] ?? "https://emberwake-lyart.vercel.app/round";
const WIDTH = Number(process.argv[3] ?? 390);
const PORT = 9333;

const EDGE_CANDIDATES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
];
const { existsSync } = await import("node:fs");
const browser = EDGE_CANDIDATES.find((p) => existsSync(p));
if (!browser) {
  console.error("No Chromium-family browser found.");
  process.exit(2);
}

const child = spawn(
  browser,
  [
    "--headless=new",
    "--disable-gpu",
    "--enable-unsafe-swiftshader",
    `--remote-debugging-port=${PORT}`,
    `--window-size=${WIDTH},1200`,
    "--user-data-dir=C:/Users/ANIRUD~1/AppData/Local/Temp/opencode/cdp-profile",
    "about:blank",
  ],
  { stdio: "ignore", detached: false },
);

function cleanup() {
  try {
    child.kill();
  } catch {}
}
process.on("exit", cleanup);

/** Poll until the debugging endpoint answers. */
let wsUrl = null;
for (let i = 0; i < 40 && !wsUrl; i++) {
  await sleep(500);
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
    const info = await res.json();
    wsUrl = info.webSocketDebuggerUrl;
  } catch {
    /* not up yet */
  }
}
if (!wsUrl) {
  console.error("Could not reach the debugging endpoint.");
  cleanup();
  process.exit(2);
}

const ws = new WebSocket(wsUrl);
let nextId = 1;
const pending = new Map();

ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});

function send(method, params = {}, sessionId) {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
}

await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));

// Attach to a fresh tab.
const { result: targetResult } = await send("Target.createTarget", { url: "about:blank" });
const targetId = targetResult.targetId;
const { result: attachResult } = await send("Target.attachToTarget", {
  targetId,
  flatten: true,
});
const sessionId = attachResult.sessionId;

await send("Page.enable", {}, sessionId);
await send("Runtime.enable", {}, sessionId);
await send("Emulation.setDeviceMetricsOverride", {
  width: WIDTH,
  height: 1200,
  deviceScaleFactor: 1,
  mobile: true,
}, sessionId);
await send("Page.navigate", { url: URL_TARGET }, sessionId);
await sleep(9000);

const expression = `(() => {
  const docWidth = document.documentElement.clientWidth;
  const offenders = [];
  for (const el of document.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue;
    if (r.right > docWidth + 1 || r.width > docWidth + 1) {
      const style = getComputedStyle(el);
      offenders.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.getAttribute('class') || '').slice(0, 90),
        w: Math.round(r.width),
        right: Math.round(r.right),
        display: style.display,
        minWidth: style.minWidth,
        whiteSpace: style.whiteSpace,
        depth: (() => { let d=0,n=el; while(n.parentElement){d++;n=n.parentElement;} return d; })(),
      });
    }
  }
  offenders.sort((a,b) => (b.right - a.right) || (a.depth - b.depth));
  return JSON.stringify({
    clientWidth: docWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    count: offenders.length,
    top: offenders.slice(0, 14),
  }, null, 2);
})()`;

const res = await send(
  "Runtime.evaluate",
  { expression, returnByValue: true, awaitPromise: false },
  sessionId,
);

console.log(res.result?.result?.value ?? JSON.stringify(res));

// Also capture what a genuinely emulated phone actually renders. Headless
// Chrome has a minimum window width, so `--window-size=390` alone lays out
// wider than the requested width and produces a cropped image that looks like
// horizontal overflow. Device metrics override avoids that entirely.
if (process.argv[4]) {
  const shot = await send(
    "Page.captureScreenshot",
    { format: "png", captureBeyondViewport: true },
    sessionId,
  );
  if (shot.result?.data) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(process.argv[4], Buffer.from(shot.result.data, "base64"));
    console.log(`\nscreenshot written to ${process.argv[4]}`);
  }
}

ws.close();
cleanup();
process.exit(0);