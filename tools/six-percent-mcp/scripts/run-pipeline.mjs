// run-pipeline.mjs — Project 009 pipeline orchestrator.
// Composes all five tools end-to-end on each fixture, writes a unified
// trace to <fixture>.pipeline.json. The trace is the source-of-truth
// for the browser demo's pre-baked playback.
//
// The work-order pattern means doc_extract does not call a model
// itself — the calling agent's extraction is pre-recorded at
// <fixture>.extracted.json. The orchestrator threads that recorded
// output into stage 2 and onward.
//
// Run: node scripts/run-pipeline.mjs

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { register as regExtract  } from '../src/tools/doc_extract.js';
import { register as regMask     } from '../src/tools/pii_mask.js';
import { register as regValidate } from '../src/tools/doc_validate.js';
import { register as regHitl     } from '../src/tools/hitl_route.js';
import { register as regCost     } from '../src/tools/cost_report.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, '..', 'fixtures', '009');

function loadTool(register) {
  let handler;
  register({ registerTool: (n, m, fn) => { handler = fn; } });
  return handler;
}

const extract  = loadTool(regExtract);
const mask     = loadTool(regMask);
const validate = loadTool(regValidate);
const hitl     = loadTool(regHitl);
const cost     = loadTool(regCost);

const FIXTURES = [
  { type: 'claim',    file: 'claim.txt',    id_field: 'claim_id' },
  { type: 'invoice',  file: 'invoice.txt',  id_field: 'invoice_number' },
  { type: 'contract', file: 'contract.txt', id_field: 'agreement_number' },
];

const chars  = (obj) => JSON.stringify(obj).length;
const tokens = (n)   => Math.ceil(n / 4);

async function runPipeline({ type, file, id_field, label, inject_errors }) {
  const startedAt = new Date().toISOString();
  const docText = await readFile(path.join(FIXTURES_DIR, file), 'utf8');

  // ─── Stage 1: extract ─────────────────────────────────────────
  const extractStart = Date.now();
  const workOrder = JSON.parse(
    (await extract({ doc_text: docText, doc_type: type })).content[0].text
  );
  const extractedData = JSON.parse(
    await readFile(path.join(FIXTURES_DIR, `${type}.extracted.json`), 'utf8')
  );
  if (inject_errors) inject_errors(extractedData);
  const extractStage = {
    name: 'extract',
    tool: 'doc_extract',
    doc_text_preview: docText.slice(0, 240) + (docText.length > 240 ? '…' : ''),
    work_order_summary: {
      task: workOrder.task,
      extraction_rules_count: workOrder.extraction_rules.length,
      schema_title: workOrder.schema.title,
      schema_required: workOrder.schema.required,
    },
    data: extractedData,
    tokens: {
      in: tokens(docText.length + chars(workOrder.schema) + workOrder.extraction_rules.join(' ').length),
      out: tokens(chars(extractedData)),
    },
    duration_ms: Date.now() - extractStart,
  };

  // ─── Stage 2: mask ────────────────────────────────────────────
  const maskStart = Date.now();
  const maskOutput = JSON.parse(
    (await mask({ data: extractedData, doc_type: type })).content[0].text
  );
  const maskStage = {
    name: 'mask',
    tool: 'pii_mask',
    data: maskOutput.data,
    redactions: maskOutput.redactions,
    contextual_review_advised: maskOutput.contextual_review_advised,
    redactions_count: maskOutput.redactions.length,
    tokens: {
      in: tokens(chars(extractedData)),
      out: tokens(chars(maskOutput.data)),
    },
    duration_ms: Date.now() - maskStart,
  };

  // ─── Stage 3: validate ────────────────────────────────────────
  const validateStart = Date.now();
  const validateOutput = JSON.parse(
    (await validate({ data: maskOutput.data, doc_type: type })).content[0].text
  );
  const validateStage = {
    name: 'validate',
    tool: 'doc_validate',
    valid: validateOutput.valid,
    exceptions: validateOutput.exceptions,
    rules_evaluated: validateOutput.rules_evaluated,
    rules_passed: validateOutput.rules_passed,
    rules_skipped: validateOutput.rules_skipped,
    schema_errors_filtered_for_redaction: validateOutput.schema_errors_filtered_for_redaction,
    tokens: {
      in: tokens(chars(maskOutput.data)),
      out: tokens(chars(validateOutput)),
    },
    duration_ms: Date.now() - validateStart,
  };

  // ─── Stage 4: hitl_route ──────────────────────────────────────
  const hitlStart = Date.now();
  const docId = extractedData[id_field];
  const hitlOutput = JSON.parse(
    (await hitl({
      exceptions: validateOutput.exceptions,
      doc_id: docId,
      doc_type: type,
      masked_data: maskOutput.data,
    })).content[0].text
  );
  const hitlStage = {
    name: 'hitl_route',
    tool: 'hitl_route',
    queue: hitlOutput.queue,
    queue_size: hitlOutput.queue_size,
    summary: hitlOutput.summary,
    tokens: {
      in: tokens(chars(validateOutput.exceptions)),
      out: tokens(chars(hitlOutput.queue)),
    },
    duration_ms: Date.now() - hitlStart,
  };

  // ─── Stage 5: cost_report ─────────────────────────────────────
  const costStart = Date.now();
  const stageSummaries = [extractStage, maskStage, validateStage, hitlStage].map((s) => ({
    stage:      s.name,
    tokens_in:  s.tokens.in,
    tokens_out: s.tokens.out,
  }));
  const costOutput = JSON.parse(
    (await cost({ doc_id: docId, doc_type: type, stages: stageSummaries })).content[0].text
  );
  const costStage = {
    name: 'cost_report',
    tool: 'cost_report',
    mode: costOutput.mode,
    pricing_model: costOutput.pricing_model,
    rates_usd_per_million: costOutput.rates_usd_per_million,
    per_stage: costOutput.per_stage,
    totals: costOutput.totals,
    scaling: costOutput.scaling,
    tokens: {
      in: tokens(chars(stageSummaries)),
      out: tokens(chars(costOutput)),
    },
    duration_ms: Date.now() - costStart,
  };

  const trace = {
    doc_id: docId,
    doc_type: type,
    fixture: file,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    stages: [extractStage, maskStage, validateStage, hitlStage, costStage],
    summary: {
      valid: validateOutput.valid,
      exceptions_count: validateOutput.exceptions.length,
      redactions_count: maskOutput.redactions.length,
      queue_size: hitlOutput.queue_size,
      total_tokens_in:  costOutput.totals.tokens_in,
      total_tokens_out: costOutput.totals.tokens_out,
      total_cost_usd:   costOutput.totals.cost_usd,
      per_1000_docs_usd:  costOutput.scaling.per_1000_docs_usd,
      per_100000_docs_usd: costOutput.scaling.per_100000_docs_usd,
    },
  };

  const outFile = label ?? `${type}.pipeline.json`;
  await writeFile(path.join(FIXTURES_DIR, outFile), JSON.stringify(trace, null, 2));

  console.log(
    `${(label ?? type).padEnd(28)}: ` +
    `${trace.summary.exceptions_count} exceptions, ` +
    `${trace.summary.redactions_count} redactions, ` +
    `${trace.summary.queue_size} queued, ` +
    `$${trace.summary.total_cost_usd.toFixed(6)} (≈ $${trace.summary.per_1000_docs_usd}/1k docs)`
  );
}

for (const f of FIXTURES) {
  await runPipeline(f);
}

// Broken-claim variant — demonstrates the exception + HITL flow.
// Real-world analog: a poorly-keyed claim with a transposed total and
// a missing identifier the source system requires.
await runPipeline({
  type: 'claim',
  file: 'claim.txt',
  id_field: 'claim_id',
  label: 'claim-broken.pipeline.json',
  inject_errors: (data) => {
    data.amounts.net_claim = 9999;       // breaks net_claim_consistent
    data.amounts.vehicle_repair = 100;   // breaks amounts_consistent
    delete data.vehicle.vin;             // schema: required vin missing
  },
});

console.log('\nWrote: claim, invoice, contract, claim-broken pipeline traces.');
