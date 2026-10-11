// Prints the similarity score every sample note gets, so MATCH_FLOOR is picked
// from the gap between real observations and trail chatter rather than guessed.

import { pipeline, env } from '@huggingface/transformers';
import { CRITERIA, prototypesFor } from '../src/criteria.js';
import { cosine } from '../src/analyze.js';

env.allowLocalModels = false;

const embed = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'q8' });
const vec = async (t) => Array.from((await embed(t, { pooling: 'mean', normalize: true })).data);

const criterionEmbeddings = {};
for (const criterion of CRITERIA) {
  criterionEmbeddings[criterion.id] = await Promise.all(
    prototypesFor(criterion).map(async ({ text, polarity }) => ({ vector: await vec(text), polarity }))
  );
}

const POSITIVE = [
  'the tread narrows down to about thirty inches right past the second bridge',
  'this climb is running around twelve percent for a good hundred feet',
  'the path is off camber here, it leans toward the creek',
  'loose gravel underfoot, my shoes are sliding',
  'theres a root crossing the trail about four inches high',
  'low branch, I have to duck under it',
  'the gap in the fence at the entrance is really narrow',
  'nothing on the sign about the surface or the grade',
  'the accessible parking space is just gravel',
  'no bench anywhere on this whole climb',
  'standing water right across the width of the trail',
  'the boardwalk has a two inch lip where it meets the dirt'
];

const NEGATIVE = [
  'the light coming through the oaks is really something this evening',
  'I think that was a pileated woodpecker',
  'note to self, bring more water next time',
  'my daughter found a turtle by the pond',
  'it smells like rain coming in',
  'parked at the north lot at nine fifteen',
  'that is a lot of poison ivy'
];

async function best(text) {
  const v = await vec(text);
  let top = { id: null, score: -1, polarity: null };
  for (const criterion of CRITERIA) {
    for (const proto of criterionEmbeddings[criterion.id]) {
      const score = cosine(v, proto.vector);
      if (score > top.score) top = { id: criterion.id, score, polarity: proto.polarity };
    }
  }
  return top;
}

const pos = [];
const neg = [];

console.log('\nOBSERVATIONS THAT SHOULD BE FILED');
for (const text of POSITIVE) {
  const top = await best(text);
  pos.push(top.score);
  console.log(`  ${top.score.toFixed(3)}  ${top.polarity.padEnd(8)} ${top.id.padEnd(20)} ${text}`);
}

console.log('\nTRAIL CHATTER THAT SHOULD NOT BE FILED');
for (const text of NEGATIVE) {
  const top = await best(text);
  neg.push(top.score);
  console.log(`  ${top.score.toFixed(3)}  ${top.polarity.padEnd(8)} ${top.id.padEnd(20)} ${text}`);
}

const lowestPositive = Math.min(...pos);
const highestNegative = Math.max(...neg);
console.log(`\nlowest real observation : ${lowestPositive.toFixed(3)}`);
console.log(`highest chatter         : ${highestNegative.toFixed(3)}`);
console.log(`separable               : ${lowestPositive > highestNegative ? 'yes' : 'NO - overlapping'}`);
console.log(`suggested MATCH_FLOOR   : ${((lowestPositive + highestNegative) / 2).toFixed(3)}`);
