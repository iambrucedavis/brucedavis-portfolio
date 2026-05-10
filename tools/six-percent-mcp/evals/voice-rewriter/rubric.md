# Voice rewriter rubric — v1

Used by the `voice_judge` tool to score rewrites against the original
paragraph. Four axes, scored 1–5 each. Pass threshold: total ≥ 16/20.

The rubric scores **rewrites**, not source text. Distinct from the
`voice_check` rules, which check compliance of any text.

---

## 1. `voice_match` — does the rewrite sound like the in-voice reference?

The reference is Bruce Davis's documented voice. Indicators:

- Short sentences that land cleanly
- Contrast used to make ideas clearer ("X. Y." not "X, but Y")
- Deadpan precision; no marketing warmth
- Functional words used as design material
- Internal language made public, not softened
- Says the obvious too directly when that creates character

Score:

- **5** — reads like it was lifted from the live site. Multiple voice-native moves.
- **4** — clearly in the voice. One or two phrases could be tighter.
- **3** — voice-aligned but blunted. Avoids violations but doesn't sound distinctive.
- **2** — neutral-to-corporate. A reader couldn't tell who wrote it.
- **1** — drifts back toward marketing / consultant prose.

---

## 2. `information_preserved` — does the rewrite say the same thing as the original?

Rewriting in voice ≠ rewriting the content. The rewrite must carry
the same facts, claims, and intent. Losing specifics in the name of
tightening is a fail.

Score:

- **5** — every claim from the original is present; nothing invented.
- **4** — all major claims present; minor specifics may be compressed but not lost.
- **3** — central claim preserved; one or two specifics dropped or shifted in meaning.
- **2** — substantial information lost or distorted.
- **1** — rewrite says something materially different from the original.

---

## 3. `concision` — is the rewrite at least as tight as the original?

In-voice prose is dense. Rewrites should be at least as tight (often
tighter) without losing information.

Score:

- **5** — meaningfully tighter than the original (≥ 15% fewer words) with information preserved.
- **4** — about the same length, but more information per word.
- **3** — about the same length, similar density.
- **2** — slightly longer than the original.
- **1** — meaningfully longer (≥ 15% more words) without adding information.

---

## 4. `specificity` — does the rewrite avoid generic claims?

In-voice prose names things precisely and grounds claims in
specifics. The rewrite should:

- Avoid hedge words (perhaps, maybe, might, sort of, kind of, somewhat)
- Avoid filler transitions (therefore, basically, essentially, that said, at the end of the day, in terms of)
- Avoid marketing warmth (amazing, incredible, awesome, leverage, synergy, elevate, empower, unleash, transform, cutting-edge, journey, passionate, dive deep)
- Replace abstractions with concrete nouns/verbs where the original allowed it

Score:

- **5** — no forbidden terms; abstractions replaced with specifics where possible.
- **4** — no forbidden terms; some abstractions remain.
- **3** — at most one forbidden term in a non-load-bearing position.
- **2** — multiple forbidden terms.
- **1** — heavy use of forbidden vocabulary; reads like marketing copy.

---

## Aggregation

```
total = voice_match + information_preserved + concision + specificity
verdict = total >= 16 ? 'pass' : total >= 12 ? 'borderline' : 'fail'
```

## Tie-breakers and notes for the judge

- `specificity` is the cleanest objective axis — count forbidden terms first; that anchors the score.
- `voice_match` is the most subjective; rely on the exemplars threaded into the work order.
- If the rewrite is identity (the agent returned the original unchanged), score 0 on `concision` and `voice_match` if the original was off-voice or generic. Identity on in-voice input is acceptable (note in rationale).
- The judge should output a brief `rationale` string explaining the lowest-scored axis. The rationale is what makes the eval set actionable for prompt iteration.

## Output format

The judge returns JSON conforming to this shape:

```json
{
  "voice_match": 4,
  "information_preserved": 5,
  "concision": 4,
  "specificity": 5,
  "total": 18,
  "verdict": "pass",
  "rationale": "Clean rewrite; one phrase ('built to') could be sharper but no voice violations."
}
```

## Versioning

This is v1. The rubric will iterate as the eval set surfaces gaps.
Bump the file's version header and note what changed in the case
study's iteration log.
