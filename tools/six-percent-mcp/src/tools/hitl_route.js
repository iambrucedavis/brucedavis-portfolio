// hitl_route — taste-as-API (mutation).
// Stage 4 of the document processing pipeline. Takes the exceptions[] from
// doc_validate and produces a human-in-the-loop queue. Each exception
// becomes a queue entry with a priority, a suggested resolution, and a
// redacted preview of the document for reviewer context. The queue is
// returned in-memory — production would back this with a real ticket
// system, but the pattern is identical.
//
// Does not call a model.

import { z } from 'zod';
import { randomUUID } from 'node:crypto';

const inputSchema = {
  exceptions: z.array(z.object({}).passthrough())
                .describe("Exceptions array from doc_validate. Each carries rule, rule_id, field/description, expected, actual, suggested_action."),
  doc_id:     z.string().optional().describe("Identifier for the source document (e.g., claim_id or invoice_number)."),
  doc_type:   z.enum(['claim', 'invoice', 'contract']).describe("Document type."),
  masked_data: z.unknown().optional().describe("The masked data, included as preview context for the human reviewer."),
};

const description =
  "Stage 4 of the document processing pipeline. Routes doc_validate exceptions into a human-in-the-loop " +
  "queue. Each entry gets a unique queue_id, an assigned priority (high / medium / low) based on rule " +
  "type, a suggested resolution, and a redacted preview of the document. Returns the queue + a summary " +
  "(counts by priority and rule type). In-memory only — production would persist to a ticket system.";

function assignPriority(exception) {
  if (exception.rule === 'schema' && exception.rule_id === 'required') return 'high';
  if (exception.rule === 'business_rule') {
    return /amount|claim|deductible|subtotal|total|fee|consistent/i.test(exception.rule_id)
      ? 'high'
      : 'medium';
  }
  if (exception.rule === 'schema') return 'medium';
  return 'low';
}

export function register(server) {
  server.registerTool(
    'hitl_route',
    { description, inputSchema },
    async ({ exceptions, doc_id, doc_type, masked_data }) => {
      const createdAt = new Date().toISOString();

      const queue = exceptions.map((exception) => ({
        queue_id: randomUUID(),
        doc_id: doc_id ?? null,
        doc_type,
        stage: exception.stage ?? 'validate',
        priority: assignPriority(exception),
        exception,
        suggested_resolution: exception.suggested_action
                              ?? 'Review with source document; resolve in queue.',
        assigned_to: null,
        status: 'queued',
        created_at: createdAt,
      }));

      const byPriority = { high: 0, medium: 0, low: 0 };
      const byRuleType = {};
      for (const entry of queue) {
        byPriority[entry.priority] = (byPriority[entry.priority] ?? 0) + 1;
        const key = entry.exception.rule ?? 'unknown';
        byRuleType[key] = (byRuleType[key] ?? 0) + 1;
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            doc_id: doc_id ?? null,
            doc_type,
            queue_size: queue.length,
            queue,
            preview: masked_data ?? null,
            summary: {
              total_queued: queue.length,
              by_priority: byPriority,
              by_rule_type: byRuleType,
            },
            on_completion: queue.length === 0
              ? 'No exceptions queued. Pipeline continues to cost_report.'
              : `${queue.length} entries queued for human review. Pipeline continues to cost_report regardless.`,
            note: 'In-memory queue. Production would persist each entry to a ticket system (Notion, Jira, Linear, etc.) and route by team.',
            estimate: {
              stage: 'hitl_route',
              input_tokens: Math.ceil(JSON.stringify(exceptions).length / 4),
              method: 'char_count / 4 — deterministic',
            },
          }, null, 2),
        }],
      };
    },
  );
}
