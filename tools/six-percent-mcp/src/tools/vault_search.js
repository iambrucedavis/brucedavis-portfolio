// vault_search — search Bruce's Inspiration Vault, optionally scoped to one section.
// Returns a flat list of items with id, section, title, snippet, last_edited.

import { z } from 'zod';
import { getVaultChildren, readPageText, SECTION_KEYS, notionUrl } from '../lib/notion.js';

const inputSchema = {
  query:   z.string().min(1).describe("Free-text query. Matched against page titles and the first ~20 blocks of each page."),
  section: z.enum(SECTION_KEYS).optional().describe("Soft filter on the title's section prefix ('[raw-notes] …'). Untagged entries pass through."),
  limit:   z.number().int().min(1).max(50).optional().describe("Max items to return (default 10)."),
};

const description =
  "Search Bruce's Inspiration Vault on Notion. The vault is a flat list of child_pages at the page " +
  "root; sections are a title-prefix convention ('[raw-notes] …', '[concepts] …', etc.) rather than a " +
  "structural hierarchy. Searches title and body (first ~20 blocks). Use this before suggesting copy or " +
  "design directions — the vault is the source of truth for what Bruce already finds compelling.";

export function register(server) {
  server.registerTool(
    'vault_search',
    { description, inputSchema },
    async ({ query, section, limit = 10 }) => {
      const all = await getVaultChildren();
      const q = query.toLowerCase();

      const candidates = section
        ? all.filter(c => c.section === section || c.section === null)
        : all;

      const titleHits = candidates.filter(c => c.title.toLowerCase().includes(q));
      const needBodyScan = titleHits.length < limit;

      let bodyHits = [];
      if (needBodyScan) {
        const remaining = candidates.filter(c => !titleHits.includes(c));
        const scanned = await Promise.all(remaining.slice(0, 40).map(async c => {
          const body = await readPageText(c.id).catch(() => '');
          return { ...c, body };
        }));
        bodyHits = scanned
          .filter(c => c.body.toLowerCase().includes(q))
          .map(({ body, ...rest }) => ({ ...rest, snippet: snippetAround(body, q) }));
      }

      const items = [...titleHits, ...bodyHits]
        .sort((a, b) => new Date(b.last_edited) - new Date(a.last_edited))
        .slice(0, limit)
        .map(c => ({
          id: c.id,
          section: c.section,
          title: c.title,
          snippet: c.snippet || null,
          last_edited: c.last_edited,
          url: notionUrl(c.id),
        }));

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ items, total: items.length, query, section: section || 'all' }, null, 2),
        }],
      };
    },
  );
}

function snippetAround(text, q, radius = 80) {
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return text.slice(0, radius * 2);
  const start = Math.max(0, i - radius);
  const end   = Math.min(text.length, i + q.length + radius);
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
}
