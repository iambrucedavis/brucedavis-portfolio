// palette_suggest — taste-as-API (retrieval).
// Returns candidate palettes from Bruce's Color Lab so Claude can reason over them.
// Intentionally does NOT score or pick — the server hands over the ingredients,
// the model picks. That's the interesting MCP design choice.

import { z } from 'zod';
import { notion, COLOR_LAB_DB_ID } from '../lib/notion.js';

const inputSchema = {
  brief: z.string().min(1).describe("Free-text project intent or mood. Used as a hint, not a strict filter."),
  limit: z.number().int().min(1).max(20).optional().describe("Max palettes to return (default 8)."),
  category_hint: z.string().optional().describe("Optional category filter (e.g., 'Off-White', 'Technical', 'Editorial'). Soft-matched."),
};

const description =
  "Retrieve candidate color palettes from Bruce's Color Lab on Notion. Each palette ships with name, " +
  "category, mood, 3–5 hex codes, notes, and source. Use this when proposing color directions — pick from " +
  "what Bruce has already curated rather than inventing palettes from scratch. Reason over the candidates " +
  "yourself; the tool does not rank them.";

export function register(server) {
  server.registerTool(
    'palette_suggest',
    { description, inputSchema },
    async ({ brief, limit = 8, category_hint }) => {
      const res = await notion().databases.query({
        database_id: COLOR_LAB_DB_ID,
        page_size: 50,
      });

      const palettes = res.results.map(toPalette).filter(Boolean);

      let candidates = palettes;
      if (category_hint) {
        const hint = category_hint.toLowerCase();
        const filtered = palettes.filter(p => (p.category || '').toLowerCase().includes(hint));
        if (filtered.length) candidates = filtered;
      }

      candidates = candidates.slice(0, limit);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            brief,
            returned: candidates.length,
            total_in_lab: palettes.length,
            palettes: candidates,
            note: "These are candidates, not recommendations. Reason about which fits the brief.",
          }, null, 2),
        }],
      };
    },
  );
}

function toPalette(page) {
  const p = page.properties || {};
  const name = readTitle(p.Name);
  if (!name) return null;
  const hexes = ['Hex 1', 'Hex 2', 'Hex 3', 'Hex 4', 'Hex 5']
    .map(k => readRichText(p[k]))
    .filter(Boolean);
  return {
    name,
    category: readSelect(p.Category),
    mood:     readRichText(p.Mood) || readSelect(p.Mood),
    hexes,
    notes:    readRichText(p.Notes),
    source:   readRichText(p.Source) || readUrl(p.Source),
    id:       page.id,
  };
}

function readTitle(prop)    { return prop?.title?.map(t => t.plain_text).join('').trim() || null; }
function readRichText(prop) { return prop?.rich_text?.map(t => t.plain_text).join('').trim() || null; }
function readSelect(prop)   { return prop?.select?.name || null; }
function readUrl(prop)      { return prop?.url || null; }
