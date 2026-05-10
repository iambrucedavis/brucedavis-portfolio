// project_scaffold — closes the loop. Generates a new exhibit-card and writes it
// into six-percent-studio/index.html, in the gallery-grid container. Auto-numbers
// the project (008, 009, …) unless `number` is given. Supports dry_run for preview.

import { z } from 'zod';
import {
  readIndex, writeIndex, nextProjectNumber,
  findGalleryGridRange, inlineDiff, STUDIO_INDEX,
} from '../lib/portfolio-fs.js';

const inputSchema = {
  name:        z.string().min(1).describe("Project name. Will appear as the plaque title."),
  description: z.string().min(1).describe("2–3 sentence plaque-desc body. Run this through voice_check before scaffolding."),
  stack:       z.string().min(1).describe("The tech/medium stack line, e.g. 'MCP SDK · Node ESM · Notion API'."),
  tags:        z.array(z.string()).min(1).max(4).describe("1–4 op-tags. Each becomes a `// tag-name` chip."),
  href:        z.string().optional().describe("Anchor href. Default '#'."),
  icon:        z.string().optional().describe("Single glyph for the exhibit-art icon. Default '▤'."),
  number:      z.string().regex(/^\d{3}$/).optional().describe("3-digit project number. Auto-detected if omitted."),
  state:       z.enum(['ACTIVE', 'IN BUILD', 'DRAFT']).optional().describe("State badge. Default 'IN BUILD'."),
  signal_word: z.string().optional().describe("A word from `name` that should be wrapped in --signal color. Default: the last word."),
  before:      z.string().optional().describe("Left side of the before→after pair. Optional."),
  after:       z.string().optional().describe("Right side of the before→after pair. Required if `before` is set."),
  dry_run:     z.boolean().optional().describe("If true, return the diff without writing. Default false."),
};

const description =
  "Scaffold a new project card into six-percent-studio/index.html (gallery-grid container) using the " +
  "exhibit-card pattern. Auto-numbers the project. Returns the diff. Pass dry_run: true to preview. " +
  "This tool mutates the live portfolio repo — only call it when the user has confirmed the project " +
  "is real enough to occupy a slot.";

export function register(server) {
  server.registerTool(
    'project_scaffold',
    { description, inputSchema },
    async (args) => {
      const before = await readIndex();
      const number = args.number ?? nextProjectNumber(before);
      const cardLines = buildExhibitCard({ ...args, number });

      const { close } = findGalleryGridRange(before);
      const indent = '      '; // 6 spaces — matches existing card indent in gallery-grid
      const insertion = '\n' + cardLines.map(l => l ? indent + l : '').join('\n') + '\n\n    ';
      const after = before.slice(0, close) + insertion + before.slice(close);

      const diff = inlineDiff(before, after, 'index.html');

      if (!args.dry_run) {
        await writeIndex(after);
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            file: STUDIO_INDEX,
            number,
            written: !args.dry_run,
            dry_run: !!args.dry_run,
            diff,
          }, null, 2),
        }],
      };
    },
  );
}

// Returns the card as an array of lines, each line indented relative to the
// card root (the `<a>` line). The caller prepends a fixed prefix per line.
function buildExhibitCard({ name, description, stack, tags, href, icon, number, state, signal_word, before, after }) {
  const _href  = href  || '#';
  const _icon  = icon  || '▤';
  const _state = state || 'IN BUILD';
  const titleHtml = wrapSignalWord(name, signal_word);

  const lines = [
    `<!-- Project ${number} — ${escapeHtml(name)} (${_state}) -->`,
    `<a href="${escapeAttr(_href)}" class="exhibit-card live reveal" aria-label="Open Project ${number} — ${escapeAttr(name)}">`,
    `  <div class="exhibit-art" aria-hidden="true">`,
    `    <div class="exhibit-art-num">${number}</div>`,
    `    <div class="exhibit-art-glow"></div>`,
    `    <div class="exhibit-art-icon">${escapeHtml(_icon)}</div>`,
    `    <div class="exhibit-live-badge">[ ${_state} ]</div>`,
    `  </div>`,
    `  <div class="exhibit-plaque">`,
    `    <div class="exhibit-plaque-num">Project ${number} · ${escapeHtml(tags[0] || 'New')}</div>`,
    `    <div class="exhibit-plaque-title">${titleHtml}</div>`,
    `    <div class="exhibit-plaque-medium">${escapeHtml(stack)}</div>`,
    `    <div class="exhibit-plaque-desc">`,
    `      ${escapeHtml(description)}`,
    `    </div>`,
  ];

  if (before && after) {
    lines.push(
      `    <div class="exhibit-before-after">`,
      `      <span class="ex-before">${escapeHtml(before)}</span>`,
      `      <span class="ex-arrow">→</span>`,
      `      <span class="ex-after">${escapeHtml(after)}</span>`,
      `    </div>`,
    );
  }

  lines.push(
    `    <div class="exhibit-op-tags">`,
    ...tags.map(t => `      <span class="ex-op-tag">// ${escapeHtml(t)}</span>`),
    `    </div>`,
    `  </div>`,
    `  <div class="exhibit-floor"></div>`,
    `</a>`,
  );

  return lines;
}

function wrapSignalWord(name, signalWord) {
  const words = name.split(' ');
  let target = signalWord;
  if (!target || !words.some(w => w.toLowerCase() === target.toLowerCase())) {
    target = words[words.length - 1];
  }
  return words
    .map(w => w.toLowerCase() === target.toLowerCase()
      ? `<span style="color:var(--signal);">${escapeHtml(w)}</span>`
      : escapeHtml(w))
    .join(' ');
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}
