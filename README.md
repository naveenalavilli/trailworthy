# Trailworthy

**Walk a trail, talk, and get an accessibility report your parks department can act on.**
Everything runs on your own device. No account, no server, no signal required.

Built for the [Hacktoberfest Open-Source AI Challenge, Week 1: Touch Grass](https://dev.to/challenges/hacktoberfest-week1-2026-10-05).

![Trailworthy icon](public/icon-192.png)

## The problem

Public trails are supposed to meet the Architectural Barriers Act Accessibility
Standard. Most have never been surveyed against it, because a survey means a
clipboard, a tape measure, a copy of the standard, and someone willing to type
it all up afterwards. The trails that do not get surveyed are the ones nobody
complains about, and nobody complains about a trail they already gave up on.

Trailworthy makes the field half of that job take no more effort than talking.

## How it works

1. **At the trailhead**, name the trail and start the survey. The microphone
   permission is requested here, where you still have a signal and a free hand.
2. **On the trail**, the screen goes dark and there is one button. Hold it, say
   what you see, let go. Nothing is transcribed yet, nothing is uploaded, and
   the phone goes back in your pocket. The app tracks how long the screen stayed
   off, which is the only number it is proud of.
3. **Back home**, hit develop. Whisper transcribes each note on your device, a
   sentence embedding model routes it to the right accessibility criterion, and
   any measurement you spoke is checked against the actual threshold.
4. **The output** is a cited report, in Markdown or printable form, that you can
   send to whoever manages the trail.

## The open-source AI, and why it had to be open

| Piece | Model | Licence | Why |
| ----- | ----- | ------- | --- |
| Speech to text | [`Xenova/whisper-tiny.en`](https://huggingface.co/Xenova/whisper-tiny.en) | MIT | Runs in the browser via ONNX Runtime Web, so a note taken four miles from a road is transcribed without ever needing a connection. |
| Note classification | [`Xenova/all-MiniLM-L6-v2`](https://huggingface.co/Xenova/all-MiniLM-L6-v2) | Apache-2.0 | People describe the same barrier a dozen ways. "Off camber", "leans toward the creek" and "water cut a side slope" share no keywords with "cross slope", but they sit next to each other in embedding space. |
| Runtime | [transformers.js](https://github.com/huggingface/transformers.js) | Apache-2.0 | Loads both models into a web worker with no backend to deploy or pay for. |

A closed API could transcribe audio more accurately. It could not do this job:

- **No signal.** The trails that most need surveying are the ones without
  coverage. A hosted API turns every note into a failed request.
- **The data is sensitive.** A survey is a precise record of where a disabled
  person went, how long they stayed and what they struggled with. That belongs
  on their phone, not in someone's logs.
- **Nobody is paying for this.** These surveys get done by volunteers and
  advocacy groups. A per-minute transcription bill is the reason the work does
  not happen. Zero marginal cost is the feature.
- **The thresholds are arguable.** ABAAS has conditions and exceptions. Anyone
  can fork `src/criteria.js`, change a number or a phrasing, and re-run
  `npm run calibrate` to see what it did.

## Four things that were not obvious

**The classifier needed a floor, and the floor needed data.** Forcing every note
onto its nearest criterion files "my daughter found a turtle by the pond" as a
tread obstacle. `scripts/calibrate.mjs` scores a labelled set of real
observations against a set of ordinary trail chatter and prints the gap between
them: observations bottom out at 0.576, chatter tops out at 0.458, and
`MATCH_FLOOR` sits between the two. Changing any prototype means re-running it.

**Embeddings are bad at negation.** "Nothing on the sign about the grade" and
"the sign lists the grade" are near neighbours, so the first was being filed as
compliant. `scripts/polarity-experiment.mjs` compares four ways of deciding
whether a note describes a problem or describes things being fine, over notes
labelled by hand:

```
nearest prototype:               25/29
mean per side:                   27/29
mean + negation flip:            22/29
shipped (flip unless reassured): 28/29
```

The fix is in `polarityFor()`: average the similarity to each side rather than
trusting the single nearest phrase, then treat absence wording as its own
signal, flipping only toward "barrier" and only for criteria whose compliant
wording is not itself negative.

The first version of that flip fired on any "no" or "not", which turned "the
gate is fine, no trouble getting a chair through" into a blocking barrier. On
an 18-note set it scored 18/18; adding notes where the negation lands on the
problem ("not a problem", "no low branches") dropped it to 22/29. Those
phrasings now switch the flip off. They never flip a note toward ok on their
own, so the one remaining miss, "not steep at all", errs toward a barrier a
human will strike rather than a barrier nobody sees. A threshold on the gap
between the two sides was tried first and does not work: barrier and ok notes
with negation overlap almost exactly.

That matters more than the accuracy number suggests. A barrier with no number
attached, like a missing curb ramp, used to land in the compliant pile simply
because there was nothing to measure. That is the one failure mode this report
cannot have.

**WebGPU built fine and then hung.** The obvious device preference is WebGPU
with a WASM fallback, and the obvious place to catch the failure is where the
pipeline is constructed. Neither survived contact with a real browser: the
session built, the first inference returned, and every call after it hung
forever, so nothing ever threw and the fallback never fired. The progress bar
just sat at 100%.

Two changes came out of that. The fallback is now driven by a timed warm-up
inference rather than by construction, because a backend that builds is not a
backend that works. And WASM is the default: these models are small and the
workload is many short sequential calls, which WASM handles in 1.4 s for the
full prototype set and 31 ms for four notes. WebGPU is behind `?gpu=1`.

**A cache-first service worker pinned the app to its first build.** Caching
same-origin assets cache-first is the standard offline recipe, and it meant my
own code changes could not reach the browser: I spent a while debugging a fix
that had already shipped and was simply never being served. Everything this
repo ships is now network-first with a cache fallback, which is still fully
offline on a trail but can be fixed afterwards.

Two more holes turned up later. The service worker registers after the page's
scripts have loaded, so a first visit cached almost nothing; the build now
writes `precache.json` and the worker fetches all of it at install. And
transformers.js loads the ONNX runtime's 21 MB of wasm from jsDelivr unless
told otherwise, which is only offline if the browser happens to keep it. It now
loads the copy Vite already bundles. Model weights are left to transformers.js's
own cache, which works before the service worker is in control.

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # routing, polarity and measurement parsing, against the real model
npm run calibrate  # re-derive MATCH_FLOOR after editing prototypes
node scripts/polarity-experiment.mjs  # re-score barrier-vs-ok after editing NEGATION or REASSURANCE
npm run demo       # full pipeline over scripted notes -> examples/sample-report.md
npm run build
```

Models download once (about 70 MB) and are then served from the browser cache.
After that the app works with the device in airplane mode, and installs as a
PWA.

## What it does not do

It will not tell you a trail is compliant. It reports what it heard you say,
against the criterion it thinks you meant, with a confidence number attached.
Every finding needs a human to verify it before it goes to an agency, and the
report says so. Measurements come from you and a tape measure, not from the
model.

## Layout

```
src/criteria.js    ABAAS/FSTAG criteria, thresholds, citations, prototype phrasings
src/measure.js     pulls spoken measurements out of a transcript
src/analyze.js     routing, polarity, compliance and severity
src/report.js      the Markdown and printable report
src/worker.js      both models, off the UI thread
scripts/           icon generation, threshold calibration, the polarity experiment
tests/             runs against the real embedding model, not mocked vectors
```

## Licence

MIT. See [LICENSE](LICENSE).
