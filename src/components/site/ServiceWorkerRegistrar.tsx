"use client";

import { useEffect } from "react";

/**
 * Registers the service worker that makes the app installable and usable
 * offline. Kept client-side and effect-only so it never runs during SSR, and
 * guarded so a browser without service-worker support simply does nothing.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    // Only in production: a stale cache during development hides real changes.
    if (process.env.NODE_ENV !== "production") return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        // A failed registration must never break the app; it only means the
        // offline shell will not be available.
      });
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}