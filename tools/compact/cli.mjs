#!/usr/bin/env node
/**
 * `prompt-funnel compact <file|-> [--budget 600] [--json]`
 *
 * Reads a transcript or a long note, drops what carries no invariant, and proves
 * every literal survived.
 */

import { readFileSync } from 'node:fs';
import { compact, describeCompaction } from './compact.mjs';

const args = process.argv.slice(2);
const flags = new Map();
const words = [];
for (let index = 0; index < args.length; index += 1) {
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

const target = words[0];
if (target === undefined) {
  process.stderr.write('用法：prompt-funnel compact <文件|-> [--budget 600] [--json]\n');
  process.exit(2);
}

const source = target === '-' ? readFileSync(0, 'utf8') : readFileSync(target, 'utf8');
const budget = Number(flags.get('budget') ?? 600);
const result = compact(source, { budget });

if (flags.get('json') === true) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  process.stdout.write(`${result.text}\n\n`);
  process.stderr.write(`---\n${describeCompaction(result.report)}\n`);
}

process.exit(result.report.ok ? 0 : 1);
