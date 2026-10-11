// Builds the artifact that actually gets handed to a parks department.
//
// The point of the whole app is this file: a survey that stays on your phone is
// a diary, and a diary does not get a trail fixed.

import { CRITERIA } from './criteria.js';
import { summarize } from './analyze.js';

const SEVERITY_LABEL = {
  blocking: 'Blocking',
  major: 'Major',
  minor: 'Minor',
  observation: 'Observation'
};

function fmt(value, unit) {
  if (value === null || value === undefined) return '-';
  const rounded = Math.round(value * 10) / 10;
  if (unit === 'in' && rounded >= 12) {
    // Round to whole inches before splitting, so 47.6 is "4 ft", not "3 ft 12 in".
    const whole = Math.round(rounded);
    const feet = Math.floor(whole / 12);
    const inches = whole % 12;
    return `${rounded} in (${feet} ft${inches ? ` ${inches} in` : ''})`;
  }
  return `${rounded}${unit === '%' ? '%' : ` ${unit ?? ''}`.trimEnd()}`;
}

/** For anything the surveyor typed or said that ends up inside HTML. */
export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function coords(gps) {
  if (!gps) return 'not recorded';
  return `${gps.lat.toFixed(5)}, ${gps.lon.toFixed(5)}${gps.accuracy ? ` (±${Math.round(gps.accuracy)} m)` : ''}`;
}

function clock(ms) {
  if (ms === null || ms === undefined) return '';
  const total = Math.round(ms / 1000);
  const m = String(Math.floor(total / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${m}:${s}`;
}

export function buildMarkdown(survey, findings) {
  const stats = summarize(findings);
  const date = new Date(survey.startedAt);
  const lines = [];

  lines.push(`# Trail accessibility survey: ${survey.trailName || 'Unnamed trail'}`);
  lines.push('');
  lines.push(`**Surveyed** ${date.toLocaleDateString()} ${date.toLocaleTimeString()}  `);
  if (survey.surveyor) lines.push(`**Surveyor** ${survey.surveyor}  `);
  if (survey.agency) lines.push(`**Managing agency** ${survey.agency}  `);
  lines.push(`**Trailhead** ${coords(survey.startGps)}  `);
  lines.push(`**Notes recorded** ${survey.noteCount}  `);
  lines.push(`**Screen-off time during survey** ${clock(survey.screenOffMs)}`);
  lines.push('');
  lines.push('Measured against the Architectural Barriers Act Accessibility Standard');
  lines.push('(ABAAS) for Outdoor Developed Areas and the Forest Service Trail');
  lines.push('Accessibility Guidelines (FSTAG). Transcription and classification ran');
  lines.push('on the surveyor\'s own device; no audio or location data was uploaded.');
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Barriers found: **${stats.nonCompliant}** across ${stats.criteriaTouched} of ${stats.criteriaTotal} criteria`);
  lines.push(`- Blocking: ${stats.counts.blocking} · Major: ${stats.counts.major} · Minor: ${stats.counts.minor}`);
  if (stats.unmeasured) {
    lines.push(`- ${stats.unmeasured} of those were described but not measured, and need a number before filing`);
  }
  if (stats.notReviewed.length) {
    lines.push(`- Not covered by this survey: ${stats.notReviewed.join(', ')}`);
  }
  lines.push('');

  const barriers = findings.filter((f) => f.status === 'non-compliant');
  const others = findings.filter((f) => f.status !== 'non-compliant');

  if (barriers.length) {
    lines.push('## Barriers');
    lines.push('');
    lines.push('| # | Severity | Criterion | Standard | Measured | Location |');
    lines.push('| - | -------- | --------- | -------- | -------- | -------- |');
    barriers.forEach((f, i) => {
      const criterion = CRITERIA.find((c) => c.id === f.criterionId);
      const limit = criterion.unit
        ? `${criterion.compare === 'max' ? 'max' : 'min'} ${fmt(criterion.limit, criterion.unit)}`
        : 'qualitative';
      const measured = f.unmeasured ? 'not measured' : fmt(f.measured, criterion.unit);
      lines.push(`| ${i + 1} | ${SEVERITY_LABEL[f.severity]} | ${f.criterion} | ${limit} | ${measured} | ${coords(f.gps)} |`);
    });
    lines.push('');

    barriers.forEach((f, i) => {
      lines.push(`### ${i + 1}. ${f.criterion} - ${SEVERITY_LABEL[f.severity]}`);
      lines.push('');
      lines.push(`**Citation** ${f.cite}  `);
      lines.push(`**Requirement** ${f.rule}  `);
      if (f.unmeasured) {
        lines.push('**Measured** not measured in the field - recorded as a barrier from the description  ');
      } else {
        lines.push(`**Measured** ${fmt(f.measured, CRITERIA.find((c) => c.id === f.criterionId).unit)} (${f.over}% outside the limit)  `);
      }
      lines.push(`**Location** ${coords(f.gps)}  `);
      if (f.elapsedMs !== null) lines.push(`**Time into survey** ${clock(f.elapsedMs)}  `);
      lines.push('');
      lines.push(`> ${f.transcript}`);
      lines.push('');
      lines.push(`<sub>Classified on-device, confidence ${f.confidence}. Verify before filing.</sub>`);
      lines.push('');
    });
  }

  if (others.length) {
    lines.push('## Meets the standard');
    lines.push('');
    others.forEach((f) => {
      const measured = f.measured !== null && f.measured !== undefined
        ? ` - measured ${fmt(f.measured, CRITERIA.find((c) => c.id === f.criterionId).unit)}`
        : '';
      lines.push(`- **${f.criterion}** (${f.cite})${measured}: ${f.transcript}`);
    });
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('Generated by [Trailworthy](https://github.com/naveenalavilli/trailworthy),');
  lines.push('an offline trail accessibility scout. Findings are machine-classified from');
  lines.push('spoken field notes and are a starting point for a formal assessment, not a');
  lines.push('substitute for one.');

  return lines.join('\n');
}

export function buildPrintableHtml(survey, findings) {
  const markdown = buildMarkdown(survey, findings);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Trail accessibility survey: ${escapeHtml(survey.trailName || 'Unnamed trail')}</title>
<style>
  body { font: 15px/1.6 Georgia, serif; max-width: 42rem; margin: 3rem auto; padding: 0 1.5rem; color: #1a1a1a; }
  pre { white-space: pre-wrap; font: inherit; }
  @media print { body { margin: 0; } }
</style></head>
<body><pre>${escapeHtml(markdown)}</pre></body></html>`;
}
