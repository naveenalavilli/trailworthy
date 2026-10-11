// End-to-end check on real recorded speech: WAV bytes -> Whisper -> transcript
// -> criterion -> finding. Everything else in tests/ starts from text, which
// leaves the actual audio path unproven.
//
// Usage: node scripts/audio-smoke.mjs [path-to-16k-mono-wav]

import { readFileSync } from 'node:fs';
import { pipeline, env } from '@huggingface/transformers';
import { CRITERIA, prototypesFor } from '../src/criteria.js';
import { analyzeNotes } from '../src/analyze.js';

env.allowLocalModels = false;

/** Minimal RIFF/WAVE reader for 16-bit PCM, which is what recorders emit. */
function decodeWav(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file');
  }
  let offset = 12;
  let fmt = null;
  let data = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      fmt = {
        format: buffer.readUInt16LE(body),
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        bits: buffer.readUInt16LE(body + 14)
      };
    } else if (id === 'data') {
      data = buffer.subarray(body, body + size);
    }
    offset = body + size + (size % 2);
  }
  if (!fmt || !data) throw new Error('missing fmt or data chunk');
  if (fmt.bits !== 16) throw new Error(`expected 16-bit PCM, got ${fmt.bits}`);

  const frames = Math.floor(data.length / 2 / fmt.channels);
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i += 1) {
    let sum = 0;
    for (let ch = 0; ch < fmt.channels; ch += 1) {
      sum += data.readInt16LE((i * fmt.channels + ch) * 2) / 32768;
    }
    mono[i] = sum / fmt.channels;
  }
  return { samples: mono, sampleRate: fmt.sampleRate };
}

/** Linear resample to 16 kHz, matching what the browser does with an OfflineAudioContext. */
function to16k(samples, rate) {
  if (rate === 16000) return samples;
  const ratio = rate / 16000;
  const out = new Float32Array(Math.floor(samples.length / ratio));
  for (let i = 0; i < out.length; i += 1) {
    const at = i * ratio;
    const low = Math.floor(at);
    const high = Math.min(low + 1, samples.length - 1);
    out[i] = samples[low] + (samples[high] - samples[low]) * (at - low);
  }
  return out;
}

const SAMPLE_URL = 'https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/jfk.wav';
const path = process.argv[2];

let wav;
if (path) {
  console.log(`reading ${path}`);
  wav = readFileSync(path);
} else {
  console.log(`downloading sample speech: ${SAMPLE_URL}`);
  const res = await fetch(SAMPLE_URL);
  if (!res.ok) throw new Error(`sample download failed: ${res.status}`);
  wav = Buffer.from(await res.arrayBuffer());
}

const { samples, sampleRate } = decodeWav(wav);
const audio = to16k(samples, sampleRate);
console.log(`decoded ${(audio.length / 16000).toFixed(2)}s of audio at ${sampleRate} Hz -> 16000 Hz\n`);

const asr = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', { dtype: 'q8' });
const started = Date.now();
const { text } = await asr(audio, { chunk_length_s: 30, stride_length_s: 5, return_timestamps: false });
const elapsed = Date.now() - started;

console.log(`TRANSCRIPT (${elapsed} ms): "${text.trim()}"\n`);

// And push it the rest of the way through, so the whole chain is exercised.
const embed = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'q8' });
const vec = async (t) => Array.from((await embed(t, { pooling: 'mean', normalize: true })).data);

const criterionEmbeddings = {};
for (const criterion of CRITERIA) {
  criterionEmbeddings[criterion.id] = await Promise.all(
    prototypesFor(criterion).map(async ({ text: p, polarity }) => ({ vector: await vec(p), polarity }))
  );
}

const { findings, unmatched } = analyzeNotes(
  [{ id: 'smoke', transcript: text.trim(), embedding: await vec(text.trim()), at: Date.now(), gps: null }],
  criterionEmbeddings
);

if (findings.length) {
  const f = findings[0];
  console.log(`FILED: ${f.criterion} (${f.cite}) - ${f.status}, severity ${f.severity}, confidence ${f.confidence}`);
} else {
  console.log(`SET ASIDE as not an accessibility observation (score ${unmatched[0].score.toFixed(3)})`);
}
console.log('\naudio path OK: WAV decoded, transcribed on-device, and routed through the classifier.');
