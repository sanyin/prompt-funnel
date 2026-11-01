/**
 * Token cost of compiling, measured rather than guessed.
 *
 * The headline number ("18 → 263 tokens") is misleading on its own: the ratio is
 * huge only because the median request is tiny. What matters is the *absolute*
 * overhead per request, and how much of it can be bought back by choosing a
 * cheaper style.
 *
 * Usage: node evals/cost.mjs [--json]
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compile, estimateTokens } from '../dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(here, 'dataset.json'), 'utf8'));

const CONFIGS = [
  ['bluf+原文', { style: 'bluf', keepOriginal: 'on' }],
  ['bluf', { style: 'bluf', keepOriginal: 'off' }],
  ['compact+原文', { style: 'compact', keepOriginal: 'on' }],
  ['compact', { style: 'compact', keepOriginal: 'off' }],
  ['checklist', { style: 'checklist', keepOriginal: 'off' }],
];

const rows = [];
for (const entry of data.cases) {
  const row = { id: entry.id, raw: estimateTokens(entry.raw) };
  for (const [label, options] of CONFIGS) {
    const result = await compile(entry.raw, { force: true, ...options });
    row[label] = estimateTokens(result.rendered.text);
  }
  rows.push(row);
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[middle - 1] + sorted[middle]) / 2) : sorted[middle];
};

const labels = CONFIGS.map(([label]) => label);
const summary = {
  raw: median(rows.map((row) => row.raw)),
  ...Object.fromEntries(labels.map((label) => [label, median(rows.map((row) => row[label]))])),
};

if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify({ summary, rows }, null, 2)}\n`);
} else {
  console.log(['用例'.padEnd(18), '原文'.padStart(6), ...labels.map((label) => label.padStart(12))].join(''));
  for (const row of rows) {
    console.log(
      [row.id.padEnd(18), String(row.raw).padStart(6), ...labels.map((label) => String(row[label]).padStart(12))].join(''),
    );
  }
  console.log('');
  console.log(
    ['中位数'.padEnd(18), String(summary.raw).padStart(6), ...labels.map((label) => String(summary[label]).padStart(12))].join(''),
  );
  console.log(
    ['绝对开销'.padEnd(18), ''.padStart(6), ...labels.map((label) => String(summary[label] - summary.raw).padStart(12))].join(''),
  );
}
