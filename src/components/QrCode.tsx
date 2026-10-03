"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { cn } from "@/lib/utils";

/**
 * QR code for a join or install link.
 *
 * Rendered client-side into a canvas because the encoder needs the DOM. The
 * value is always a real, absolute URL built from the site config, so scanning it
 * opens a working join page on a phone with no app installed.
 */
export function QrCode({
  value,
  size = 168,
  className,
  alt,
}: {
  value: string;
  size?: number;
  className?: string;
  alt: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;

    QRCode.toCanvas(canvas, value, {
      width: size,
      margin: 1,
      // High contrast so it scans on a phone in a dim room, which is exactly the
      // lighting a family game night actually has.
      color: { dark: "#030d14", light: "#eef5f7" },
      errorCorrectionLevel: "M",
    })
      .then(() => {
        if (!cancelled) setError(null);
      })
      .catch(() => {
        if (!cancelled) setError("The QR code could not be drawn. Use the link instead.");
      });

    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (error) {
    return (
      <div
        className={cn("grid place-items-center rounded-xl border border-brass-500/30 p-3 text-center", className)}
        role="status"
      >
        <p className="text-xs text-fog-200">{error}</p>
      </div>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      className={cn("rounded-xl bg-fog-050 p-1", className)}
      role="img"
      aria-label={alt}
    />
  );
}