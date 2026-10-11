// Microphone capture plus the conversion Whisper needs: mono, 16 kHz, Float32.

const TARGET_RATE = 16000;

export function supported() {
  return Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
}

export class Recorder {
  constructor() {
    this.stream = null;
    this.recorder = null;
    this.chunks = [];
  }

  async prime() {
    // Asked for once at the trailhead, so the permission prompt never appears
    // while someone is standing in the middle of a trail with gloves on.
    if (this.stream) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
    });
  }

  start() {
    if (!this.stream) throw new Error('microphone not primed');
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
      .find((type) => MediaRecorder.isTypeSupported(type));
    // Each recording owns its chunks. A quick release-and-press can start the
    // next note before the last one's final dataavailable and stop events have
    // fired, and a shared array would splice the two notes together.
    const chunks = [];
    const recorder = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    recorder.addEventListener('dataavailable', (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    });
    this.recorder = recorder;
    this.chunks = chunks;
    recorder.start();
  }

  stop() {
    const { recorder, chunks } = this;
    return new Promise((resolve, reject) => {
      if (!recorder || recorder.state === 'inactive') {
        reject(new Error('not recording'));
        return;
      }
      recorder.addEventListener('stop', () => {
        resolve(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }));
      }, { once: true });
      recorder.stop();
    });
  }

  release() {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }
}

/** Decodes a recorded blob to the mono 16 kHz Float32Array the ASR model wants. */
export async function toModelAudio(blob) {
  const bytes = await blob.arrayBuffer();
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  let decoded;
  try {
    decoded = await ctx.decodeAudioData(bytes);
  } finally {
    ctx.close();
  }

  const frames = Math.ceil(decoded.duration * TARGET_RATE);
  if (frames <= 0) return new Float32Array(0);

  const offline = new OfflineAudioContext(1, frames, TARGET_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const resampled = await offline.startRendering();
  return resampled.getChannelData(0).slice();
}
