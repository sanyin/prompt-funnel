import { test } from 'node:test';
import assert from 'node:assert/strict';

import { flagOn, flagValue, parseArgs } from '../dist/cli/shared.js';

test('a global flag before the command is not read as a command', () => {
  const args = parseArgs(['--help']);
  assert.equal(args.command, '');
  assert.equal(flagOn(args, 'help'), true);
});

test('short flags work in first position', () => {
  assert.equal(flagOn(parseArgs(['-v']), 'version'), true);
  assert.equal(flagOn(parseArgs(['-h']), 'help'), true);
});

test('command, words and flags are separated', () => {
  const args = parseArgs(['compile', '把 x 改成 y', '--style', 'compact', '--json']);
  assert.equal(args.command, 'compile');
  assert.deepEqual(args.words, ['把 x 改成 y']);
  assert.equal(flagValue(args, 'style'), 'compact');
  assert.equal(flagOn(args, 'json'), true);
});

test('flags may precede the command', () => {
  const args = parseArgs(['--style=checklist', 'review', 'text']);
  assert.equal(args.command, 'review');
  assert.deepEqual(args.words, ['text']);
  assert.equal(flagValue(args, 'style'), 'checklist');
});

test('-- stops flag parsing and keeps the rest as words', () => {
  const args = parseArgs(['compile', '--', '--not-a-flag']);
  assert.equal(args.command, 'compile');
  assert.deepEqual(args.words, ['--not-a-flag']);
  assert.equal(flagOn(args, 'not-a-flag'), false);
});

test('an empty command line yields an empty command', () => {
  const args = parseArgs([]);
  assert.equal(args.command, '');
  assert.deepEqual(args.words, []);
});
