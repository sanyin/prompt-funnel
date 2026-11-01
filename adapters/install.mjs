#!/usr/bin/env node
/**
 * Copy the skill into a host's skill directory.
 *
 *   node adapters/install.mjs codex     -> ~/.codex/skills/prompt-funnel
 *   node adapters/install.mjs dsh       -> ~/.dsh/skills/prompt-funnel
 *   node adapters/install.mjs claude    -> ~/.claude/skills/prompt-funnel
 *   node adapters/install.mjs project   -> ./.agents/skills/prompt-funnel
 *
 * Prints what it did and where, and refuses to overwrite without --force.
 */

import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, 'skills', 'prompt-funnel');

const targets = {
  codex: join(homedir(), '.codex', 'skills'),
  dsh: join(homedir(), '.dsh', 'skills'),
  claude: join(homedir(), '.claude', 'skills'),
  project: join(process.cwd(), '.agents', 'skills'),
};

const [, , targetName, ...flags] = process.argv;
const force = flags.includes('--force');

if (targetName === undefined || targets[targetName] === undefined) {
  console.error(`用法: node adapters/install.mjs <${Object.keys(targets).join('|')}> [--force]`);
  console.error('');
  for (const [name, path] of Object.entries(targets)) {
    console.error(`  ${name.padEnd(8)} ${path}`);
  }
  process.exit(2);
}

const destination = join(targets[targetName], 'prompt-funnel');

if (existsSync(destination) && !force) {
  console.error(`已存在：${destination}`);
  console.error('加 --force 覆盖。');
  process.exit(1);
}

mkdirSync(dirname(destination), { recursive: true });
cpSync(source, destination, { recursive: true });
console.log(`已安装 skill：${resolve(destination)}`);

if (targetName === 'codex' || targetName === 'dsh') {
  console.log('');
  console.log('还需要让这个 skill 能调用 MCP 工具（可选，缺了就退化成 CLI）：');
  console.log('  command: npx');
  console.log('  args:    ["-y", "prompt-funnel", "mcp"]');
}
