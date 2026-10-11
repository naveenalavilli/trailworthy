// All inference happens in here, on the device, so the UI thread stays free
// and no audio or location ever touches a network socket.

import { pipeline, env } from '@huggingface/transformers';
import { CRITERIA, prototypesFor } from './criteria.js';
// Not exported by the package, so it is addressed by path; see wasmPaths below.
import ortWasmUrl from '../node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.wasm?url';

// Weights are fetched from the Hugging Face hub once and then served from the
// browser cache, which is what makes the app work with the radio off.
env.allowLocalModels = false;
env.useBrowserCache = true;

// The ONNX runtime's ~20 MB of wasm. Vite already ships it with the app, but
// transformers.js points the runtime at jsDelivr unless a path is set, and a
// CDN download is only offline if the browser happened to keep it. Naming the
// bundled copy keeps it under the service worker with everything else. The
// runtime's JS half is bundled into this worker, so only the wasm needs a URL.
env.backends.onnx.wasm.wasmPaths = { wasm: new URL(ortWasmUrl, self.location.href).href };

const ASR_MODEL = 'Xenova/whisper-tiny.en';   // MIT
const EMBED_MODEL = 'Xenova/all-MiniLM-L6-v2'; // Apache-2.0

let asr = null;
let embed = null;
let criterionEmbeddings = null;

function post(type, payload = {}) {
  self.postMessage({ type, ...payload });
}

const WARMUP_TIMEOUT_MS = 20000;

// WASM by default, and not as a timid choice.
//
// Both models here are small, and the work is many short sequential inferences
// rather than one big batch, which is the shape WASM is good at: in Node it
// embeds the full prototype set in well under a second. WebGPU measured worse
// than that and, on this machine, far worse: the session builds, the warm-up
// inference returns, and every call after it hangs indefinitely. A survey that
// freezes while someone waits for their report is a worse failure than a slow
// one, so the fast path has to be opted into with ?gpu=1 and is still guarded
// by the warm-up timeout below.
let devices = ['wasm'];

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    })
  ]);
}

/** One cheap real inference, because a backend can build fine and still hang. */
function warmUp(task, instance) {
  return task === 'automatic-speech-recognition'
    ? instance(new Float32Array(16000))
    : instance('warm up', { pooling: 'mean', normalize: true });
}

async function withDevicePreference(task, model, extra = {}) {
  // WebGPU where it genuinely works, WASM everywhere else. A mid-range phone on
  // wasm is the baseline this has to run on.
  //
  // The fallback is driven by a warm-up inference rather than by whether the
  // pipeline constructed, because the failure seen in practice was WebGPU
  // building happily and then never returning from the first call. Catching
  // only construction errors leaves the user staring at a dead progress bar.
  for (const device of devices) {
    try {
      const instance = await pipeline(task, model, {
        device,
        dtype: 'q8',
        ...extra,
        progress_callback: (p) => {
          if (p.status === 'progress' && p.file) {
            post('progress', {
              model,
              file: p.file,
              loaded: p.loaded ?? 0,
              total: p.total ?? 0
            });
          }
        }
      });

      if (device !== 'wasm') {
        await withTimeout(warmUp(task, instance), WARMUP_TIMEOUT_MS, `${model} on ${device}`);
      }

      post('device', { model, device });
      return instance;
    } catch (err) {
      if (device === devices[devices.length - 1]) throw err;
      post('log', { message: `${model}: ${device} did not work (${err.message}), falling back to wasm` });
    }
  }
  throw new Error('no backend available');
}

// Each model loads once, behind a shared promise. Two requests arriving while
// a load is in flight (a download started at the trailhead, then a survey ended
// before it finished) wait on the same load instead of starting a second one,
// and the criterion table is only published once it is complete. A failed load
// is forgotten so the next request can retry it.
let embedLoad = null;
let asrLoad = null;

// Loaded separately: classifying an existing transcript needs the embedding
// model only, and making it wait on a 40 MB speech model it will never call is
// a minute of nothing happening.
function ensureEmbed() {
  embedLoad ??= (async () => {
    const instance = await withDevicePreference('feature-extraction', EMBED_MODEL);
    const table = {};
    for (const criterion of CRITERIA) {
      const vectors = [];
      for (const { text, polarity } of prototypesFor(criterion)) {
        const out = await instance(text, { pooling: 'mean', normalize: true });
        vectors.push({ vector: Array.from(out.data), polarity });
      }
      table[criterion.id] = vectors;
    }
    embed = instance;
    criterionEmbeddings = table;
  })().catch((err) => {
    embedLoad = null;
    throw err;
  });
  return embedLoad;
}

function ensureAsr() {
  asrLoad ??= withDevicePreference('automatic-speech-recognition', ASR_MODEL)
    .then((instance) => { asr = instance; })
    .catch((err) => {
      asrLoad = null;
      throw err;
    });
  return asrLoad;
}

async function handle(type, payload) {
  if (type === 'load') {
    await ensureEmbed();
    await ensureAsr();
    return { criterionEmbeddings };
  }

  if (type === 'load-classifier') {
    await ensureEmbed();
    return { criterionEmbeddings };
  }

  if (type === 'transcribe') {
    await ensureEmbed();
    await ensureAsr();
    const result = await asr(payload.audio, {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: false
    });
    const text = (result.text ?? '').trim();
    const vector = await embed(text || ' ', { pooling: 'mean', normalize: true });
    return { text, embedding: Array.from(vector.data) };
  }

  if (type === 'embed') {
    await ensureEmbed();
    const out = await embed(payload.text, { pooling: 'mean', normalize: true });
    return { embedding: Array.from(out.data) };
  }

  throw new Error(`unknown request: ${type}`);
}

// Every request carries an id and gets exactly one reply, a result or an error,
// so the page can treat each one as a promise.
self.addEventListener('message', async (event) => {
  const { type, id, payload } = event.data;
  // A worker cannot see the page's query string, so the opt-in rides along.
  if (payload?.preferWebGpu && devices[0] !== 'webgpu') devices = ['webgpu', 'wasm'];
  try {
    post('result', { id, ...(await handle(type, payload)) });
  } catch (err) {
    post('error', { id, message: err?.message ?? String(err) });
  }
});
