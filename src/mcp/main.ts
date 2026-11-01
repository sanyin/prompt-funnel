#!/usr/bin/env node
/**
 * Standalone entry point for the MCP server.
 *
 * Kept separate from `server.ts` so that importing the server (from the CLI, or
 * from tests) never starts one. The `funnel-mcp` bin points here.
 *
 * @module prompt-funnel/mcp/main
 */

import { serve } from './server.js';

await serve();
