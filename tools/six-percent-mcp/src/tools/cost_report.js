// cost_report — taste-as-API (retrieval / aggregation).
// Stage 5 of the document processing pipeline. Aggregates per-stage token
// estimates and converts to USD using published model rates. Returns a
// per-stage breakdown, totals, and scaling projections (per 1k docs).
//
// Mode is 'estimated' because the work-order pattern doesn't call the API
// directly. When the pipeline runs against the real API, the same tool
// works with measured tokens supplied by the orchestrator.
//
// Does not call a model.

import { z } from 'zod';

const inputSchema = {
  doc_id:   z.string().optional(),
  doc_type: z.string(),
  stages:   z.array(z.object({
              stage:      z.string(),
              tokens_in:  z.number().int().nonnegative(),
              tokens_out: z.number().int().nonnegative().optional(),
              method:     z.string().optional(),
            })).min(1),
  pricing_model: z.string().optional()
                  .describe("Model name for pricing lookup. Default 'claude-sonnet-4-6'."),
};

const description =
  "Stage 5 of the document processing pipeline. Aggregates per-stage token estimates and converts to " +
  "USD using published Anthropic rates. Returns per-stage cost, totals, and per-1k-doc scaling. Mode is " +
  "'estimated' for the work-order pattern (no live API calls); switches to 'measured' transparently " +
  "when the orchestrator supplies real API token counts.";

// USD per million tokens. Approximate published rates.
const PRICING = {
  'claude-opus-4-7':   { input: 15.00, output: 75.00 },
  'claude-sonnet-4-6': { input:  3.00, output: 15.00 },
  'claude-haiku-4-5':  { input:  0.80, output:  4.00 },
};
const DEFAULT_MODEL = 'claude-sonnet-4-6';

export function register(server) {
  server.registerTool(
    'cost_report',
    { description, inputSchema },
    async ({ doc_id, doc_type, stages, pricing_model = DEFAULT_MODEL }) => {
      const rates = PRICING[pricing_model] ?? PRICING[DEFAULT_MODEL];

      const per_stage = stages.map((s) => {
        const inCost  = (s.tokens_in  * rates.input)  / 1_000_000;
        const outCost = ((s.tokens_out ?? 0) * rates.output) / 1_000_000;
        const cost    = inCost + outCost;
        return {
          stage: s.stage,
          tokens_in:  s.tokens_in,
          tokens_out: s.tokens_out ?? 0,
          cost_usd:   round6(cost),
          method:     s.method ?? 'estimated',
        };
      });

      const totals = per_stage.reduce(
        (acc, s) => ({
          tokens_in:  acc.tokens_in  + s.tokens_in,
          tokens_out: acc.tokens_out + s.tokens_out,
          cost_usd:   acc.cost_usd   + s.cost_usd,
        }),
        { tokens_in: 0, tokens_out: 0, cost_usd: 0 },
      );
      totals.cost_usd = round6(totals.cost_usd);

      const anyMeasured = stages.some((s) => s.method === 'measured');
      const mode = anyMeasured ? 'measured' : 'estimated';

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            doc_id: doc_id ?? null,
            doc_type,
            mode,
            pricing_model,
            rates_usd_per_million: rates,
            per_stage,
            totals,
            scaling: {
              per_1000_docs_usd:    round2(totals.cost_usd * 1000),
              per_10000_docs_usd:   round2(totals.cost_usd * 10_000),
              per_100000_docs_usd:  round2(totals.cost_usd * 100_000),
            },
            note: mode === 'estimated'
              ? 'Token counts derived from char_count/4 heuristic. Production with API-direct execution reports measured tokens; switch mode to "measured".'
              : 'Token counts measured at the API boundary.',
          }, null, 2),
        }],
      };
    },
  );
}

function round2(n) { return Math.round(n * 100) / 100; }
function round6(n) { return Math.round(n * 1_000_000) / 1_000_000; }
