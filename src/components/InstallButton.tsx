"use client";

import { useEffect, useState } from "react";
import { Download, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Install control.
 *
 * Honest about what it does. Emberwake ships as a Progressive Web App plus
 * Capacitor configuration for native store builds — it does not pretend to be an
 * App Store binary. On browsers that expose the install prompt the button
 * installs; where it cannot (notably iOS Safari) the component says the two real
 * taps instead of offering a button that would do nothing.
 */

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function InstallButton({ className }: { className?: string }) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [result, setResult] = useState<string | null>(null);
  // Reading the display mode in the state initializer rather than in an effect:
  // it is a one-time capability check, and deferring it to an effect would paint
  // the install button for someone who already has the app installed.
  const [installed, setInstalled] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(display-mode: standalone)").matches,
  );

  useEffect(() => {
    const onPrompt = (event: Event) => {
      // Holding the event lets us offer the button instead of an unprompted bar.
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    const choice = await deferred.userChoice;
    setResult(
      choice.outcome === "accepted"
        ? "Installed. Emberwake now opens like a normal app."
        : "Install dismissed. The app still works in this browser.",
    );
    setDeferred(null);
  }

  if (installed) {
    return (
      <p className="rounded-full border border-reached/40 bg-reached/10 px-4 py-2 text-sm text-reached">
        Installed — you are running the app version.
      </p>
    );
  }

  if (deferred) {
    return (
      <div className={cn("flex flex-col items-start gap-2", className)}>
        <button type="button" onClick={install} className="btn btn-ember">
          <Download size={15} aria-hidden="true" />
          Install Emberwake
        </button>
        {result ? <p className="text-xs text-fog-400">{result}</p> : null}
      </div>
    );
  }

  // No install prompt available: give the real instructions rather than a dead button.
  return (
    <div className={cn("slab-flat max-w-sm p-3", className)}>
      <p className="flex items-center gap-2 text-sm font-medium text-fog-050">
        <Smartphone size={15} className="text-brass-400" aria-hidden="true" />
        Add Emberwake to your phone
      </p>
      <p className="mt-1.5 text-xs leading-relaxed text-fog-400">
        <strong className="text-fog-200">iPhone or iPad:</strong> tap Share, then{" "}
        &ldquo;Add to Home Screen&rdquo;.
        <br />
        <strong className="text-fog-200">Android:</strong> tap the browser menu, then{" "}
        &ldquo;Install app&rdquo; or &ldquo;Add to Home screen&rdquo;.
        <br />
        <strong className="text-fog-200">Desktop:</strong> the install icon sits in the address bar.
      </p>
    </div>
  );
}