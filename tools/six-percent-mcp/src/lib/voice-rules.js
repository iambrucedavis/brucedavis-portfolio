// Bruce Davis's voice rules — structured form of CLAUDE.md:72–78.
// Used by the voice_check tool. Heuristics are deliberately conservative;
// the tool reports findings, the reasoner (Claude) does the rewriting.

export const HEDGE_TERMS = [
  'perhaps', 'maybe', 'might', 'possibly', 'probably', 'somewhat',
  'sort of', 'kind of', 'a bit', 'a little',
  'I think', 'I believe', "I'd say", "I'd argue", 'in my opinion',
  'arguably', 'tends to', 'seems to', 'appears to',
];

export const FILLER_TRANSITIONS = [
  'therefore', 'thus', 'in conclusion', 'that said', "that's why",
  "I'm wondering", 'basically', 'essentially', 'to be honest',
  'at the end of the day', 'when it comes to', 'in terms of',
  'as a matter of fact', 'in many ways', 'it goes without saying',
];

export const MARKETING_WARMTH = [
  'amazing', 'incredible', 'awesome', 'exciting', 'passionate',
  'journey', 'dive deep', 'leverage', 'synergy', 'elevate',
  'empower', 'unleash', 'transform', 'revolutionary', 'game-changer',
  'cutting-edge', 'state of the art', 'best-in-class', 'world-class',
  'thrilled', 'delighted', 'love to', 'we love',
];

// Per-context sentence-length caps (words).
export const SENTENCE_CAP = {
  hero:          18,
  project_card:  22,
  section_lede:  22,
  case_study:    32,
  general:       28,
};

export const SUGGESTIONS = {
  no_hedging:           "Drop the hedge. Assert it.",
  no_filler:            "Cut the transition. Let the next sentence carry itself.",
  short_sentence:       "Split into two sentences. Each one should land alone.",
  no_marketing_warmth:  "Pick a literal word. The figurative one is a tell.",
  no_repetition:        "You've already said this. Either cut the repeat or sharpen the second pass into a new idea.",
  deadpan:              "Strip the warmth. State the fact.",
};
