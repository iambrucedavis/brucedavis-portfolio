# six-percent-mcp

An MCP server that exposes my creative practice as tools.

Five tools: search the inspiration vault, capture into it, retrieve candidate palettes, critique copy against my voice rules, scaffold project cards into the portfolio. Claude composes them end-to-end.

The server is the case study. The case study is the server.

---

## The design point

Most LLM tooling treats Claude as a wrapper around an API. This server treats Claude as a reasoner over taste primitives. The tools encode constraints, not capabilities. The model does the picking and the rewriting; the server hands over candidates and rules.

Three patterns, deliberately:

- **Retrieval** — `vault_search`, `palette_suggest`. Server returns candidates; Claude reasons over them.
- **Critique** — `voice_check`. Server returns rule violations with verbatim excerpts; Claude does the rewrite.
- **Mutation** — `vault_capture`, `project_scaffold`. Claude has decided; server commits the change.

No tool reaches for the model. The model reaches for the tools.

---

## Tools

| Name | Pattern | What it does |
| --- | --- | --- |
| `vault_search` | retrieval | Search the Inspiration Vault on Notion. Optional section scope. Title + body match. |
| `vault_capture` | mutation | Write a new entry into the right vault section, formatted to match the existing CLI's blocks. |
| `palette_suggest` | retrieval | Pull candidate palettes from the Color Lab database with hex, mood, category, notes. Returns candidates only; does not rank. |
| `voice_check` | critique | Run a draft against my voice rules (no hedging, no filler, no marketing warmth, no repetition, short sentences). Returns structured violations and a verdict (`ship` / `revise` / `rewrite`). Does not rewrite. |
| `project_scaffold` | mutation | Generate a new exhibit-card and write it into `six-percent-studio/index.html` in the gallery-grid container. Auto-numbers the project. Supports `dry_run`. |

Full tool schemas live in `src/tools/*.js` — each tool is one file.

---

## A representative workflow

```
You: "Draft a project card for the MCP server I just built.
      Use a palette that fits 'technical, restrained, signal-orange-friendly.'
      Voice-check the description before scaffolding."

Claude:
  1. palette_suggest({ brief: "technical restrained signal-orange-friendly" })
     → 8 candidates returned. Claude picks "Ice/Technical" (cool grays + signal accent).
  2. Drafts the description.
  3. voice_check({ draft, context: "project_card" })
     → 2 hedging violations. Claude rewrites.
  4. voice_check again → verdict: ship.
  5. project_scaffold({ ..., dry_run: true })
     → diff returned. Claude shows it.
  6. project_scaffold({ ..., dry_run: false })
     → file written. Project 008 lives in the portfolio.
```

That round trip is the demo.

---

## Setup

```bash
cd tools/six-percent-mcp
npm install
cp .env.example .env   # fill in NOTION_API_KEY
```

Smoke test:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | node src/server.js
```

You should see a JSON response listing all five tools.

### Wire it to Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "six-percent-mcp": {
      "command": "node",
      "args": ["/Users/heyelbe/six-percent-studio/tools/six-percent-mcp/src/server.js"],
      "env": { "NOTION_API_KEY": "secret_..." }
    }
  }
}
```

Restart Claude Desktop. The five tools appear under the 🔌 indicator.

### Wire it to Claude Code

```bash
claude mcp add six-percent-mcp -- node /Users/heyelbe/six-percent-studio/tools/six-percent-mcp/src/server.js
```

`NOTION_API_KEY` should already be in your shell env (or in the project's `.env`).

---

## Stack

- Node, ES modules, no build step
- `@modelcontextprotocol/sdk` 1.x — high-level `McpServer` API
- `@notionhq/client` — vault + Color Lab access
- `zod` — input schemas
- `dotenv`

Reuses the Inspiration Vault and Color Lab IDs from the sibling `tools/vault/` CLI.

---

## Honest scope

- **`voice_check` is heuristic.** It catches lexical violations (hedge words, filler transitions, marketing warmth, sentence length, simple phrase repetition). It does not catch tone, vapidness, or whether the copy actually says something. Those are still Claude's job — the tool announces this in its own response.
- **`palette_suggest` does no ranking.** It returns candidates with structured metadata. The reasoning is the model's, not the server's. That's the point.
- **`project_scaffold` writes only into `six-percent-studio/index.html`.** Single target. Indent matches existing cards.
- **No tests yet.** The smoke harness above is the test.
- **One day of work.** Day 2 is the screencast and case study writeup.

---

## What this proves

I can encode my taste as MCP tools, in a day, and have Claude orchestrate them end-to-end into a real artifact in a real repo. The tools aren't capability wrappers — they're constraints. The reasoning sits where it should: in the model.

That's the thesis for hiring me to build Claude products.

— Bruce Davis
