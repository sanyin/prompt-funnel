import { test } from 'node:test';
import assert from 'node:assert/strict';

import { splitCommand } from '../dist/cli/review.js';

test('a bare editor name is one token', () => {
  assert.deepEqual(splitCommand('vim'), ['vim']);
});

test('flag arguments are kept separate', () => {
  assert.deepEqual(splitCommand('code --wait'), ['code', '--wait']);
});

test('a quoted executable path survives intact', () => {
  assert.deepEqual(splitCommand('"C:\\Program Files\\Editor\\ed.exe" --wait'), [
    'C:\\Program Files\\Editor\\ed.exe',
    '--wait',
  ]);
});

test('extra whitespace does not create empty arguments', () => {
  assert.deepEqual(splitCommand('  code   --wait  '), ['code', '--wait']);
});

test('single quotes work too', () => {
  assert.deepEqual(splitCommand("'/usr/local/bin/my editor' -n"), ['/usr/local/bin/my editor', '-n']);
});

test('an empty value yields no tokens', () => {
  assert.deepEqual(splitCommand('   '), []);
});
