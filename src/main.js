import { Recorder, toModelAudio, supported } from './audio.js';
import { putSurvey, getSurvey, allSurveys, putNote, notesFor } from './db.js';
import { analyzeNotes, summarize } from './analyze.js';
import { buildMarkdown, buildPrintableHtml, escapeHtml } from './report.js';
import { CRITERIA } from './criteria.js';

const $ = (id) => document.getElementById(id);
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

const state = {
  survey: null,
  recorder: new Recorder(),
  recording: false,
  criterionEmbeddings: null,
  modelsReady: false,
  timers: { field: null },
  screenOffMs: 0,
  hiddenAt: null,
  pending: new Map(),
  findings: []
};

/* ---------- shell ---------- */

function show(name) {
  document.querySelectorAll('.screen').forEach((el) => el.classList.remove('is-active'));
  $(`screen-${name}`).classList.add('is-active');
  window.scrollTo(0, 0);
}

let toastTimer = null;
function toast(message, ms = 2600) {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

const clock = (ms) => {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

/* ---------- models ---------- */

const downloads = new Map();

worker.addEventListener('message', (event) => {
  const { type } = event.data;

  if (type === 'progress') {
    const { file, loaded, total } = event.data;
    if (total) downloads.set(file, { loaded, total });
    let done = 0;
    let all = 0;
    downloads.forEach((d) => { done += d.loaded; all += d.total; });
    const pct = all ? Math.min(100, Math.round((done / all) * 100)) : 0;
    $('model-progress').hidden = false;
    $('model-progress-bar').style.width = `${pct}%`;
    $('model-progress-label').textContent = `${pct}% - ${(done / 1e6).toFixed(1)} MB of ${(all / 1e6).toFixed(1)} MB`;
    setModelStatus('loading', 'Downloading open weights');
    return;
  }

  if (type === 'device') {
    console.info(`[trailworthy] ${event.data.model} running on ${event.data.device}`);
    return;
  }

  if (type === 'log') {
    console.info(`[trailworthy] ${event.data.message}`);
    return;
  }

  if (type === 'result' || type === 'error') {
    const waiter = state.pending.get(event.data.id);
    if (!waiter) return;
    state.pending.delete(event.data.id);
    if (type === 'result') waiter.resolve(event.data);
    else waiter.reject(new Error(event.data.message));
  }
});

function setModelStatus(stateName, text) {
  $('model-status').dataset.state = stateName;
  $('model-status-text').textContent = text;
}

// ?gpu=1 opts into the WebGPU backend; see the note in worker.js for why that
// is not the default.
const PREFER_WEBGPU = new URLSearchParams(location.search).has('gpu');

/** One request to the worker, settled by its matching result or error. */
function call(type, payload = {}, transfer = []) {
  const id = uid();
  return new Promise((resolve, reject) => {
    state.pending.set(id, { resolve, reject });
    worker.postMessage({ type, id, payload: { ...payload, preferWebGpu: PREFER_WEBGPU } }, transfer);
  });
}

// Shared, so a second caller waits on the load already running rather than
// starting another, and cleared on failure so the next attempt can retry.
let modelsLoading = null;

function loadModels() {
  if (state.modelsReady) return Promise.resolve();
  if (!modelsLoading) {
    setModelStatus('loading', 'Loading models');
    modelsLoading = call('load')
      .then(({ criterionEmbeddings }) => {
        state.criterionEmbeddings = criterionEmbeddings;
        state.modelsReady = true;
        $('model-progress').hidden = true;
        setModelStatus('ready', 'Models cached. This device can survey offline.');
        $('btn-load-models').hidden = true;
      })
      .catch((err) => {
        modelsLoading = null;
        $('model-progress').hidden = true;
        setModelStatus('error', `Could not load the models: ${err.message}`);
        throw err;
      });
  }
  return modelsLoading;
}

/** The embedding model and criterion table only - enough to re-classify transcripts. */
async function loadClassifier() {
  if (!state.criterionEmbeddings) {
    const { criterionEmbeddings } = await call('load-classifier');
    state.criterionEmbeddings = criterionEmbeddings;
  }
  return state.criterionEmbeddings;
}

const transcribe = (audio) => call('transcribe', { audio }, [audio.buffer]);
const embedText = (text) => call('embed', { text });

/* ---------- location ---------- */

function fix() {
  if (!state.survey?.useGps || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        accuracy: pos.coords.accuracy
      }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
    );
  });
}

/* ---------- survey lifecycle ---------- */

$('btn-load-models').addEventListener('click', () => {
  loadModels().catch((err) => toast(`Could not load the models: ${err.message}`, 5000));
});

$('survey-form').addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!supported()) {
    toast('This browser cannot record audio.', 4000);
    return;
  }

  try {
    await state.recorder.prime();
  } catch {
    toast('Microphone permission is required to take notes.', 4000);
    return;
  }

  const data = new FormData($('survey-form'));
  state.survey = {
    id: uid(),
    trailName: (data.get('trailName') || '').toString().trim(),
    surveyor: (data.get('surveyor') || '').toString().trim(),
    agency: (data.get('agency') || '').toString().trim(),
    useGps: $('use-gps').checked,
    startedAt: Date.now(),
    noteCount: 0,
    screenOffMs: 0,
    startGps: null,
    status: 'in-progress'
  };
  await putSurvey(state.survey);

  state.screenOffMs = 0;
  state.survey.startGps = await fix();
  await putSurvey(state.survey);

  $('field-trail').textContent = state.survey.trailName || 'Survey in progress';
  $('note-count').textContent = '0';
  show('field');
  startFieldClock();

  if (!state.modelsReady) {
    // Notes are recorded as audio regardless; the models are only needed at the
    // end, so a forgotten download is recoverable rather than fatal.
    toast('Recording notes. Models will load when you finish.', 4000);
  }
});

function startFieldClock() {
  clearInterval(state.timers.field);
  state.timers.field = setInterval(() => {
    $('field-clock').textContent = clock(Date.now() - state.survey.startedAt);
    const hidden = state.hiddenAt ? Date.now() - state.hiddenAt : 0;
    $('screen-off').textContent = clock(state.screenOffMs + hidden);
  }, 1000);
}

// Time with the screen dark is the number the app is actually proud of.
document.addEventListener('visibilitychange', () => {
  if (!state.survey || state.survey.status !== 'in-progress') return;
  if (document.hidden) {
    state.hiddenAt = Date.now();
  } else if (state.hiddenAt) {
    state.screenOffMs += Date.now() - state.hiddenAt;
    state.hiddenAt = null;
  }
});

/* ---------- recording ---------- */

const recordBtn = $('btn-record');

async function beginNote() {
  if (state.recording || !state.survey) return;
  try {
    state.recorder.start();
  } catch {
    toast('Could not start recording.');
    return;
  }
  state.recording = true;
  recordBtn.classList.add('is-recording');
  $('record-label').textContent = 'Listening';
  if (navigator.vibrate) navigator.vibrate(18);
}

async function endNote() {
  if (!state.recording) return;
  state.recording = false;
  recordBtn.classList.remove('is-recording');
  $('record-label').textContent = 'Hold to note';

  let blob;
  try {
    blob = await state.recorder.stop();
  } catch {
    return;
  }
  if (!blob || blob.size < 1200) {
    toast('Too short - hold the button while you talk.');
    return;
  }

  const gps = await fix();
  const note = {
    id: uid(),
    surveyId: state.survey.id,
    at: Date.now(),
    elapsedMs: Date.now() - state.survey.startedAt,
    audio: blob,
    gps,
    transcript: null
  };
  await putNote(note);

  state.survey.noteCount += 1;
  await putSurvey(state.survey);
  $('note-count').textContent = String(state.survey.noteCount);
  if (navigator.vibrate) navigator.vibrate([12, 40, 12]);
}

// Pointer events cover mouse, touch and pen with one path. Capturing the
// pointer means the release still lands here if a finger or mouse slides off
// the button, and lostpointercapture is the backstop if it does not.
recordBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  recordBtn.setPointerCapture(e.pointerId);
  beginNote();
});
recordBtn.addEventListener('pointerup', (e) => { e.preventDefault(); endNote(); });
recordBtn.addEventListener('pointercancel', () => endNote());
recordBtn.addEventListener('lostpointercapture', () => endNote());

// Space bar for anyone surveying with a keyboard or a switch device.
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && $('screen-field').classList.contains('is-active') && !e.repeat) {
    e.preventDefault();
    beginNote();
  }
});
document.addEventListener('keyup', (e) => {
  if (e.code === 'Space' && $('screen-field').classList.contains('is-active')) {
    e.preventDefault();
    endNote();
  }
});

/* ---------- processing ---------- */

$('btn-end').addEventListener('click', async () => {
  if (state.recording) await endNote();
  clearInterval(state.timers.field);
  if (state.hiddenAt) {
    state.screenOffMs += Date.now() - state.hiddenAt;
    state.hiddenAt = null;
  }

  state.survey.status = 'processing';
  state.survey.endedAt = Date.now();
  state.survey.screenOffMs = state.screenOffMs;
  await putSurvey(state.survey);
  state.recorder.release();

  const notes = await notesFor(state.survey.id);
  if (!notes.length) {
    toast('No notes recorded.');
    goHome();
    return;
  }

  show('process');
  await processNotes(notes);
});

/**
 * Picks up a survey that never reached a report: the tab was closed on the
 * trail, or developing it failed. The notes are all in IndexedDB already.
 */
async function developSurvey(survey) {
  const notes = await notesFor(survey.id);
  if (!notes.length) {
    toast('That survey has no notes.');
    return;
  }
  state.survey = survey;
  survey.noteCount = notes.length;
  survey.endedAt ??= notes[notes.length - 1].at;
  survey.status = 'processing';
  await putSurvey(survey);
  show('process');
  await processNotes(notes);
}

function processFailed(message) {
  $('process-bar').style.width = '0%';
  $('process-label').textContent = message;
  $('btn-process-home').hidden = false;
}

async function processNotes(notes) {
  $('btn-process-home').hidden = true;
  const log = $('note-log');
  log.innerHTML = '';

  if (!state.modelsReady) {
    $('process-bar').style.width = '0%';
    $('process-label').textContent = 'Loading models';
    try {
      await loadModels();
    } catch (err) {
      // Without the models there is nothing to do here, but nothing is lost:
      // the survey stays unfinished on the trailhead screen until they load.
      processFailed(`Could not load the models (${err.message}). Your notes are saved. Connect once to download the models, then develop this survey from the trailhead.`);
      return;
    }
  }

  const transcribed = [];

  for (let i = 0; i < notes.length; i += 1) {
    const note = notes[i];
    const pct = Math.round((i / notes.length) * 100);
    $('process-bar').style.width = `${pct}%`;
    $('process-label').textContent = `Note ${i + 1} of ${notes.length}`;

    const item = document.createElement('li');
    item.className = 'is-working';
    item.textContent = `Note ${i + 1}: transcribing`;
    log.appendChild(item);

    let result = { text: '', embedding: null };
    try {
      if (note.transcript) {
        // Already transcribed on an earlier, interrupted run.
        const { embedding } = await embedText(note.transcript);
        result = { text: note.transcript, embedding };
      } else {
        const audio = await toModelAudio(note.audio);
        if (audio.length > 160) result = await transcribe(audio);
      }
    } catch (err) {
      result = { text: '', embedding: null, error: err.message };
    }

    item.className = result.text ? 'is-done' : 'is-empty';
    item.textContent = result.text
      ? `Note ${i + 1}: "${result.text}"`
      : `Note ${i + 1}: nothing recognised${result.error ? ` (${result.error})` : ''}`;

    note.transcript = result.text;
    await putNote(note);
    if (result.text && result.embedding) {
      transcribed.push({ ...note, embedding: result.embedding, audio: undefined });
    }
  }

  $('process-bar').style.width = '100%';
  $('process-label').textContent = 'Classifying against ABAAS and FSTAG';

  const { findings } = analyzeNotes(transcribed, state.criterionEmbeddings);
  state.findings = findings;
  state.survey.status = 'complete';
  await putSurvey(state.survey);

  renderReport(state.survey, findings);
  show('report');
}

/* ---------- report ---------- */

const SEVERITY_LABEL = { blocking: 'Blocking', major: 'Major', minor: 'Minor', observation: 'Observation' };

function renderReport(survey, findings) {
  const stats = summarize(findings);
  $('report-title').textContent = survey.trailName || 'Survey report';
  $('report-meta').textContent = [
    new Date(survey.startedAt).toLocaleDateString(),
    `${survey.noteCount} notes`,
    `${clock(survey.screenOffMs)} screen off`,
    survey.agency || null
  ].filter(Boolean).join(' · ');

  $('report-summary').innerHTML = `
    <div class="stat stat-barrier"><strong>${stats.nonCompliant}</strong><span>barriers</span></div>
    <div class="stat"><strong>${stats.counts.blocking}</strong><span>blocking</span></div>
    <div class="stat"><strong>${stats.counts.major}</strong><span>major</span></div>
    <div class="stat"><strong>${stats.criteriaTouched}/${stats.criteriaTotal}</strong><span>criteria covered</span></div>`;

  const container = $('report-findings');
  container.innerHTML = '';

  if (!findings.length) {
    container.innerHTML = '<p class="card card-note">Nothing was recognised from these notes. Transcripts are kept on the device if you want to check them.</p>';
    return;
  }

  findings.forEach((f) => {
    const criterion = CRITERIA.find((c) => c.id === f.criterionId);
    const el = document.createElement('article');
    el.className = `finding sev-${f.severity}`;
    const measured = f.measured !== null && f.measured !== undefined
      ? `<p class="finding-measure">Measured <strong>${Math.round(f.measured * 10) / 10}${criterion.unit === '%' ? '%' : ` ${criterion.unit}`}</strong> against a ${criterion.compare === 'max' ? 'maximum' : 'minimum'} of ${criterion.limit}${criterion.unit === '%' ? '%' : ` ${criterion.unit}`}${f.over ? ` - ${f.over}% outside the limit` : ''}</p>`
      : '';
    el.innerHTML = `
      <div class="finding-head">
        <span class="badge">${SEVERITY_LABEL[f.severity]}</span>
        <h3>${criterion.label}</h3>
        <span class="cite">${f.cite}</span>
      </div>
      ${measured}
      <blockquote>${escapeHtml(f.transcript)}</blockquote>
      <p class="finding-rule">${criterion.rule}</p>
      <p class="finding-foot">
        ${f.gps ? `${f.gps.lat.toFixed(5)}, ${f.gps.lon.toFixed(5)}` : 'no GPS'}
        · matched on-device at confidence ${f.confidence}
      </p>`;
    container.appendChild(el);
  });
}

$('btn-copy').addEventListener('click', async () => {
  const md = buildMarkdown(state.survey, state.findings);
  try {
    await navigator.clipboard.writeText(md);
    toast('Report copied.');
  } catch {
    toast('Clipboard blocked - use Download instead.');
  }
});

function saveFile(name, content, mime) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

$('btn-download').addEventListener('click', () => {
  const slug = (state.survey.trailName || 'trail').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  saveFile(`${slug}-accessibility-survey.md`, buildMarkdown(state.survey, state.findings), 'text/markdown');
});

$('btn-print').addEventListener('click', () => {
  const html = buildPrintableHtml(state.survey, state.findings);
  const win = window.open('', '_blank');
  if (!win) {
    toast('Pop-up blocked.');
    return;
  }
  win.document.write(html);
  win.document.close();
  win.focus();
  win.print();
});

function goHome() {
  state.survey = null;
  state.findings = [];
  listPastSurveys();
  show('trailhead');
}

$('btn-home').addEventListener('click', goHome);
$('btn-process-home').addEventListener('click', goHome);

/* ---------- past surveys ---------- */

async function listPastSurveys() {
  // Unfinished surveys are listed too: a closed tab or a failed develop leaves
  // the notes in IndexedDB, and this is the way back to them.
  const surveys = (await allSurveys())
    .filter((s) => s.status === 'complete' || s.noteCount > 0);
  if (!surveys.length) return;
  surveys.sort((a, b) => b.startedAt - a.startedAt);
  $('past-surveys-card').hidden = false;
  $('past-surveys').innerHTML = surveys.slice(0, 8).map((s) => `
    <li><button type="button" class="link" data-survey="${escapeHtml(s.id)}">
      ${escapeHtml(s.trailName || 'Unnamed trail')}
      <span>${new Date(s.startedAt).toLocaleDateString()} · ${s.noteCount} notes${s.status === 'complete' ? '' : ' · unfinished, tap to develop'}</span>
    </button></li>`).join('');
}

$('past-surveys').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-survey]');
  if (!button) return;
  const survey = await getSurvey(button.dataset.survey);
  if (!survey) return;

  if (survey.status !== 'complete') {
    await developSurvey(survey);
    return;
  }

  // Transcripts are already stored, so only the embedding model is needed -
  // no reason to wait on Whisper to re-open a finished report.
  let criterionEmbeddings;
  try {
    if (!state.criterionEmbeddings) toast('Loading the classifier');
    criterionEmbeddings = await loadClassifier();
  } catch (err) {
    toast(`Could not load the classifier: ${err.message}`, 5000);
    return;
  }

  const notes = (await notesFor(survey.id)).filter((n) => n.transcript);
  const withVectors = [];
  for (const note of notes) {
    const { embedding } = await embedText(note.transcript).catch(() => ({ embedding: null }));
    withVectors.push({ ...note, embedding });
  }
  state.survey = survey;
  const { findings } = analyzeNotes(withVectors.filter((n) => n.embedding), criterionEmbeddings);
  state.findings = findings;
  renderReport(survey, findings);
  show('report');
});

/* ---------- boot ---------- */

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
  });
}

listPastSurveys();
