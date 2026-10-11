// Embedding similarity is weak at negation: "nothing on the sign about the
// grade" and "the sign lists the grade" are near neighbours. This compares
// four ways of deciding barrier-vs-ok on notes that are labelled by hand. The
// last one is the shipped polarityFor(), not a copy of it.

import { pipeline, env } from '@huggingface/transformers';
import { CRITERIA, prototypesFor } from '../src/criteria.js';
import { cosine, polarityFor } from '../src/analyze.js';

env.allowLocalModels = false;

const embed = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'q8' });
const vec = async (t) => Array.from((await embed(t, { pooling: 'mean', normalize: true })).data);

const protos = {};
for (const criterion of CRITERIA) {
  protos[criterion.id] = await Promise.all(
    prototypesFor(criterion).map(async ({ text, polarity }) => ({ vector: await vec(text), polarity }))
  );
}

const NEGATION = /\b(no|not|nothing|none|never|without|lacks?|lacking|missing|isn't|aren't|doesn't|don't|didn't|won't|can't|cannot|nowhere|nobody)\b/i;

function route(v) {
  let best = null;
  for (const criterion of CRITERIA) {
    for (const p of protos[criterion.id]) {
      const score = cosine(v, p.vector);
      if (!best || score > best.score) best = { criterion, score, polarity: p.polarity };
    }
  }
  return best;
}

function byMean(v, criterion) {
  const sums = { barrier: [], ok: [] };
  for (const p of protos[criterion.id]) sums[p.polarity].push(cosine(v, p.vector));
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
  return mean(sums.barrier) >= mean(sums.ok) ? 'barrier' : 'ok';
}

// text, expected polarity
const LABELLED = [
  ['nothing on the sign about the surface or the grade', 'barrier'],
  ['there is no bench anywhere on this climb', 'barrier'],
  ['no curb ramp from the lot to the trail', 'barrier'],
  ['the sign lists distance, surface type and grade', 'ok'],
  ['there is a bench at the top of the climb', 'ok'],
  ['a paved route runs from the lot to the trailhead', 'ok'],
  ['loose gravel underfoot, my shoes are sliding', 'barrier'],
  ['the tread is hard packed and stable the whole way', 'ok'],
  ['no place for two people to pass each other', 'barrier'],
  ['there is a wide pullout here', 'ok'],
  ['the tread is clear of obstacles through this section', 'ok'],
  ['a downed log is lying across the path', 'barrier'],
  ['no noticeable cross slope through here', 'ok'],
  ['the path leans hard toward the creek', 'barrier'],
  ['branches are cut well back, clearance is fine', 'ok'],
  ['low branch, I have to duck under it', 'barrier'],
  ['the gate opening is wide and easy to swing', 'ok'],
  ['the gap in the fence is too narrow to get through', 'barrier'],
  // Negation that describes a missing feature...
  ['there is no accessible parking here', 'barrier'],
  ['nowhere to sit the whole way up', 'barrier'],
  ['no information about the surface at the trailhead', 'barrier'],
  ['the trail is not wide enough for a chair', 'barrier'],
  // ...and negation that says the problem is absent.
  ['the gate is fine, no trouble getting a chair through', 'ok'],
  ['the trail width is not a problem, easily five feet', 'ok'],
  ['no problem with the surface, it is packed and firm', 'ok'],
  ['the grade is not bad through this section', 'ok'],
  ['no low branches anywhere, clearance is fine', 'ok'],
  ['the sign is not bad, it lists the grade and surface', 'ok'],
  // The vectors read this one as a steep climb before negation is considered,
  // and nothing here flips toward ok. Kept as a known miss.
  ['the climb here is not steep at all, nice and gentle', 'ok']
];

const strategies = {
  'nearest prototype': (v, best) => best.polarity,
  'mean per side': (v, best) => byMean(v, best.criterion),
  'mean + negation flip': (v, best, text) => {
    const polarity = byMean(v, best.criterion);
    // Absence phrasing almost always describes a missing feature, which is a
    // barrier, but only flip toward barrier - "no obstacles here" is fine and
    // already lands on ok by mean.
    if (polarity === 'ok' && NEGATION.test(text)) {
      const okProtoNegated = best.criterion.ok.some((t) => NEGATION.test(t));
      if (!okProtoNegated) return 'barrier';
    }
    return polarity;
  },
  'shipped (flip unless reassured)': (v, best, text) =>
    polarityFor(best.criterion, v, protos[best.criterion.id], text)
};

const results = {};
for (const name of Object.keys(strategies)) results[name] = [];

for (const [text, expected] of LABELLED) {
  const v = await vec(text);
  const best = route(v);
  for (const [name, fn] of Object.entries(strategies)) {
    const got = fn(v, best, text);
    results[name].push({ text, expected, got, ok: got === expected });
  }
}

for (const [name, rows] of Object.entries(results)) {
  const right = rows.filter((r) => r.ok).length;
  console.log(`\n${name}: ${right}/${rows.length}`);
  for (const row of rows.filter((r) => !r.ok)) {
    console.log(`   wrong: "${row.text}" -> ${row.got} (wanted ${row.expected})`);
  }
}
