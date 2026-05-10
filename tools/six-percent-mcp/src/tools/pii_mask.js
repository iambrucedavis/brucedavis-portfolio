// pii_mask — taste-as-API (mutation).
// Stage 2 of the document processing pipeline. Applies a deterministic
// masking pass: known PII field paths get redacted by path; any string
// value matching SSN/email/phone regex gets redacted in place. Returns
// masked data, a redactions log (with SHA-256 of originals), and a list
// of free-text fields flagged for contextual review by the calling
// agent. Does NOT do contextual masking itself — that's a work order
// returned to the orchestrating LLM. Same ingredients-not-decisions
// pattern as 008.

import { z } from 'zod';
import { createHash } from 'node:crypto';

const inputSchema = {
  data:     z.unknown().describe("The extracted JSON object from doc_extract (or any object) to mask."),
  doc_type: z.enum(['claim', 'invoice', 'contract'])
              .describe("Document type. Determines which PII field paths and free-text fields are known."),
};

const description =
  "Stage 2 of the document processing pipeline. Applies deterministic PII masking to known field paths " +
  "and to any string matching SSN / email / phone regex patterns. Returns masked data, a redactions log " +
  "with SHA-256 of originals, and a list of free-text fields the calling agent may want to scan " +
  "contextually for residual PII (names or addresses in descriptions). Does not call a model itself.";

// Known PII field paths per doc type. Each entry: { path, type }.
const PII_PATHS = {
  claim: [
    { path: 'policyholder.name',                  type: 'name' },
    { path: 'policyholder.dob',                   type: 'dob' },
    { path: 'policyholder.ssn',                   type: 'ssn' },
    { path: 'policyholder.phone',                 type: 'phone' },
    { path: 'policyholder.email',                 type: 'email' },
    { path: 'policyholder.address.street',        type: 'address' },
    { path: 'policyholder.address.unit',          type: 'address' },
    { path: 'policyholder.address.city',          type: 'address' },
    { path: 'policyholder.address.zip',           type: 'address' },
    { path: 'incident.other_party.driver_name',   type: 'name' },
    { path: 'incident.other_party.policy_number', type: 'identifier' },
    { path: 'signature.name',                     type: 'name' },
  ],
  invoice: [
    { path: 'bill_to.attn_name',  type: 'name' },
    { path: 'bill_to.attn_email', type: 'email' },
    { path: 'contact.email',      type: 'email' },
    { path: 'contact.phone',      type: 'phone' },
    { path: 'payment.routing',    type: 'banking' },
    { path: 'payment.account',    type: 'banking' },
  ],
  contract: [
    { path: 'provider.signatory.name', type: 'name' },
    { path: 'provider.email',          type: 'email' },
    { path: 'customer.signatory.name', type: 'name' },
    { path: 'customer.email',          type: 'email' },
  ],
};

// Free-text fields that may contain residual PII. The tool flags these
// for the calling agent's contextual review; it does not mask them
// automatically.
const FREE_TEXT_PATHS = {
  claim:    ['description', 'incident.location', 'vehicle.damage_summary'],
  invoice:  [],
  contract: ['renewal_terms', 'data.ownership', 'termination.for_convenience.refund_policy'],
};

// Pattern-based detectors. Applied to every string in the tree after
// path-based redaction.
const PATTERNS = [
  { type: 'ssn',   pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
  { type: 'email', pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { type: 'phone', pattern: /(?:\(\d{3}\)\s?|\b\d{3}[-.\s])\d{3}[-.\s]\d{4}\b/g },
];

const PLACEHOLDER = (type) => `[${type.toUpperCase()}-REDACTED]`;

export function register(server) {
  server.registerTool(
    'pii_mask',
    { description, inputSchema },
    async ({ data, doc_type }) => {
      const masked = JSON.parse(JSON.stringify(data));
      const redactions = [];

      // 1. Path-based redaction — known PII fields for this doc_type.
      for (const { path, type } of PII_PATHS[doc_type] || []) {
        const current = getPath(masked, path);
        if (current != null && current !== '') {
          const original = String(current);
          setPath(masked, path, PLACEHOLDER(type));
          redactions.push({
            field_path: path,
            pii_type: type,
            masked_value: PLACEHOLDER(type),
            original_hash: hash(original),
            method: 'path',
          });
        }
      }

      // 2. Pattern-based redaction — every string in the tree.
      walkStrings(masked, (str, path) => {
        let updated = str;
        for (const { type, pattern } of PATTERNS) {
          const matches = str.match(pattern);
          if (matches) {
            for (const m of matches) {
              redactions.push({
                field_path: path,
                pii_type: type,
                masked_value: PLACEHOLDER(type),
                original_hash: hash(m),
                method: 'pattern',
              });
            }
            updated = updated.replace(pattern, PLACEHOLDER(type));
          }
        }
        return updated;
      });

      // 3. Flag free-text fields for contextual review by the calling agent.
      const contextual_review_advised = [];
      for (const path of FREE_TEXT_PATHS[doc_type] || []) {
        const value = getPath(masked, path);
        if (typeof value === 'string' && value.trim()) {
          contextual_review_advised.push({
            field_path: path,
            value,
            reason: 'Free-text field may contain residual PII (names, addresses, identifiers) not caught by deterministic patterns. Scan and mask as needed before downstream use.',
          });
        }
      }

      const inputTokenEstimate = Math.ceil(JSON.stringify(data).length / 4);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            data: masked,
            redactions,
            contextual_review_advised,
            estimate: {
              stage: 'mask',
              input_tokens: inputTokenEstimate,
              method: 'char_count / 4 — deterministic pass only',
              redactions_count: redactions.length,
            },
            on_completion: `Pass masked data to doc_validate with doc_type='${doc_type}'. Optionally scan contextual_review_advised fields first and apply additional redactions.`,
            note: 'Deterministic pass applied. The contextual_review_advised list flags free-text fields the calling agent should scan for residual PII.',
          }, null, 2),
        }],
      };
    },
  );
}

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (cur[keys[i]] == null) return;
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
}

function walkStrings(obj, fn, basePath = '') {
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const path = `${basePath}[${i}]`;
      if (typeof obj[i] === 'string') {
        const replaced = fn(obj[i], path);
        if (replaced !== obj[i]) obj[i] = replaced;
      } else if (obj[i] && typeof obj[i] === 'object') {
        walkStrings(obj[i], fn, path);
      }
    }
  } else if (obj && typeof obj === 'object') {
    for (const key of Object.keys(obj)) {
      const path = basePath ? `${basePath}.${key}` : key;
      if (typeof obj[key] === 'string') {
        const replaced = fn(obj[key], path);
        if (replaced !== obj[key]) obj[key] = replaced;
      } else if (obj[key] && typeof obj[key] === 'object') {
        walkStrings(obj[key], fn, path);
      }
    }
  }
}

function hash(str) {
  return createHash('sha256').update(str, 'utf8').digest('hex').slice(0, 16);
}
