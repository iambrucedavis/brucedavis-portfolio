// voice_check — taste-as-API (critique).
// Runs a draft against Bruce's voice rules. Returns specific violations with
// verbatim excerpts and a one-line suggestion per finding. Does NOT rewrite —
// the caller (Claude) does the rewrite. The tool encodes constraints, not agency.

import { z } from 'zod';
import {
  HEDGE_TERMS, FILLER_TRANSITIONS, MARKETING_WARMTH,
  SENTENCE_CAP, SUGGESTIONS,
} from '../lib/voice-rules.js';

const inputSchema = {
  draft:   z.string().min(1).describe("The piece of copy to critique. Plain text."),
  context: z.enum(['hero', 'project_card', 'section_lede', 'case_study', 'general'])
            .optional()
            .describe("Where this copy will live. Adjusts sentence-length tolerance. Default 'general'."),
};

const description =
  "Critique a draft against Bruce Davis's voice rules: no hedging, no filler transitions, no marketing " +
  "warmth, no repeated ideas, short sentences. Returns specific violations with verbatim excerpts and " +
  "concrete edits. Verdict is one of 'ship' | 'revise' | 'rewrite'. The tool does not rewrite — the " +
  "caller does. Run this on every paragraph of copy before shipping it.";

export function register(server) {
  server.registerTool(
    'voice_check',
    { description, inputSchema },
    async ({ draft, context = 'general' }) => {
      const violations = [];
      const lower = draft.toLowerCase();

      for (const term of HEDGE_TERMS) {
        for (const excerpt of findOccurrences(draft, lower, term)) {
          violations.push({
            rule: 'no_hedging',
            excerpt,
            why: `"${term}" is a hedge. Bruce's voice doesn't hedge.`,
            suggestion: SUGGESTIONS.no_hedging,
          });
        }
      }

      for (const term of FILLER_TRANSITIONS) {
        for (const excerpt of findOccurrences(draft, lower, term)) {
          violations.push({
            rule: 'no_filler',
            excerpt,
            why: `"${term}" is a filler transition. Cut it; the next sentence should stand alone.`,
            suggestion: SUGGESTIONS.no_filler,
          });
        }
      }

      for (const term of MARKETING_WARMTH) {
        for (const excerpt of findOccurrences(draft, lower, term)) {
          violations.push({
            rule: 'no_marketing_warmth',
            excerpt,
            why: `"${term}" is marketing warmth. Bruce's voice is deadpan precision.`,
            suggestion: SUGGESTIONS.no_marketing_warmth,
          });
        }
      }

      const cap = SENTENCE_CAP[context] ?? SENTENCE_CAP.general;
      for (const sentence of splitSentences(draft)) {
        const words = sentence.trim().split(/\s+/).filter(Boolean);
        if (words.length > cap) {
          violations.push({
            rule: 'short_sentence',
            excerpt: sentence.trim(),
            why: `Sentence is ${words.length} words. ${context} context cap is ${cap}.`,
            suggestion: SUGGESTIONS.short_sentence,
          });
        }
      }

      for (const dup of findRepeatedPhrases(draft, 5)) {
        violations.push({
          rule: 'no_repetition',
          excerpt: dup,
          why: `The phrase "${dup}" appears more than once. Either tighten the repeat or sharpen the second pass.`,
          suggestion: SUGGESTIONS.no_repetition,
        });
      }

      const verdict =
        violations.length === 0 ? 'ship' :
        violations.length <= 2  ? 'revise' :
                                  'rewrite';

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            verdict,
            violation_count: violations.length,
            context,
            violations,
            note: violations.length === 0
              ? "Heuristics passed. Consider whether the copy actually says something — heuristics don't catch empty."
              : "Heuristics caught these. There may be tone issues the heuristics missed; read it aloud.",
          }, null, 2),
        }],
      };
    },
  );
}

// Find all word-boundary matches of `term` in `draft`. Returns surrounding excerpts.
function findOccurrences(draft, lowerDraft, term) {
  const out = [];
  const t = term.toLowerCase();
  let from = 0;
  while (true) {
    const i = lowerDraft.indexOf(t, from);
    if (i < 0) break;
    if (isWordBoundary(lowerDraft, i, t.length)) {
      out.push(excerptAround(draft, i, t.length));
    }
    from = i + t.length;
  }
  return out;
}

function isWordBoundary(s, start, len) {
  const before = start === 0          ? ' ' : s[start - 1];
  const after  = start + len >= s.length ? ' ' : s[start + len];
  return /\W/.test(before) && /\W/.test(after);
}

function excerptAround(s, start, len, radius = 30) {
  const a = Math.max(0, start - radius);
  const b = Math.min(s.length, start + len + radius);
  return (a > 0 ? '…' : '') + s.slice(a, b).trim() + (b < s.length ? '…' : '');
}

function splitSentences(text) {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z"'(])/);
}

function findRepeatedPhrases(text, minWords) {
  const words = text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean);
  const seen = new Map();
  const out = new Set();
  for (let i = 0; i + minWords <= words.length; i++) {
    const phrase = words.slice(i, i + minWords).join(' ');
    if (seen.has(phrase)) {
      out.add(phrase);
    } else {
      seen.set(phrase, i);
    }
  }
  return [...out];
}
