// Runs the real embedding model, because the thing worth testing is whether a
// sentence a surveyor would actually say lands on the right standard. Mocked
// vectors would only test the cosine function.

import test from 'node:test';
import assert from 'node:assert/strict';
import { pipeline, env } from '@huggingface/transformers';
import { CRITERIA, prototypesFor } from '../src/criteria.js';
import { analyzeNotes } from '../src/analyze.js';
import { extractMeasurements, measurementFor } from '../src/measure.js';

env.allowLocalModels = false;

let embed;
let criterionEmbeddings;

async function setup() {
  if (criterionEmbeddings) return;
  embed = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'q8' });
  criterionEmbeddings = {};
  for (const criterion of CRITERIA) {
    const vectors = [];
    for (const { text, polarity } of prototypesFor(criterion)) {
      const out = await embed(text, { pooling: 'mean', normalize: true });
      vectors.push({ vector: Array.from(out.data), polarity });
    }
    criterionEmbeddings[criterion.id] = vectors;
  }
}

async function note(text, id = 'n1') {
  const out = await embed(text, { pooling: 'mean', normalize: true });
  return { id, transcript: text, embedding: Array.from(out.data), at: Date.now(), gps: null };
}

// Phrased the way someone talks while walking, not the way a standard is written.
const CASES = [
  ['the tread narrows down to about thirty inches right past the second bridge', 'tread-width'],
  ['this climb is running around twelve percent for a good hundred feet', 'running-slope'],
  ['the path is off camber here, it leans toward the creek', 'cross-slope'],
  ['loose gravel underfoot, my shoes are sliding', 'surface'],
  ['theres a root crossing the trail about four inches high', 'tread-obstacle'],
  ['low branch, I have to duck under it', 'protruding-object'],
  ['the gap in the fence at the entrance is really narrow', 'gate-opening'],
  ['nothing on the sign about the surface or the grade', 'trailhead-signage'],
  ['the accessible parking space is just gravel', 'parking-approach'],
  ['no bench anywhere on this whole climb', 'resting-interval']
];

test('field notes route to the right accessibility criterion', async () => {
  await setup();
  const failures = [];
  for (const [text, expected] of CASES) {
    const { findings } = analyzeNotes([await note(text)], criterionEmbeddings);
    const got = findings[0]?.criterionId ?? null;
    if (got !== expected) failures.push(`"${text}" -> ${got} (wanted ${expected})`);
  }
  assert.deepEqual(failures, [], `misrouted notes:\n${failures.join('\n')}`);
});

test('notes that are not accessibility observations are not filed as findings', async () => {
  await setup();
  const { findings, unmatched } = analyzeNotes(
    [await note('the light coming through the oaks is really something this evening')],
    criterionEmbeddings
  );
  assert.equal(findings.length, 0);
  assert.equal(unmatched.length, 1);
});

test('a measured barrier is scored against its standard', async () => {
  await setup();
  const { findings } = analyzeNotes(
    [await note('the tread narrows to twenty four inches here')],
    criterionEmbeddings
  );
  const finding = findings[0];
  assert.equal(finding.criterionId, 'tread-width');
  assert.equal(finding.status, 'non-compliant');
  assert.equal(finding.measured, 24);
  assert.equal(finding.limit, 36);
});

test('a compliant measurement is not reported as a barrier', async () => {
  await setup();
  const { findings } = analyzeNotes(
    [await note('clear tread width here is a comfortable forty eight inches')],
    criterionEmbeddings
  );
  assert.equal(findings[0].status, 'compliant');
});

test('a barrier with no number is still filed as a barrier', async () => {
  await setup();
  const { findings } = analyzeNotes(
    [await note('there is no curb ramp from the lot up to the trail')],
    criterionEmbeddings
  );
  const finding = findings[0];
  assert.equal(finding.criterionId, 'parking-approach');
  assert.equal(finding.status, 'non-compliant');
  assert.equal(finding.unmeasured, true);
  // Severity falls back to how bad this barrier is when present at all.
  assert.equal(finding.severity, 'blocking');
});

test('the same criterion described as fine is not filed as a barrier', async () => {
  await setup();
  const { findings } = analyzeNotes(
    [await note('a paved route runs straight from the accessible stalls to the trailhead')],
    criterionEmbeddings
  );
  assert.equal(findings[0].criterionId, 'parking-approach');
  assert.equal(findings[0].status, 'compliant');
  assert.equal(findings[0].severity, 'observation');
});

test('measurements survive the way people actually say them', () => {
  assert.equal(extractMeasurements('three feet six inches wide')[0].value, 42);
  assert.equal(extractMeasurements('grade is one in twelve')[0].value, 8.33);
  assert.equal(extractMeasurements('about 36 inches')[0].value, 36);
  assert.equal(extractMeasurements('hand level reads five degrees')[0].value, 8.7);
});

test('saying a problem is absent is not filed as a barrier', async () => {
  await setup();
  // Each of these has a negation word, which used to flip it to a barrier.
  for (const text of [
    'the gate is fine, no trouble getting a chair through',
    'the trail width is not a problem, easily five feet',
    'no problem with the surface, it is packed and firm'
  ]) {
    const { findings } = analyzeNotes([await note(text)], criterionEmbeddings);
    assert.equal(findings[0].status, 'compliant', text);
  }
});

test('a missing feature is still a barrier after the reassurance check', async () => {
  await setup();
  const { findings } = analyzeNotes(
    [await note('nothing on the sign about the surface or the grade')],
    criterionEmbeddings
  );
  assert.equal(findings[0].status, 'non-compliant');
});

test('ranges, counts and words containing "one" are not read as slopes', () => {
  const kinds = (text) => extractMeasurements(text).map((m) => [m.kind, m.value]);
  assert.deepEqual(kinds('narrows from 21 to 30 inches'), [['length', 30]]);
  assert.deepEqual(kinds('someone to 3 feet'), [['length', 36]]);
  assert.deepEqual(kinds('one to two people wide'), []);
  assert.deepEqual(kinds('1:20 cross slope'), [['slope', 5]]);
  assert.deepEqual(kinds('half a mile with no pullout'), [['distance', 2640]]);
});

test('with two numbers in a note, each criterion takes the one about it', () => {
  const criterion = (id) => CRITERIA.find((c) => c.id === id);
  const pick = (id, text) => measurementFor(criterion(id), extractMeasurements(text), text).value;

  const root = 'a root about two inches high and the trail is 48 inches wide';
  assert.equal(pick('tread-width', root), 48);
  assert.equal(pick('tread-obstacle', root), 2);

  // Passing space is measured along the trail, and people say that in feet.
  const pass = 'trail is 3 feet wide with nowhere to pass for 1200 feet';
  assert.equal(pick('passing-space', pass), 1200);
  assert.equal(pick('tread-width', pass), 36);
});
