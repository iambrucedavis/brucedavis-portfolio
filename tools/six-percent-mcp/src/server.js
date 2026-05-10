#!/usr/bin/env node
// six-percent-mcp — MCP stdio server exposing Bruce Davis's design practice as tools.
// Entry point: registers all tools, then connects over stdio.

import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { register as registerVaultSearch } from './tools/vault_search.js';
import { register as registerVaultCapture } from './tools/vault_capture.js';
import { register as registerPaletteSuggest } from './tools/palette_suggest.js';
import { register as registerVoiceCheck } from './tools/voice_check.js';
import { register as registerProjectScaffold } from './tools/project_scaffold.js';

const server = new McpServer({
  name: 'six-percent-mcp',
  version: '0.1.0',
});

registerVaultSearch(server);
registerVaultCapture(server);
registerPaletteSuggest(server);
registerVoiceCheck(server);
registerProjectScaffold(server);

const transport = new StdioServerTransport();
await server.connect(transport);
