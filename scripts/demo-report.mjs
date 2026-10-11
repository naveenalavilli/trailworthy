// Runs the full pipeline on a scripted set of notes and writes the report to
// examples/, so the output can be reviewed without walking a trail first.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline, env } from '@huggingface/transformers';
import { CRITERIA, prototypesFor } from '../src/criteria.js';
import { analyzeNotes } from '../src/analyze.js';
import { buildMarkdown } from '../src/report.js';

env.allowLocalModels = false;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const embed = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'q8' });
const vec = async (t) => Array.from((await embed(t, { pooling: 'mean', normalize: true })).data);

const criterionEmbeddings = {};
for (const criterion of CRITERIA) {
  criterionEmbeddings[criterion.id] = await Promise.all(
    prototypesFor(criterion).map(async ({ text, polarity }) => ({ vector: await vec(text), polarity }))
  );
}

const SPOKEN = [
  'the sign at the trailhead says nothing about the surface or the grade',
  'accessible parking space is gravel and there is no curb ramp up to the path',
  'surface is packed crushed granite here and firm underfoot',
  'tread narrows to twenty six inches past the second bridge',
  'this climb runs about fourteen percent and it keeps going',
  'no bench anywhere on this climb, nowhere flat to stop and rest',
  'a root crosses the trail about four inches high right at the bend',
  'the path is off camber through here, it leans toward the creek about nine percent',
  'low branch over the tread, I have to duck under it',
  'wide pullout here, easily five feet across',
  'my daughter found a turtle down by the pond'
];

const start = Date.now() - 52 * 60 * 1000;
const notes = [];
for (let i = 0; i < SPOKEN.length; i += 1) {
  notes.push({
    id: `demo-${i}`,
    transcript: SPOKEN[i],
    embedding: await vec(SPOKEN[i]),
    at: start + i * 4.5 * 60 * 1000,
    elapsedMs: i * 4.5 * 60 * 1000,
    // Walking east along a bayou trail, roughly Houston.
    gps: { lat: 29.7762 + i * 0.0004, lon: -95.5580 + i * 0.0011, accuracy: 6 }
  });
}

const { findings, unmatched } = analyzeNotes(notes, criterionEmbeddings);

const survey = {
  trailName: 'Terry Hershey Park, west of Beltway 8',
  surveyor: 'Sample surveyor',
  agency: 'Harris County Precinct 3 Parks',
  startedAt: start,
  noteCount: SPOKEN.length,
  screenOffMs: 47 * 60 * 1000,
  startGps: { lat: 29.7762, lon: -95.5580, accuracy: 6 }
};

const markdown = buildMarkdown(survey, findings);
mkdirSync(join(ROOT, 'examples'), { recursive: true });
writeFileSync(join(ROOT, 'examples', 'sample-report.md'), markdown);

console.log(markdown);
console.log(`\n---\n${findings.length} findings filed, ${unmatched.length} notes set aside as not accessibility observations.`);
for (const note of unmatched) console.log(`  set aside (${note.score.toFixed(3)}): "${note.transcript}"`);
