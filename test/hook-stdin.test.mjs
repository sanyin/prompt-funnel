import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';

import { collectPayload } from '../dist/hook-run.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('a complete payload resolves without waiting for end', async () => {
  const stream = new PassThrough();
  stream.write('{"prompt":"hi"}');
  // No .end() on purpose: a host may keep the pipe open.
  const payload = await collectPayload(stream, 5000);
  assert.equal(payload, '{"prompt":"hi"}');
});

test('a payload split across chunks is reassembled', async () => {
  const stream = new PassThrough();
  stream.write('{"prompt":');
  await wait(20);
  stream.write('"split"}');
  assert.equal(await collectPayload(stream, 5000), '{"prompt":"split"}');
});

test('a stream that never ends still resolves at the deadline', async () => {
  const stream = new PassThrough();
  stream.write('{"prompt":'); // incomplete on purpose
  const started = Date.now();
  const payload = await collectPayload(stream, 120);
  const elapsed = Date.now() - started;
  assert.equal(payload, '{"prompt":');
  assert.ok(elapsed >= 100 && elapsed < 1000, `deadline not honored: ${elapsed}ms`);
});

test('an ended stream resolves immediately with whatever arrived', async () => {
  const stream = new PassThrough();
  stream.end('not json');
  assert.equal(await collectPayload(stream, 5000), 'not json');
});
