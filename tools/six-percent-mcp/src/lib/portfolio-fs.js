// Read/write helpers for six-percent-studio/index.html.
// Resolves the studio path from this file's location, not from cwd.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// .../tools/six-percent-mcp/src/lib → .../six-percent-studio
export const STUDIO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
export const STUDIO_INDEX = path.join(STUDIO_ROOT, 'index.html');

export async function readIndex() {
  return fs.readFile(STUDIO_INDEX, 'utf8');
}

export async function writeIndex(text) {
  await fs.writeFile(STUDIO_INDEX, text, 'utf8');
}

// Find the next project number based on existing `<!-- Project NNN -->` comments.
export function nextProjectNumber(html) {
  const matches = [...html.matchAll(/<!--\s*Project\s+(\d{3})\b/g)];
  const max = matches.reduce((m, [, n]) => Math.max(m, parseInt(n, 10)), 0);
  return String(max + 1).padStart(3, '0');
}

// Locate the byte range of the *contents* of <div class="gallery-grid">…</div>.
// Returns { open: number, close: number } where:
//   open  = index just after the opening tag's `>`
//   close = index of the matching closing `</div>`
export function findGalleryGridRange(html) {
  const openRe = /<div\s+class="gallery-grid"\s*>/;
  const m = openRe.exec(html);
  if (!m) throw new Error('gallery-grid container not found in index.html');

  const open = m.index + m[0].length;
  let depth = 1;
  let i = open;
  const re = /<div\b|<\/div>/g;
  re.lastIndex = i;
  let token;
  while ((token = re.exec(html))) {
    if (token[0] === '</div>') {
      depth--;
      if (depth === 0) return { open, close: token.index };
    } else {
      depth++;
    }
  }
  throw new Error('gallery-grid closing </div> not found');
}

// Pretty unified-style diff (no external dep). Just enough to read at-a-glance.
export function inlineDiff(before, after, label = 'index.html') {
  if (before === after) return `(no change to ${label})`;
  const a = before.split('\n');
  const b = after.split('\n');

  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tailA = a.length - 1;
  let tailB = b.length - 1;
  while (tailA > head && tailB > head && a[tailA] === b[tailB]) { tailA--; tailB--; }

  const removed = a.slice(head, tailA + 1).map(l => `- ${l}`);
  const added   = b.slice(head, tailB + 1).map(l => `+ ${l}`);

  return [
    `--- ${label}`,
    `+++ ${label}`,
    `@@ around line ${head + 1} @@`,
    ...removed,
    ...added,
  ].join('\n');
}
