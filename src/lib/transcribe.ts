/**
 * On-device speech to text.
 *
 * This is the open-source-AI core of the product: `whisper-tiny.en`, run with
 * Transformers.js inside the player's own browser using WebAssembly or WebGPU.
 *
 * Why on-device rather than a hosted API:
 *  - it works with no network once the model is cached, which matters because a
 *    family gathering is often somewhere with bad signal;
 *  - a grandparent's voice never leaves their phone, which is the only honest
 *    answer to "can I put my dad's voice in this app?";
 *  - there is no API key, no per-request cost, and no vendor dependency.
 *
 * The model is downloaded from the Hugging Face CDN on first use and cached by
 * the browser. Nothing is uploaded. Every failure path is reported honestly, and
 * the caller is expected to offer typing as a real alternative rather than
 * pretending the feature worked.
 */

export const WHISPER_MODEL = "onnx-community/whisper-tiny.en";
export const WHISPER_ENGINE_LABEL = `${WHISPER_MODEL} (on-device)`;

export type TranscribeStatus =
  | "idle"
  | "recording"
  | "loading-model"
  | "transcribing"
  | "done"
  | "unsupported"
  | "error";

/** Mixes an AudioBuffer to a single mono Float32Array at its native sample rate. */
function toMono(audio: AudioBuffer): Float32Array {
  const channels = audio.numberOfChannels;
  const length = audio.length;
  const out = new Float32Array(length);

  for (let channel = 0; channel < channels; channel++) {
    const data = audio.getChannelData(channel);
    for (let i = 0; i < length; i++) out[i] += data[i];
  }
  if (channels > 1) {
    for (let i = 0; i < length; i++) out[i] /= channels;
  }
  return out;
}

export function canRecord(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  );
}

type Pipeline = (
  audio: Float32Array,
  options?: Record<string, unknown>,
) => Promise<{ text: string } | { text: string }[]>;

let cachedPipeline: Pipeline | null = null;

/**
 * Loads the model once per page session and reuses it.
 * `onStage` reports coarse progress so the UI can show real movement instead of
 * an indeterminate spinner.
 */
async function loadPipeline(
  onStage: (message: string, progress: number) => void,
): Promise<Pipeline> {
  if (cachedPipeline) return cachedPipeline;

  const transformers = await import("@huggingface/transformers");
  // The browser has no local model directory; always fetch from the CDN.
  transformers.env.allowLocalModels = false;

  onStage("Fetching the open-weight Whisper model…", 0.15);

  const pipeline = transformers.pipeline as unknown as (
    task: string,
    model: string,
    options?: Record<string, unknown>,
  ) => Promise<Pipeline>;

  const instance = await pipeline("automatic-speech-recognition", WHISPER_MODEL, {
    // Quantised weights keep the download near 40 MB and run on older phones.
    dtype: { encoder_model: "q8", decoder_model_merged: "q8" },
    progress_callback: (item: unknown) => {
      const record = item as { status?: string; progress?: number; file?: string };
      if (record?.status === "progress" && typeof record.progress === "number") {
        onStage(`Downloading model weights… ${Math.round(record.progress)}%`, 0.15 + record.progress / 140);
      }
    },
  });

  cachedPipeline = instance;
  return instance;
}

/**
 * Transcribes a recorded clip. Throws with a readable message on failure so the
 * UI can present a truthful error and offer the typed alternative.
 */
export async function transcribeRecording(
  blob: Blob,
  onStage: (message: string, progress: number) => void,
): Promise<{ text: string; engine: string; durationSeconds: number }> {
  const AudioContextCtor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) throw new Error("This browser cannot decode audio in the page.");

  onStage("Decoding the recording…", 0.05);

  const buffer = await blob.arrayBuffer();
  const ctx = new AudioContextCtor();
  let audio: AudioBuffer;
  try {
    audio = await ctx.decodeAudioData(buffer);
  } finally {
    void ctx.close();
  }

  if (audio.duration < 0.4) {
    throw new Error("That recording was too short to understand. Hold the button a little longer.");
  }

  onStage("Loading the on-device model…", 0.1);
  const transcriber = await loadPipeline(onStage);

  onStage("Transcribing on your device…", 0.7);
  const output = await transcriber(toMono(audio), {
    // Greedy decoding: deterministic and fast, which is what we want on a phone.
    max_new_tokens: 96,
    chunk_length_s: 30,
    return_timestamps: false,
  });

  const raw = Array.isArray(output) ? output[0]?.text : output?.text;
  const text = (raw ?? "").trim();

  if (text.length === 0) {
    throw new Error("The model could not make out any speech in that clip.");
  }

  return {
    text,
    engine: WHISPER_ENGINE_LABEL,
    durationSeconds: Math.round(audio.duration * 10) / 10,
  };
}