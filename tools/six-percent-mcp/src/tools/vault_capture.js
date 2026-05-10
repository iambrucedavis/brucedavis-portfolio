// vault_capture — write a new item into the Inspiration Vault, in the right section.
// Mirrors the existing `vault add` CLI's block layout so captures look the same.

import { z } from 'zod';
import { notion, VAULT_PAGE_ID, SECTION_KEYS, notionUrl } from '../lib/notion.js';

const inputSchema = {
  content:        z.string().min(1).describe("The body of the entry. Long-form OK."),
  section:        z.enum(SECTION_KEYS).describe("'raw-notes' | 'concepts' | 'references' | 'project-seeds'."),
  title:          z.string().min(1).max(120).describe("Short title for the page."),
  type:           z.enum(['Image', 'Link', 'Copy', 'Idea', 'Essay']).optional().describe("Type badge for the meta callout. Default 'Idea'."),
  tags:           z.array(z.string()).optional().describe("Loose tags, no #."),
  source:         z.string().optional().describe("Where this came from — URL, person, etc."),
  why_it_matters: z.string().optional().describe("One sentence on relevance. Surfaces in the entry's purple callout."),
};

const description =
  "Capture an item into Bruce's Inspiration Vault. Pick the right section: raw-notes (his own writing), " +
  "concepts (sparks / hypotheses), references (external finds), project-seeds (anchored enough to grow into a project). " +
  "Use this when the conversation surfaces something worth remembering past this session.";

export function register(server) {
  server.registerTool(
    'vault_capture',
    { description, inputSchema },
    async ({ content, section, title, type = 'Idea', tags = [], source, why_it_matters }) => {
      const parentId = VAULT_PAGE_ID;
      const taggedTitle = `[${section}] ${title}`;
      const today = new Date().toISOString().slice(0, 10);

      const children = [
        {
          object: 'block',
          type: 'callout',
          callout: {
            rich_text: [{
              type: 'text',
              text: { content: [`[ ${type} ]`, today, source ? `// ${source}` : null].filter(Boolean).join('  ·  ') },
            }],
            icon: { type: 'emoji', emoji: '📌' },
            color: 'gray_background',
          },
        },
        ...(why_it_matters ? [{
          object: 'block',
          type: 'callout',
          callout: {
            rich_text: [
              { type: 'text', text: { content: '// why this matters\n' }, annotations: { code: true } },
              { type: 'text', text: { content: why_it_matters } },
            ],
            icon: { type: 'emoji', emoji: '✦' },
            color: 'purple_background',
          },
        }] : []),
        ...(tags.length ? [{
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: tags.map(t => ({
              type: 'text',
              text: { content: `#${t}  ` },
              annotations: { color: 'gray' },
            })),
          },
        }] : []),
        { object: 'block', type: 'divider', divider: {} },
        {
          object: 'block',
          type: 'paragraph',
          paragraph: { rich_text: [{ type: 'text', text: { content: String(content).slice(0, 2000) } }] },
        },
      ];

      const page = await notion().pages.create({
        parent: { page_id: parentId },
        properties: { title: { title: [{ type: 'text', text: { content: taggedTitle } }] } },
        children,
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            id: page.id,
            notion_url: notionUrl(page.id),
            section,
            title: taggedTitle,
          }, null, 2),
        }],
      };
    },
  );
}
