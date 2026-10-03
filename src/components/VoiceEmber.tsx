"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, Square, TriangleAlert } from "lucide-react";
import {
  WHISPER_ENGINE_LABEL,
  canRecord,
  transcribeRecording,
  type TranscribeStatus,
} from "@/lib/transcribe";

/**
 * Voice ember recorder.
 *
 * Records a short clip and transcribes it entirely on the player's own device.
 *
 * The design rule that matters here: this control must never be a trap. If the
 * browser cannot record, or the model cannot download, or the speech is
 * unintelligible, the component says exactly what happened and offers typing as
 * a fully working alternative. A feature that silently fails would be worse than
 * not having it.
 */
export function VoiceEmber({
  onSubmit,
  disabled,
}: {
  onSubmit: (payload: { text: string; engine: string }) => Promise<void> | void;
  disabled?: boolean;
}) {
  const [status, setStatus] = useState<TranscribeStatus>("idle");
  const [stage, setStage] = useState<string>("");
  const [progress, setProgress] = useState<number>(0);
  const [seconds, setSeconds] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string>("");
  const [engine, setEngine] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const supported = typeof window !== "undefined" && canRecord();
  const busy = status === "loading-model" || status === "transcribing" || saving;

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  async function startRecording() {
    setError(null);
    setTranscript("");
    setSeconds(0);
    setProgress(0);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError(
        "This browser blocked microphone access. You can still add the ember by typing below.",
      );
      setStatus("error");
      return;
    }
    streamRef.current = stream;

    const recorder = new MediaRecorder(stream);
    chunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };

    recorder.onstop = async () => {
      stopTimer();
      stream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;

      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
      setStatus("loading-model");
      try {
        const result = await transcribeRecording(blob, (message, value) => {
          setStage(message);
          setProgress(value);
        });
        setTranscript(result.text);
        setEngine(result.engine);
        setStatus("done");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Transcription failed on this device.");
        setStatus("error");
      }
    };

    recorder.start();
    recorderRef.current = recorder;
    setStatus("recording");
    timerRef.current = setInterval(() => {
      setSeconds((value) => {
        // Cap at 20s: a longer clip adds latency without adding much signal.
        if (value >= 19) {
          recorder.stop();
          return 20;
        }
        return value + 1;
      });
    }, 1000);
  }

  function cancelRecording() {
    recorderRef.current?.stop();
  }

  async function save() {
    const text = transcript.trim();
    if (text.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit({ text, engine: engine || WHISPER_ENGINE_LABEL });
      setTranscript("");
      setEngine("");
      setStatus("idle");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save that ember.");
      setStatus("error");
    } finally {
      setSaving(false);
    }
  }

  if (!supported) {
    return (
      <div className="slab-flat p-4">
        <p className="flex items-start gap-2 text-sm text-fog-200">
          <TriangleAlert size={16} className="mt-0.5 shrink-0 text-brass-400" aria-hidden="true" />
          <span>
            This browser cannot record audio. Type the ember below instead — it reaches exactly the same
            round, with the same honesty about who played.
          </span>
        </p>
        <TypedFallback onSubmit={onSubmit} disabled={disabled} />
      </div>
    );
  }

  return (
    <div className="slab-flat p-4">
      <div className="flex flex-wrap items-center gap-3">
        {status === "recording" ? (
          <>
            <button type="button" onClick={cancelRecording} className="btn btn-ember" disabled={disabled}>
              <Square size={14} aria-hidden="true" />
              Stop · {seconds}s
            </button>
            <p className="text-sm text-fog-200" role="status" aria-live="polite">
              Listening. Say something the family would want to remember.
            </p>
          </>
        ) : (
          <button
            type="button"
            onClick={startRecording}
            className="btn btn-ember"
            disabled={disabled || busy}
          >
            <Mic size={15} aria-hidden="true" />
            Record a voice ember
          </button>
        )}

        {busy ? (
          <span className="flex items-center gap-2 text-sm text-fog-200" role="status" aria-live="polite">
            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
            {stage || "Working…"}
          </span>
        ) : null}
      </div>

      {busy ? (
        <div
          className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-tide-800"
          role="progressbar"
          aria-valuenow={Math.round(progress * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Transcription progress"
        >
          <div
            className="h-full rounded-full bg-ember-500 transition-[width] duration-300"
            style={{ width: `${Math.min(100, Math.max(4, progress * 100))}%` }}
          />
        </div>
      ) : null}

      <p className="mt-3 text-xs text-fog-400">
        Transcribed on this device by <span className="font-mono">{WHISPER_ENGINE_LABEL}</span>. Your audio
        is never uploaded anywhere.
      </p>

      {error ? (
        <p className="mt-3 rounded-xl border border-leftout/40 bg-leftout/10 p-3 text-sm text-fog-050" role="alert">
          {error}
        </p>
      ) : null}

      {status === "done" && transcript ? (
        <div className="mt-3">
          <label htmlFor="transcript" className="datalabel">
            Transcribed on your device — edit before saving
          </label>
          <textarea
            id="transcript"
            className="field mt-1.5 min-h-24 resize-y"
            value={transcript}
            onChange={(event) => setTranscript(event.target.value)}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={save} className="btn btn-ember" disabled={saving}>
              {saving ? "Saving…" : "Save this ember"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setTranscript("");
                setStatus("idle");
              }}
              disabled={saving}
            >
              Discard
            </button>
          </div>
        </div>
      ) : null}

      {status === "error" ? <TypedFallback onSubmit={onSubmit} disabled={disabled} /> : null}
    </div>
  );
}

/** A real, working alternative path — never a disabled placeholder. */
function TypedFallback({
  onSubmit,
  disabled,
}: {
  onSubmit: (payload: { text: string; engine: string }) => Promise<void> | void;
  disabled?: boolean;
}) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  return (
    <form
      className="mt-3"
      onSubmit={async (event) => {
        event.preventDefault();
        if (text.trim().length === 0) return;
        setSaving(true);
        try {
          await onSubmit({ text: text.trim(), engine: "typed" });
          setText("");
        } finally {
          setSaving(false);
        }
      }}
    >
      <label htmlFor="typed-ember" className="datalabel">
        Or write it
      </label>
      <textarea
        id="typed-ember"
        className="field mt-1.5 min-h-20 resize-y"
        placeholder="What did they say?"
        value={text}
        onChange={(event) => setText(event.target.value)}
        disabled={disabled}
      />
      <button type="submit" className="btn btn-ghost mt-2" disabled={saving || text.trim().length === 0}>
        {saving ? "Saving…" : "Save typed ember"}
      </button>
    </form>
  );
}