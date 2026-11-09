/**
 * MCP server for the decision log.
 *
 * An agent cannot read a file it was not told about. Exposing the log as two
 * tools lets it ask "has this been tried" before doing the work, which is the
 * whole point.
 *
 *   node tools/decision-log/mcp.mjs --root /path/to/project
 *
 * @module tools/decision-log/mcp
 */

import { createInterface } from 'node:readline';

import { appendEntry, briefEntries, readEntries, searchEntries } from './log.mjs';

function rootFromArgs(argv) {
  const index = argv.indexOf('--root');
  return index === -1 ? process.cwd() : (argv[index + 1] ?? process.cwd());
}

const root = rootFromArgs(process.argv.slice(2));

const TOOLS = [
  {
    name: 'decision_search',
    description:
      'Search the project decision log before starting work. Returns what was already tried, what failed and why, and under which conditions it may be worth retrying. Call this before proposing an approach that might have been ruled out.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What you are about to do, e.g. "Redis queue".' },
      },
      required: ['query'],
    },
  },
  {
    name: 'decision_record',
    description:
      'Record a dead end or a decision so the next session does not repeat it. Use when something was tried and rejected, or when a constraint was agreed.',
    inputSchema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'Short name, e.g. "Redis 队列".' },
        tried: { type: 'string', description: 'What was attempted.' },
        result: { type: 'string', description: 'What happened.' },
        reason: { type: 'string', description: 'Why it was abandoned or adopted.' },
        retry: { type: 'string', description: 'Conditions under which it becomes worth trying again.' },
      },
      required: ['topic'],
    },
  },
];

function reply(id, result) {
  return JSON.stringify({ jsonrpc: '2.0', id, result });
}

function fail(id, code, message) {
  return JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
}

function handle(message) {
  const { id, method, params } = message;

  switch (method) {
    case 'initialize':
      return reply(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'decision-log', version: '1.0.0' },
      });
    case 'tools/list':
      return reply(id, { tools: TOOLS });
    case 'tools/call': {
      const name = params?.name;
      const args = params?.arguments ?? {};
      if (name === 'decision_search') {
        const entries = searchEntries(root, String(args['query'] ?? ''));
        return reply(id, { content: [{ type: 'text', text: briefEntries(entries) }] });
      }
      if (name === 'decision_record') {
        const { entry } = appendEntry(root, {
          topic: String(args['topic'] ?? ''),
          tried: typeof args['tried'] === 'string' ? args['tried'] : undefined,
          result: typeof args['result'] === 'string' ? args['result'] : undefined,
          reason: typeof args['reason'] === 'string' ? args['reason'] : undefined,
          retry: typeof args['retry'] === 'string' ? args['retry'] : undefined,
        });
        return reply(id, { content: [{ type: 'text', text: `已记录：${entry.topic}` }] });
      }
      return fail(id, -32601, `unknown tool: ${String(name)}`);
    }
    case 'resources/list':
      return reply(id, { resources: [] });
    default:
      return fail(id, -32601, `unknown method: ${String(method)}`);
  }
}

const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  const trimmed = line.trim();
  if (trimmed.length === 0) return;
  try {
    const message = JSON.parse(trimmed);
    const response = handle(message);
    if (response !== undefined) process.stdout.write(`${response}\n`);
  } catch (error) {
    process.stdout.write(`${fail(null, -32700, error instanceof Error ? error.message : String(error))}\n`);
  }
});
