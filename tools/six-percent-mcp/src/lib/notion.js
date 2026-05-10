// Shared Notion client + section/database constants for six-percent-mcp.
// Intentionally narrow: just enough for the five tools.

import { Client } from '@notionhq/client';

// VAULT_PAGE_ID matches CLAUDE.md.
// COLOR_LAB_DB_ID was stale in CLAUDE.md; real ID confirmed via Notion search.
export const VAULT_PAGE_ID    = '35595deb-cde6-8132-b874-e345bc6dfddb';
export const COLOR_LAB_DB_ID  = '52c7c702-81e7-4bfa-bd03-feb2c0e775d9';

// Section keys mirror the existing vault CLI (kebab-case).
// NOTE: the Vault page stores entries as a flat list of child_page blocks at the
// page root. The "sections" are heading_2 blocks above the entries — visual only,
// not structural. So `section` here is a soft tag carried in the title prefix
// (e.g. "[concepts] My Idea") rather than a true parent-child relationship.
export const SECTION_KEYS = ['raw-notes', 'concepts', 'references', 'project-seeds'];

let _client = null;
export function notion() {
  if (!_client) _client = new Client({ auth: process.env.NOTION_API_KEY });
  return _client;
}

// Fetch every child_page under the Vault, plus its title-derived section tag.
// Cached for the life of the process.
let _vaultChildren = null;
export async function getVaultChildren() {
  if (_vaultChildren) return _vaultChildren;

  const all = [];
  let cursor;
  do {
    const res = await notion().blocks.children.list({
      block_id: VAULT_PAGE_ID,
      page_size: 100,
      start_cursor: cursor,
    });
    for (const b of res.results) {
      if (b.type !== 'child_page') continue;
      const title = b.child_page?.title || 'Untitled';
      all.push({
        id: b.id,
        title,
        section: parseSectionTag(title),
        last_edited: b.last_edited_time,
      });
    }
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor);

  _vaultChildren = all;
  return _vaultChildren;
}

// Title prefix convention: "[section-key] Title". Returns null if no tag.
function parseSectionTag(title) {
  const m = title.match(/^\s*\[([a-z-]+)\]\s*/i);
  if (!m) return null;
  const key = m[1].toLowerCase();
  return SECTION_KEYS.includes(key) ? key : null;
}

// Pull plain text out of a Notion page's first N blocks.
export async function readPageText(pageId, maxBlocks = 20) {
  const res = await notion().blocks.children.list({ block_id: pageId, page_size: maxBlocks });
  const parts = [];
  for (const block of res.results) {
    const richTexts =
      block[block.type]?.rich_text ||
      block[block.type]?.text ||
      [];
    const text = richTexts.map(rt => rt.plain_text || '').join('').trim();
    if (text) parts.push(text);
  }
  return parts.join('\n');
}

// Notion deep link for a page id.
export function notionUrl(pageId) {
  return `https://www.notion.so/${pageId.replace(/-/g, '')}`;
}
