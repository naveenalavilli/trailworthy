// Turns transcribed trail notes into cited accessibility findings.
//
// Routing a note to a criterion is done with on-device sentence embeddings
// rather than keyword matching, because people describe the same barrier a
// dozen ways ("off camber", "tilts toward the creek", "water cut a side slope")
// and none of those share a keyword with "cross slope".

import { CRITERIA, SEVERITY_CUES } from './criteria.js';
import { extractMeasurements, measurementFor } from './measure.js';

export function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

// Below this, a note is kept aside rather than forced into the closest
// criterion. "The light through the oaks is beautiful" is not an ADA finding
// and should not be filed as one.
//
// Set from scripts/calibrate.mjs rather than by eye: across the sample notes,
// real observations score no lower than 0.576 and trail chatter no higher than
// 0.458, so the floor sits in the middle of that gap. Re-run the script after
// editing any prototype list.
const MATCH_FLOOR = 0.517;

// Sentence embeddings are weak at negation: "nothing on the sign about the
// grade" sits right next to "the sign lists the grade". Absence phrasing is
// therefore treated as its own signal rather than trusted to the vectors.
// See scripts/polarity-experiment.mjs for the comparison this came from.
export const NEGATION = /\b(no|not|nothing|none|never|without|lacks?|lacking|missing|isn't|aren't|doesn't|don't|didn't|won't|can't|cannot|nowhere|nobody)\b/i;

// Negation that lands on the problem rather than on a feature: "no trouble
// getting a chair through", "not a problem", "no low branches". Those notes say
// things are fine, so they switch the flip off. They never flip a note toward
// ok on their own; that call stays with the vectors.
//
// A margin between the two sides was tried first and does not work: across the
// labelled notes in scripts/polarity-experiment.mjs, barrier and ok notes with
// negation overlap almost exactly.
export const REASSURANCE = /\b(?:no|not|never|without|isn't|aren't|wasn't|weren't)\s+(?:(?:a|an|any|too|that|very|really|much|of\s+an?)\s+)*(?:problems?|issues?|trouble|concerns?|bad|worry|steep|narrow|rough|tight|uneven|slippery|loose|soft|muddy|low|blocked|overgrown)\b|\b(?:is|are|was|were|looks|seems)\s+fine\b/i;

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/**
 * Decides whether a note describes the criterion being wrong or being fine.
 * Averaging each side beats trusting the single nearest prototype, and the
 * negation flip covers the case averaging still gets wrong.
 */
export function polarityFor(criterion, embedding, prototypes, text) {
  const sides = { barrier: [], ok: [] };
  for (const proto of prototypes) sides[proto.polarity].push(cosine(embedding, proto.vector));

  const polarity = mean(sides.barrier) >= mean(sides.ok) ? 'barrier' : 'ok';
  if (polarity === 'ok' && NEGATION.test(text) && !REASSURANCE.test(text)) {
    // Only ever flip toward barrier, and not for criteria whose "fine" wording
    // is itself negative ("no noticeable cross slope"), which would invert a
    // correct read.
    const okIsNegated = criterion.ok.some((phrase) => NEGATION.test(phrase));
    if (!okIsNegated) return 'barrier';
  }
  return polarity;
}

function severityFromText(text) {
  const lower = text.toLowerCase();
  for (const level of ['blocking', 'major', 'minor']) {
    if (SEVERITY_CUES[level].some((cue) => lower.includes(cue))) return level;
  }
  return null;
}

/** How far past the limit a measurement sits, as a share of the limit. */
function exceedance(criterion, measured) {
  if (criterion.compare === 'max') return (measured - criterion.limit) / criterion.limit;
  return (criterion.limit - measured) / criterion.limit;
}

/**
 * A number decides the question outright. Without one, the side of the
 * prototype set the note landed on decides it instead.
 */
function compliance(criterion, measurement, polarity) {
  if (criterion.unit && measurement) {
    const measured = measurement.value;
    const passes = criterion.compare === 'max'
      ? measured <= criterion.limit
      : measured >= criterion.limit;
    return {
      status: passes ? 'compliant' : 'non-compliant',
      measured,
      limit: criterion.limit,
      measurement,
      over: passes ? 0 : Math.round(exceedance(criterion, measured) * 1000) / 10
    };
  }

  return {
    status: polarity === 'barrier' ? 'non-compliant' : 'compliant',
    measured: null,
    limit: criterion.limit ?? null,
    measurement: null,
    over: 0,
    unmeasured: true
  };
}

function severityFor(criterion, check, text) {
  if (check.status === 'compliant') return 'observation';
  const spoken = severityFromText(text);
  if (spoken) return spoken;
  // No number to grade against, so fall back to how bad this class of barrier
  // is when it is present at all.
  if (check.unmeasured) return criterion.defaultSeverity ?? 'minor';
  if (check.over >= 50) return 'blocking';
  if (check.over >= 20) return 'major';
  return 'minor';
}

/**
 * @param notes  [{ id, transcript, embedding, gps, at, elapsedMs }]
 * @param criterionEmbeddings  { [criterionId]: [{ vector, polarity }] }
 */
export function analyzeNotes(notes, criterionEmbeddings) {
  const findings = [];
  const unmatched = [];

  for (const note of notes) {
    if (!note.transcript || !note.transcript.trim()) continue;

    // Which criterion the note is about: nearest prototype on either side.
    let best = null;
    for (const criterion of CRITERIA) {
      for (const proto of criterionEmbeddings[criterion.id] ?? []) {
        const score = cosine(note.embedding, proto.vector);
        if (!best || score > best.score) best = { criterion, score };
      }
    }

    if (!best || best.score < MATCH_FLOOR) {
      unmatched.push({ ...note, score: best ? best.score : 0 });
      continue;
    }

    // Whether it is a problem: a separate decision over the whole prototype set.
    const polarity = polarityFor(
      best.criterion,
      note.embedding,
      criterionEmbeddings[best.criterion.id],
      note.transcript
    );

    const measurements = extractMeasurements(note.transcript);
    const check = compliance(
      best.criterion,
      measurementFor(best.criterion, measurements, note.transcript),
      polarity
    );

    findings.push({
      noteId: note.id,
      criterionId: best.criterion.id,
      criterion: best.criterion.label,
      cite: best.criterion.cite,
      rule: best.criterion.rule,
      confidence: Math.round(best.score * 100) / 100,
      transcript: note.transcript.trim(),
      measurements,
      gps: note.gps ?? null,
      at: note.at,
      elapsedMs: note.elapsedMs ?? null,
      ...check,
      severity: severityFor(best.criterion, check, note.transcript)
    });
  }

  const rank = { blocking: 0, major: 1, minor: 2, observation: 3 };
  findings.sort((a, b) => (rank[a.severity] - rank[b.severity]) || (b.confidence - a.confidence));

  return { findings, unmatched };
}

export function summarize(findings) {
  const counts = { blocking: 0, major: 0, minor: 0, observation: 0 };
  const touched = new Set();
  let nonCompliant = 0;
  let unmeasured = 0;
  for (const f of findings) {
    counts[f.severity] += 1;
    touched.add(f.criterionId);
    if (f.status === 'non-compliant') {
      nonCompliant += 1;
      if (f.unmeasured) unmeasured += 1;
    }
  }
  return {
    counts,
    nonCompliant,
    unmeasured,
    criteriaTouched: touched.size,
    criteriaTotal: CRITERIA.length,
    notReviewed: CRITERIA.filter((c) => !touched.has(c.id)).map((c) => c.label)
  };
}
