// doc_validate — taste-as-API (critique).
// Stage 3 of the document processing pipeline. Two-pass validation:
//   1. Schema validation (ajv) — types, requireds, formats, patterns.
//      Format/pattern errors on fields containing [TYPE-REDACTED]
//      placeholders are filtered out (masked data is expected to violate
//      strict format constraints by design).
//   2. Business rules — hardcoded evaluators per doc_type, reading the
//      businessRules array from the schema. Each rule returns
//      pass / fail / skipped. Skipped happens when a rule needs PII
//      that has already been masked (e.g., the policyholder_age rule
//      can't run if dob is redacted).
//
// Returns an exceptions[] array ready for hitl_route. Does not call a
// model.

import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, '..', '..', 'fixtures', '009');

const REDACTED_RE = /^\[.*-REDACTED\]$/;

const inputSchema = {
  data:     z.unknown().describe("The data object to validate. May be raw (from doc_extract) or masked (from pii_mask)."),
  doc_type: z.enum(['claim', 'invoice', 'contract']).describe("Document type. Selects the schema + business rules."),
};

const description =
  "Stage 3 of the document processing pipeline. Runs schema validation (ajv + ajv-formats) and " +
  "evaluates business rules per doc_type. Format and pattern errors on redacted fields are filtered " +
  "out automatically. Business rules that need PII gracefully skip when the input is masked. " +
  "Returns an exceptions[] array for hitl_route.";

export function register(server) {
  server.registerTool(
    'doc_validate',
    { description, inputSchema },
    async ({ data, doc_type }) => {
      const schemaPath = path.join(FIXTURES_DIR, `${doc_type}.schema.json`);
      const schema = JSON.parse(await readFile(schemaPath, 'utf8'));

      const ajv = new Ajv({ allErrors: true, strict: false });
      addFormats(ajv);
      const validate = ajv.compile(schema);
      validate(data);

      const allSchemaErrors = validate.errors || [];
      const filteredSchemaErrors = [];
      const skippedSchemaErrors = [];

      for (const err of allSchemaErrors) {
        const value = getByPointer(data, err.instancePath);
        const isRedacted = typeof value === 'string' && REDACTED_RE.test(value);
        const isFormatOrPattern = err.keyword === 'format' || err.keyword === 'pattern';
        if (isRedacted && isFormatOrPattern) {
          skippedSchemaErrors.push({
            field_path: err.instancePath,
            keyword: err.keyword,
            reason: 'value is a [TYPE-REDACTED] placeholder; strict check skipped',
          });
        } else {
          filteredSchemaErrors.push(err);
        }
      }

      const evaluator = BUSINESS_RULES[doc_type] || {};
      const businessResults = [];
      for (const rule of schema.businessRules || []) {
        const fn = evaluator[rule.id];
        if (!fn) {
          businessResults.push({ rule_id: rule.id, status: 'no_evaluator', description: rule.description });
          continue;
        }
        try {
          const r = fn(data, rule);
          businessResults.push({ rule_id: rule.id, description: rule.description, ...r });
        } catch (e) {
          businessResults.push({ rule_id: rule.id, status: 'error', description: rule.description, error: e.message });
        }
      }

      const exceptions = [
        ...filteredSchemaErrors.map(e => ({
          stage: 'validate',
          rule: 'schema',
          rule_id: e.keyword,
          field_path: e.instancePath || '/',
          message: e.message,
          actual: snippet(getByPointer(data, e.instancePath)),
          suggested_action: schemaSuggestion(e),
          severity: 'error',
        })),
        ...businessResults
          .filter(r => r.status === 'fail')
          .map(r => ({
            stage: 'validate',
            rule: 'business_rule',
            rule_id: r.rule_id,
            description: r.description,
            expected: r.expected,
            actual: r.actual,
            suggested_action: r.suggested_action || 'Review the source document; resolve in HITL.',
            severity: 'error',
          })),
      ];

      const valid = exceptions.length === 0;

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            valid,
            exceptions,
            rules_evaluated: businessResults.length,
            rules_passed:    businessResults.filter(r => r.status === 'pass').length,
            rules_skipped:   businessResults.filter(r => r.status === 'skipped'),
            schema_errors_filtered_for_redaction: skippedSchemaErrors,
            on_completion: valid
              ? 'No exceptions. Pipeline continues to cost_report.'
              : `${exceptions.length} exception(s). Pass to hitl_route for human review.`,
            estimate: {
              stage: 'validate',
              input_tokens: Math.ceil(JSON.stringify(data).length / 4),
              method: 'char_count / 4 — deterministic pass',
            },
          }, null, 2),
        }],
      };
    },
  );
}

const BUSINESS_RULES = {
  claim: {
    amounts_consistent: (data, rule) => {
      const a = data?.amounts ?? {};
      const sum = (a.vehicle_repair ?? 0) + (a.rental_coverage ?? 0) + (a.diminished_value ?? 0);
      const total = a.total_claimed ?? 0;
      const tol = rule.tolerance_usd ?? 1;
      return Math.abs(sum - total) <= tol
        ? { status: 'pass' }
        : { status: 'fail', expected: total, actual: sum,
            suggested_action: `Sum of component amounts is ${sum}; total_claimed is ${total}. Reconcile with source.` };
    },
    net_claim_consistent: (data, rule) => {
      const a = data?.amounts ?? {};
      const expected = (a.total_claimed ?? 0) - (a.deductible ?? 0);
      const tol = rule.tolerance_usd ?? 1;
      return Math.abs(expected - (a.net_claim ?? 0)) <= tol
        ? { status: 'pass' }
        : { status: 'fail', expected, actual: a.net_claim,
            suggested_action: `Expected net_claim = total_claimed (${a.total_claimed}) - deductible (${a.deductible}) = ${expected}.` };
    },
    loss_before_submission: (data, rule) => {
      const loss = parseDate(data?.incident?.date_of_loss);
      const submitted = parseDate(data?.submitted_at);
      if (loss == null || submitted == null) {
        return { status: 'fail', expected: 'valid dates', actual: 'unparseable',
                 suggested_action: 'Confirm date_of_loss and submitted_at are present and parseable.' };
      }
      return loss <= submitted
        ? { status: 'pass' }
        : { status: 'fail', expected: `≤ ${data.submitted_at}`, actual: data.incident.date_of_loss,
            suggested_action: 'A loss after submission is anomalous; flag for fraud review.' };
    },
    policyholder_age: (data, rule) => {
      const dob = data?.policyholder?.dob;
      if (typeof dob === 'string' && REDACTED_RE.test(dob)) {
        return { status: 'skipped', reason: 'dob has been redacted; run this rule before pii_mask in production' };
      }
      const dobDate = parseDate(dob);
      const lossDate = parseDate(data?.incident?.date_of_loss);
      if (dobDate == null || lossDate == null) {
        return { status: 'fail', expected: 'valid dates', actual: 'unparseable',
                 suggested_action: 'Confirm dob and date_of_loss are present and parseable.' };
      }
      const ageYears = (lossDate - dobDate) / (1000 * 60 * 60 * 24 * 365.25);
      return ageYears >= 16
        ? { status: 'pass' }
        : { status: 'fail', expected: '≥ 16 at date_of_loss', actual: `${ageYears.toFixed(1)} years`,
            suggested_action: 'Policyholder is under 16 at the date of loss — verify policy eligibility.' };
    },
  },
  invoice: {
    line_items_sum_to_subtotal: (data, rule) => {
      const sum = (data?.line_items ?? []).reduce((acc, item) => acc + (item.amount ?? 0), 0);
      const tol = rule.tolerance_usd ?? 0.01;
      return Math.abs(sum - (data?.subtotal ?? 0)) <= tol
        ? { status: 'pass' }
        : { status: 'fail', expected: data.subtotal, actual: round2(sum),
            suggested_action: `Sum of line_items.amount = ${round2(sum)}; subtotal = ${data.subtotal}. Reconcile.` };
    },
    subtotal_plus_tax_equals_total: (data, rule) => {
      const expected = (data?.subtotal ?? 0) + (data?.tax ?? 0);
      const tol = rule.tolerance_usd ?? 0.01;
      return Math.abs(expected - (data?.total ?? 0)) <= tol
        ? { status: 'pass' }
        : { status: 'fail', expected: round2(expected), actual: data.total,
            suggested_action: `Expected total = subtotal + tax = ${round2(expected)}; got ${data.total}.` };
    },
    line_amount_consistent: (data, rule) => {
      const tol = rule.tolerance_usd ?? 0.01;
      const items = data?.line_items ?? [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const expected = (it.qty ?? 0) * (it.unit_price ?? 0);
        if (Math.abs(expected - (it.amount ?? 0)) > tol) {
          return { status: 'fail', expected: round2(expected), actual: it.amount,
                   suggested_action: `Line ${i+1}: qty (${it.qty}) × unit_price (${it.unit_price}) = ${round2(expected)}; amount = ${it.amount}.` };
        }
      }
      return { status: 'pass' };
    },
    due_after_issue: (data, rule) => {
      const issue = parseDate(data?.issue_date);
      const due = parseDate(data?.due_date);
      if (issue == null || due == null) {
        return { status: 'fail', expected: 'valid dates', actual: 'unparseable',
                 suggested_action: 'Confirm issue_date and due_date are parseable.' };
      }
      return due >= issue
        ? { status: 'pass' }
        : { status: 'fail', expected: `≥ ${data.issue_date}`, actual: data.due_date,
            suggested_action: 'due_date precedes issue_date — likely a typo. Verify with vendor.' };
    },
  },
  contract: {
    termination_after_effective: (data, rule) => {
      const eff = parseDate(data?.effective_date);
      const term = parseDate(data?.termination_date);
      if (eff == null || term == null) {
        return { status: 'fail', expected: 'valid dates', actual: 'unparseable',
                 suggested_action: 'Confirm effective_date and termination_date are parseable.' };
      }
      return term > eff
        ? { status: 'pass' }
        : { status: 'fail', expected: `> ${data.effective_date}`, actual: data.termination_date,
            suggested_action: 'Termination on or before effective date — agreement has no term.' };
    },
    term_length_matches_dates: (data, rule) => {
      const eff = parseDate(data?.effective_date);
      const term = parseDate(data?.termination_date);
      const stated = data?.initial_term_months;
      if (eff == null || term == null || typeof stated !== 'number') {
        return { status: 'fail', expected: 'valid dates + months', actual: 'unparseable',
                 suggested_action: 'Confirm effective_date, termination_date, and initial_term_months are present.' };
      }
      const effD = new Date(eff);
      const termD = new Date(term);
      const monthDiff = (termD.getUTCFullYear() - effD.getUTCFullYear()) * 12 + (termD.getUTCMonth() - effD.getUTCMonth());
      const ok = Math.abs(monthDiff - stated) <= 1 ||
                 (monthDiff === stated - 1 && termD.getUTCDate() >= effD.getUTCDate() - 1);
      return ok
        ? { status: 'pass' }
        : { status: 'fail', expected: stated, actual: monthDiff,
            suggested_action: `initial_term_months says ${stated}; computed ${monthDiff} from dates.` };
    },
    both_parties_signed: (data, rule) => {
      const sigs = data?.signatures ?? [];
      const provName = data?.provider?.name;
      const custName = data?.customer?.name;
      const orgs = sigs.map(s => s.organization);
      const providerSigned = orgs.includes(provName);
      const customerSigned = orgs.includes(custName);
      return providerSigned && customerSigned
        ? { status: 'pass' }
        : { status: 'fail', expected: 'both parties present in signatures[]',
            actual: { providerSigned, customerSigned },
            suggested_action: 'Missing signature for one or both parties — verify with the original contract.' };
    },
    signatures_on_or_before_effective: (data, rule) => {
      const eff = parseDate(data?.effective_date);
      if (eff == null) {
        return { status: 'fail', expected: 'valid effective_date', actual: 'unparseable',
                 suggested_action: 'Confirm effective_date is parseable.' };
      }
      const sigs = data?.signatures ?? [];
      for (let i = 0; i < sigs.length; i++) {
        const sigDate = parseDate(sigs[i].date);
        if (sigDate == null || sigDate > eff) {
          return { status: 'fail', expected: `≤ ${data.effective_date}`, actual: sigs[i].date,
                   suggested_action: `Signature ${i+1} (${sigs[i].organization}) dated after effective_date — verify.` };
        }
      }
      return { status: 'pass' };
    },
  },
};

function getByPointer(obj, pointer) {
  if (!pointer || pointer === '/' || pointer === '') return obj;
  const parts = pointer.split('/').slice(1).map(p => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    const key = /^\d+$/.test(p) && Array.isArray(cur) ? Number(p) : p;
    cur = cur[key];
  }
  return cur;
}

function parseDate(s) {
  if (typeof s !== 'string') return null;
  const d = new Date(s);
  return isNaN(d.valueOf()) ? null : d.valueOf();
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function snippet(v) {
  if (v === undefined || v === null) return v;
  if (typeof v === 'string') return v.length > 80 ? v.slice(0, 80) + '…' : v;
  return v;
}

function schemaSuggestion(err) {
  switch (err.keyword) {
    case 'required':   return `Field missing: ${err.params?.missingProperty}. Confirm with source.`;
    case 'type':       return `Type mismatch at ${err.instancePath}: expected ${err.params?.type}.`;
    case 'enum':       return `Value at ${err.instancePath} must be one of: ${err.params?.allowedValues?.join(', ')}.`;
    case 'pattern':    return `Pattern mismatch at ${err.instancePath}: expected ${err.params?.pattern}.`;
    case 'format':     return `Format mismatch at ${err.instancePath}: expected ${err.params?.format}.`;
    case 'minimum':    return `Below minimum at ${err.instancePath}: ${err.params?.limit}.`;
    case 'maximum':    return `Above maximum at ${err.instancePath}: ${err.params?.limit}.`;
    default:           return err.message || 'Schema violation; verify with source.';
  }
}
