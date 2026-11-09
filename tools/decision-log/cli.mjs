#!/usr/bin/env node
/**
 * `prompt-funnel log add|list|search|init`
 *
 *   add    --topic "Redis 队列" --tried "..." --result "..." --reason "..." [--retry "..."]
 *   list
 *   search "队列"
 *   init
 */

import { appendEntry, briefEntries, initLog, readEntries, searchEntries, FILE_NAME } from './log.mjs';

const args = process.argv.slice(2);
const command = args[0];
const flags = new Map();
const words = [];
for (let index = 1; index < args.length; index += 1) {
  const arg = args[index];
  if (arg.startsWith('--')) {
    const key = arg.slice(2);
    const next = args[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags.set(key, next);
      index += 1;
    } else {
      flags.set(key, true);
    }
  } else {
    words.push(arg);
  }
}

const root = process.cwd();

switch (command) {
  case 'init': {
    const { path, created } = initLog(root);
    process.stdout.write(created ? `已创建 ${path}\n` : `${path} 已存在\n`);
    break;
  }
  case 'add': {
    const topic = flags.get('topic');
    if (typeof topic !== 'string') {
      process.stderr.write('用法：log add --topic "..." [--tried ...] [--result ...] [--reason ...] [--retry ...]\n');
      process.exit(2);
    }
    const { entry } = appendEntry(root, {
      topic,
      tried: typeof flags.get('tried') === 'string' ? flags.get('tried') : undefined,
      result: typeof flags.get('result') === 'string' ? flags.get('result') : undefined,
      reason: typeof flags.get('reason') === 'string' ? flags.get('reason') : undefined,
      retry: typeof flags.get('retry') === 'string' ? flags.get('retry') : undefined,
    });
    process.stdout.write(`已记录：${entry.topic}\n`);
    break;
  }
  case 'list': {
    const entries = readEntries(root);
    if (entries.length === 0) {
      process.stdout.write(`还没有记录。${FILE_NAME} 会在第一条写入时创建。\n`);
      break;
    }
    process.stdout.write(`${briefEntries(entries)}\n`);
    break;
  }
  case 'search': {
    const query = words.join(' ');
    const entries = searchEntries(root, query);
    process.stdout.write(`${briefEntries(entries)}\n`);
    break;
  }
  default: {
    process.stderr.write(
      ['用法：', '  log init', '  log add --topic "..." [--tried ...] [--result ...] [--reason ...] [--retry ...]', '  log list', '  log search "<关键词>"', ''].join('\n'),
    );
    process.exit(2);
  }
}
