// doc_extract — taste-as-API (mutation).
// Stage 1 of the document processing pipeline. Loads the JSON Schema for the
// requested doc_type and returns a structured extraction "work order" — schema +
// rules + token estimate — for the calling agent to execute. The tool does NOT
// call a model itself; the orchestrating LLM is the executor. This keeps the
// pipeline runnable without an Anthropic API key for v1.

import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, '..', '..', 'fixtures', '009');

const inputSchema = {
  doc_text: z.string().min(1).describe("Raw text of the document to extract from."),
  doc_type: z.enum(['claim', 'invoice', 'contract'])
              .describe("Document type. Determines which JSON Schema is loaded."),
};

const description =
  "Stage 1 of the document processing pipeline. Loads the JSON Schema for the given doc_type and " +
  "returns a structured extraction work order (task, schema, per-type rules, token estimate) for the " +
  "calling agent to execute. Does NOT call a model itself — the orchestrating LLM is the executor. " +
  "Output of the extraction should be passed to pii_mask next.";

const UNIVERSAL_RULES = [
  "Output JSON only, conforming exactly to the provided schema. No commentary, no markdown fences.",
  "Use ISO 8601 for all dates (YYYY-MM-DD) and date-times (YYYY-MM-DDTHH:mm:ssZ or with offset).",
  "Currency values: strip $ and commas, return as numbers (e.g., '$4,820.00' → 4820.00).",
  "Missing fields → null. Do not invent values. Do not infer beyond what the document states.",
  "Preserve original casing for proper nouns, addresses, and identifiers (VINs, policy numbers, etc.).",
  "Booleans should be true/false, not strings.",
];

const TYPE_RULES = {
  claim: [
    "policyholder.address.state should be the two-letter USPS code.",
    "policyholder.address.zip should be 5 or 9 digits (with dash for 9-digit form).",
    "policyholder.address.unit captures apartment/suite designators (e.g., 'Apt 4B'); null if none.",
    "incident.police_report.present is true only if a report number is explicitly given.",
    "vehicle.year is an integer, not a string.",
    "vehicle.trim is the trim level (e.g., 'SE'); null if not stated.",
    "attachments[].type ∈ {photo, pdf, video, audio, other}. Map 'photos' → 'photo', 'PDF' → 'pdf'.",
  ],
  invoice: [
    "line_items[].qty may be integer or decimal; preserve the form given.",
    "line_items[].number is the row index from the source (1, 2, ...) when present; null otherwise.",
    "If tax is not stated, set to 0 (not null).",
    "payment.method ∈ {ACH, wire, check, card}; null if not stated.",
    "payment.late_fee_pct: strip the % sign (e.g., '1.5%' → 1.5).",
  ],
  contract: [
    "initial_term_months is an integer count of months.",
    "service_levels.uptime_pct is the numeric percent (e.g., '99.9%' → 99.9).",
    "service.currency uses the ISO code (USD, EUR, GBP, CAD).",
    "termination.for_convenience.refund_policy summarizes the refund text in one short clause.",
    "signatures must include every signing party listed in the document.",
    "Party.signatory.title is the role (e.g., 'COO'); null if not stated.",
  ],
};

export function register(server) {
  server.registerTool(
    'doc_extract',
    { description, inputSchema },
    async ({ doc_text, doc_type }) => {
      const schemaPath = path.join(FIXTURES_DIR, `${doc_type}.schema.json`);
      const schemaText = await readFile(schemaPath, 'utf8');
      const schema = JSON.parse(schemaText);

      const rules = [...UNIVERSAL_RULES, ...(TYPE_RULES[doc_type] || [])];

      const inputTokenEstimate = Math.ceil(
        (doc_text.length + schemaText.length + rules.join(' ').length) / 4
      );

      const workOrder = {
        task: `Extract structured data from this ${doc_type} document. Conform exactly to the schema. Return JSON only.`,
        doc_type,
        schema,
        extraction_rules: rules,
        output_format: "Plain JSON, valid against the schema. No prose, no markdown fences, no comments.",
        on_completion: `Pass the extracted JSON to pii_mask with doc_type='${doc_type}'.`,
        estimate: {
          stage: 'extract',
          input_tokens: inputTokenEstimate,
          method: 'char_count / 4 — heuristic, not API-measured',
        },
        note: "doc_extract returns instructions, not data. The orchestrating agent does the extraction.",
      };

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(workOrder, null, 2),
        }],
      };
    },
  );
}
