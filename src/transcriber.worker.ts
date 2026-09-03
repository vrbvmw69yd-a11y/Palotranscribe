/// <reference lib="webworker" />

import { env, pipeline } from "@huggingface/transformers";

type ModelKey = "fast" | "recommended" | "pro";

const MODELS: Record<ModelKey, string> = {
  fast: "onnx-community/whisper-tiny",
  recommended: "onnx-community/whisper-base",
  pro: "onnx-community/whisper-small",
};

let transcriber: any = null;
let currentModel: ModelKey | null = null;
let currentDevice = "wasm";
let loadingPromise: Promise<void> | null = null;
let loadingModel: ModelKey | null = null;

env.allowLocalModels = false;
env.useBrowserCache = true;

const post = (message: unknown) => self.postMessage(message);

async function loadModel(modelKey: ModelKey) {
  if (transcriber && currentModel === modelKey) {
    post({ type: "ready", modelKey, device: currentDevice, cached: true });
    return;
  }

  if (loadingPromise) {
    await loadingPromise;
    if (transcriber && currentModel === modelKey) {
      post({ type: "ready", modelKey, device: currentDevice, cached: true });
      return;
    }
  }

  loadingModel = modelKey;
  loadingPromise = (async () => {
    if (transcriber?.dispose) {
      try { await transcriber.dispose(); } catch {}
      transcriber = null;
      currentModel = null;
    }

    const hasWebGPU = Boolean((self.navigator as any).gpu);
    currentDevice = hasWebGPU ? "webgpu" : "wasm";

    if (!hasWebGPU) {
      try {
        const cores = Math.max(1, Math.min(4, (self.navigator as any).hardwareConcurrency || 2));
        (env as any).backends.onnx.wasm.numThreads = (self as any).crossOriginIsolated ? cores : 1;
      } catch {}
    }

    post({ type: "loading", modelKey, device: currentDevice });

    const dtype = hasWebGPU
      ? { encoder_model: "fp32", decoder_model_merged: "q4" }
      : "q8";

    const next = await pipeline(
      "automatic-speech-recognition",
      MODELS[modelKey],
      {
        device: currentDevice as any,
        dtype: dtype as any,
        progress_callback: (p: any) => {
          post({
            type: "model-progress",
            modelKey,
            status: p?.status || "",
            file: p?.file || "",
            progress: Number.isFinite(p?.progress) ? p.progress : null,
            loaded: p?.loaded ?? null,
            total: p?.total ?? null,
          });
        },
      },
    );

    transcriber = next;
    currentModel = modelKey;
    post({ type: "ready", modelKey, device: currentDevice, cached: false });
  })();

  try {
    await loadingPromise;
  } finally {
    loadingPromise = null;
    loadingModel = null;
  }
}

self.onmessage = async (event: MessageEvent) => {
  const msg = event.data;
  try {
    if (msg.type === "load") {
      await loadModel(msg.modelKey as ModelKey);
      return;
    }

    if (msg.type === "transcribe") {
      const modelKey = msg.modelKey as ModelKey;
      await loadModel(modelKey);

      const audio = new Float32Array(msg.audio);
      const output = await transcriber(audio, {
        language: "spanish",
        task: "transcribe",
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: false,
      });

      post({
        type: "result",
        id: msg.id,
        text: String(output?.text || "").trim(),
        device: currentDevice,
      });
    }
  } catch (error) {
    post({
      type: "error",
      id: msg?.id,
      modelKey: msg?.modelKey ?? loadingModel,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
