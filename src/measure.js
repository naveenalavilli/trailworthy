// Pulls measurements out of spoken text.
//
// Whisper writes numbers as words about as often as digits, and nobody standing
// on a trail says "thirty-six inches" the same way twice, so this handles both
// forms plus the shorthand people actually use ("three foot six", "one in twelve").

const WORD_NUMBERS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90, hundred: 100, half: 0.5, quarter: 0.25
};

// Longest first, so "thirty" is never consumed as "three" mid-alternation.
const WORDS = Object.keys(WORD_NUMBERS).sort((a, b) => b.length - a.length).join('|');

function wordsToNumber(phrase) {
  const parts = phrase.toLowerCase().replace(/-/g, ' ').split(/\s+/).filter(Boolean);
  let total = 0;
  let matched = false;
  for (const part of parts) {
    if (part === 'and' || part === 'a') continue;
    const value = WORD_NUMBERS[part];
    if (value === undefined) return null;
    matched = true;
    // "three hundred" multiplies what came before; everything else adds.
    if (value === 100) total = (total || 1) * 100;
    else total += value;
  }
  return matched ? total : null;
}

function toNumber(raw) {
  if (raw === undefined || raw === null) return null;
  const trimmed = String(raw).trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return parseFloat(trimmed);
  return wordsToNumber(trimmed);
}

const NUM = String.raw`(?:\d+(?:\.\d+)?|(?:${WORDS})(?:[ -](?:${WORDS}))*)`;

const re = (body, flags = 'gi') => new RegExp(body, flags);

const COMPOUND = re(String.raw`(${NUM})\s*(?:feet|foot|ft)\b\s*(?:and\s+)?(?:a\s+)?(${NUM})\s*(?:inches|inch|in)\b`);
const FEET = re(String.raw`(${NUM})\s*(?:feet|foot|ft)\b`);
const INCHES = re(String.raw`(${NUM})\s*(?:inches|inch|in)\b`);
const PERCENT = re(String.raw`(${NUM})\s*(?:percent|%)`);
const DEGREES = re(String.raw`(${NUM})\s*(?:degrees|degree)\b`);
// The leading boundary keeps "21 to 30" and "someone to" from reading as "1 to".
// The lookaheads turn away ranges and counts ("one to thirty inches", "one to
// two people"), including the shorter number a backtrack would otherwise find.
const RATIO = re(String.raw`\b(?:one|1)\s*(?:in|to|:)\s*(${NUM})(?![\d.])(?![ -](?:${WORDS})\b)(?!\s*(?:feet|foot|ft|inches|inch|in|percent|%|degrees?|miles?|people|persons?)\b)`);
const MILES = re(String.raw`(${NUM})\s*(?:a\s+)?(?:miles|mile)\b`);

function collect(text, pattern, convert, unit, kind) {
  const out = [];
  pattern.lastIndex = 0;
  let m;
  while ((m = pattern.exec(text)) !== null) {
    const value = convert(m);
    if (value === null || Number.isNaN(value)) continue;
    out.push({ value, unit, kind, raw: m[0].trim(), index: m.index });
  }
  return out;
}

/**
 * Extracts every measurement in a transcript, normalised to inches for lengths,
 * percent for slopes and feet for distances.
 */
export function extractMeasurements(text) {
  if (!text) return [];
  const lower = text.toLowerCase();

  // Compound "3 ft 6 in" is matched first and its span blocks the simpler
  // feet/inches patterns, which would otherwise report 36 in and 6 in too.
  const compound = collect(lower, COMPOUND, (m) => {
    const feet = toNumber(m[1]);
    const inches = toNumber(m[2]);
    return feet === null || inches === null ? null : feet * 12 + inches;
  }, 'in', 'length');

  // "one in twelve" is a slope, but the inch abbreviation inside it also looks
  // like a length, so ratio spans block length matches the same way.
  const ratios = collect(lower, RATIO, (m) => {
    const run = toNumber(m[1]);
    return run ? Math.round((100 / run) * 100) / 100 : null;
  }, '%', 'slope');

  const blocked = [...compound, ...ratios].map((h) => [h.index, h.index + h.raw.length]);
  const overlaps = (hit) => blocked.some(([s, e]) => hit.index >= s && hit.index < e);

  const lengths = [
    ...collect(lower, FEET, (m) => {
      const feet = toNumber(m[1]);
      return feet === null ? null : feet * 12;
    }, 'in', 'length'),
    ...collect(lower, INCHES, (m) => toNumber(m[1]), 'in', 'length')
  ].filter((hit) => !overlaps(hit));

  const slopes = [
    ...collect(lower, PERCENT, (m) => toNumber(m[1]), '%', 'slope'),
    // A hand level reads degrees; the standards are written in percent.
    ...collect(lower, DEGREES, (m) => {
      const deg = toNumber(m[1]);
      return deg === null ? null : Math.round(Math.tan((deg * Math.PI) / 180) * 1000) / 10;
    }, '%', 'slope'),
    ...ratios
  ];

  const distances = collect(lower, MILES, (m) => {
    const miles = toNumber(m[1]);
    return miles === null ? null : miles * 5280;
  }, 'ft', 'distance');

  return [...compound, ...lengths, ...slopes, ...distances].sort((a, b) => a.index - b.index);
}

// 50 ft. Spacing between features is reported in hundreds of feet, and the
// widths said alongside it never get near this.
const MIN_SPACING_IN = 600;

/** Characters between a measurement and the nearest cue word for a criterion. */
function cueDistance(text, hit, cues) {
  let nearest = Infinity;
  for (const cue of cues) {
    const pattern = new RegExp(String.raw`\b${cue}`, 'g');
    let m;
    while ((m = pattern.exec(text)) !== null) {
      const end = hit.index + hit.raw.length;
      const gap = m.index >= end ? m.index - end : Math.max(0, hit.index - (m.index + m[0].length));
      nearest = Math.min(nearest, gap);
    }
  }
  return nearest;
}

/**
 * Picks the measurement that matches the unit a criterion is written in.
 *
 * One note often carries two numbers of the same kind ("a root two inches high,
 * trail is 48 inches wide"), so when there is a choice the one sitting closest
 * to a word about this criterion wins, rather than whichever was said first.
 */
export function measurementFor(criterion, measurements, text = '') {
  if (!criterion.unit) return null;

  let candidates;
  if (criterion.unit === 'ft') {
    // Distances along the trail. Miles parse as distances, but "every 300 feet"
    // parses as a length, so long lengths are converted back to feet here.
    // Short ones are widths ("a pullout five feet across"), not spacing.
    candidates = measurements
      .filter((m) => m.kind === 'distance' || (m.kind === 'length' && m.value >= MIN_SPACING_IN))
      .map((m) => (m.kind === 'length' ? { ...m, value: m.value / 12, unit: 'ft', kind: 'distance' } : m));
  } else {
    const wanted = criterion.unit === '%' ? 'slope' : 'length';
    candidates = measurements.filter((m) => m.kind === wanted);
  }

  if (candidates.length < 2 || !criterion.measureCues?.length) return candidates[0] ?? null;

  const lower = text.toLowerCase();
  let best = candidates[0];
  let bestGap = cueDistance(lower, best, criterion.measureCues);
  for (const hit of candidates.slice(1)) {
    const gap = cueDistance(lower, hit, criterion.measureCues);
    if (gap < bestGap) {
      best = hit;
      bestGap = gap;
    }
  }
  return best;
}
