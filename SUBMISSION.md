---
title: I built a trail accessibility surveyor that runs with the radio off
tags: devchallenge, hf26challenge, opensource, ai
---

*This is a submission for the [Hacktoberfest Open-Source AI Challenge Week 1: Touch Grass](https://dev.to/challenges/hacktoberfest-week1-2026-10-05)*

## What I Built

**Trailworthy** turns a walk down a trail into an accessibility report a parks department can act on.

Public trails are supposed to meet the Architectural Barriers Act Accessibility Standard. Most have never been checked against it, and the reason is boring: a survey means a clipboard, a tape measure, a copy of the standard, and someone willing to type it all up afterwards. So the surveys do not happen. And the trails nobody surveys are the trails nobody complains about, because the people who would complain gave up on them a long time ago.

Trailworthy makes the field half of that job take no more effort than talking.

At the trailhead you name the trail. On the trail the screen goes dark and there is exactly one button. Hold it, say what you see, let go, put the phone back in your pocket. Nothing is transcribed, nothing is uploaded, nothing asks you to look at it. The only number the app tracks while you walk is how long your screen stayed off.

Back home you hit develop. Whisper transcribes each note on your device. A sentence embedding model routes each note to the right accessibility criterion. Any measurement you spoke gets checked against the actual threshold. What comes out is a cited report:

> ### 1. Tread obstacles - Blocking
> **Citation** ABAAS F247.6 / FSTAG 7.7
> **Requirement** Tread obstacles may not exceed 2 in high.
> **Measured** 4 in (100% outside the limit)
> **Location** 29.77860, -95.55140 (±6 m)
>
> > a root crosses the trail about four inches high right at the bend

It is for the people who already do this work: accessibility advocates, trail volunteers, parks staff with eleven other jobs, and anyone who has turned around on a trail that was advertised as accessible and wants to say so in a form that is hard to ignore.

## Demo

**Try it:** https://naveenalavilli.github.io/trailworthy/

Load the models once (about 70 MB), then put the device in airplane mode and the whole survey still works. It installs as a PWA.

A full generated report from a scripted set of notes is in the repo at [`examples/sample-report.md`](https://github.com/naveenalavilli/trailworthy/blob/main/examples/sample-report.md), if you want to see the output without walking anywhere.

## Code

https://github.com/naveenalavilli/trailworthy

```
src/criteria.js    ABAAS/FSTAG criteria, thresholds, citations, prototype phrasings
src/measure.js     pulls spoken measurements out of a transcript
src/analyze.js     routing, polarity, compliance and severity
src/report.js      the Markdown and printable report
src/worker.js      both models, off the UI thread
scripts/           icon generation, threshold calibration, the polarity experiment
tests/             runs against the real embedding model, not mocked vectors
```

## How I Built It

Two open-weight models, both in the browser through [transformers.js](https://github.com/huggingface/transformers.js), both in a web worker:

| Piece | Model | Licence |
| ----- | ----- | ------- |
| Speech to text | [`Xenova/whisper-tiny.en`](https://huggingface.co/Xenova/whisper-tiny.en) | MIT |
| Note classification | [`Xenova/all-MiniLM-L6-v2`](https://huggingface.co/Xenova/all-MiniLM-L6-v2) | Apache-2.0 |

Classification is the interesting half. People do not talk in the language of a standard. Nobody stands on a trail and says "the cross slope exceeds 1:20". They say "it leans toward the creek", or "off camber here", or "water's cut a channel across the path". Those share no keywords with each other or with the standard, but they sit close together in embedding space. Each criterion carries a handful of example phrasings, everything gets embedded once on load, and each note goes to its nearest neighbour.

Three things about that turned out to be less obvious than they looked.

### The classifier needed a floor, and the floor needed data

Nearest-neighbour routing always returns a nearest neighbour. Without a floor, "my daughter found a turtle by the pond" gets filed as a tread obstacle, and the report is junk.

So I wrote `scripts/calibrate.mjs`, which scores a labelled set of real observations against a set of ordinary trail chatter and prints the gap:

```
lowest real observation : 0.576
highest chatter         : 0.458
separable               : yes
suggested MATCH_FLOOR   : 0.517
```

The threshold is the midpoint, and it is in the repo as a script rather than a magic number in a comment, so anyone editing the phrasings can re-derive it instead of guessing.

### Embeddings are bad at negation, and that is dangerous here

"Nothing on the sign about the grade" and "the sign lists the grade" are near neighbours. They are topically identical and mean opposite things. The first was being filed as **compliant**.

Think about what that means for this particular app. A barrier with no number attached, a missing curb ramp, no bench on a long climb, nothing on the trailhead sign, would land in the "meets the standard" pile precisely *because* there was nothing to measure. The report would be confidently, quietly wrong in the one direction it must never be wrong in.

I split the decision in two. Routing picks the criterion. A separate step decides whether the note describes that criterion being wrong or being fine, by giving each criterion two sets of phrasings, one for each. Then I tested three ways of making that call on hand-labelled notes:

```
nearest prototype:               25/29
mean per side:                   27/29
mean + negation flip:            22/29
shipped (flip unless reassured): 28/29
```

The fix averages similarity across each side rather than trusting the single closest phrase, then treats absence wording ("no", "nothing", "nowhere", "without") as its own signal. It only ever flips toward "barrier", and never for criteria whose compliant wording is itself negative, like "no noticeable cross slope". The experiment is in the repo.

That first version scored 18/18 on its original set, and it was still wrong. Any "no" or "not" flipped a note, so "the gate is fine, no trouble getting a chair through" became a *blocking* barrier. Adding notes where the negation lands on the problem ("not a problem", "no low branches") dropped it to 22/29. Those phrasings now switch the flip off, but never flip a note toward "fine" on their own, so the one remaining miss errs toward a barrier a human strikes out rather than one nobody sees.

### WebGPU built perfectly and then hung

The obvious setup is WebGPU with a WASM fallback, and the obvious place to catch failure is where the pipeline is constructed. Neither survived a real browser.

The session built. The warm-up inference returned. Every call after that hung forever. Nothing ever threw, so the fallback never fired, and the progress bar just sat at 100% looking healthy.

Two changes came out of it. The fallback is now driven by a **timed warm-up inference**, because a backend that builds is not a backend that works. And WASM is the default: these models are small and the work is many short sequential calls, which WASM does in 1.4 s for the whole prototype set and 31 ms for four notes. WebGPU is behind `?gpu=1`.

There was a fourth, more embarrassing one. I spent a while debugging a fix that had already shipped, because my service worker cached same-origin assets cache-first and was serving my own stale code back to me. That is the standard offline recipe and it pins every user to whatever build they first loaded. Everything the app ships itself is now network-first with a cache fallback, which is still completely offline on a trail but can be fixed afterwards. Two quieter holes turned up in review: a first visit cached almost nothing, because the service worker registers after the scripts load, and the ONNX runtime's 21 MB of wasm came from a CDN by default. The build now hands the service worker a full precache list, and the runtime loads from the app itself.

## Why Does Open Innovation Matter?

A closed API would transcribe audio more accurately than `whisper-tiny.en`. It still could not do this job.

**The trails that most need surveying are the ones with no signal.** That is not a coincidence. Remote and under-maintained trails are both less likely to have coverage and less likely to have ever been assessed. Every note becomes a failed request exactly where the work matters most. Running the model on the device is not an optimisation here, it is the difference between the app working and not existing.

**The data is unusually personal.** A survey is a precise record of where a disabled person went, how long they took, where they struggled and where they turned around. Shipping that to someone's servers to get it typed up is a bad trade. On-device inference means I am not asking anyone to trust me, because there is nothing for me to be trusted with. I do not have a server. There is no account.

**Nobody is funding this.** This work gets done by volunteers and small advocacy groups. A per-minute transcription bill is one of the reasons it does not happen. Zero marginal cost is not a nice-to-have, it is the thing that makes a hundred surveys possible instead of three.

**The thresholds are arguable, and should be.** ABAAS has conditions and exceptions, and reasonable people disagree about how a given trail should be read. Everything that encodes judgment here, the thresholds, the phrasings, the severity defaults, lives in one readable file. Fork it, change a number, re-run `npm run calibrate`, and see what moved. A hosted classifier would make that an argument with a vendor instead of a pull request.

The honest summary: open weights are what made the hard constraint (no signal, no server, no cost) satisfiable at all, and open source is what makes the judgment calls contestable by the people who actually use the trails.

## What it deliberately does not do

It will not tell you a trail is compliant. It reports what it heard you say, against the criterion it thinks you meant, with a confidence number attached, and the report says in plain language that a human has to verify every finding before it goes to an agency. Measurements come from a person and a tape measure, not from a model. An accessibility report that overstates its own certainty is worse than no report, because it gets one person dismissed and then everyone after them.

## Prize Categories

Entering the overall category. The project uses open-weight models and an open-source runtime rather than any partner's technology, so I am not claiming a partner category I did not genuinely use.

---

Built in the open for Hacktoberfest Week 1. If you work for a parks department and want a survey of a specific trail, open an issue and I will go walk it.
