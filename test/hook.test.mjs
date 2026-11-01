import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runHook, safeRunHook } from '../dist/hook.js';

const ambiguous = { prompt: '帮我写个爬虫，顺便加个代理池，再做个面板', hook_event_name: 'UserPromptSubmit' };
const clear = { prompt: '这段代码为什么报 TypeError: x is not a function？' };

test('a clear prompt produces no output at all', () => {
  const outcome = runHook(clear, { mode: 'advisory' });
  assert.equal(outcome.stdout, '');
  assert.equal(outcome.exitCode, 0);
  assert.equal(outcome.reason, 'clear');
});

test('an ambiguous prompt gets the compiled structure as context', () => {
  const outcome = runHook(ambiguous, { mode: 'advisory' });
  assert.equal(outcome.exitCode, 0);
  const payload = JSON.parse(outcome.stdout);
  assert.equal(payload.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(payload.hookSpecificOutput.additionalContext, /## 目标/);
  // The user's own words must still be visible in what is injected.
  assert.match(payload.hookSpecificOutput.additionalContext, /爬虫/);
});

test('block mode refuses the prompt with a readable reason', () => {
  const outcome = runHook(ambiguous, { mode: 'block' });
  const payload = JSON.parse(outcome.stdout);
  assert.equal(payload.decision, 'block');
  assert.match(payload.reason, /## 目标/);
});

test('off mode never touches anything', () => {
  assert.equal(runHook(ambiguous, { mode: 'off' }).stdout, '');
});

test('an empty or malformed payload is a no-op', () => {
  assert.equal(runHook({}, {}).reason, 'empty');
  assert.equal(runHook({ prompt: 42 }, {}).reason, 'empty');
  assert.equal(runHook({ prompt: '   ' }, {}).reason, 'empty');
});

test('a payload too large to inject is skipped rather than bloating the context', () => {
  const huge = { prompt: `${'帮我优化一下这个东西，'.repeat(400)}` };
  const outcome = runHook(huge, { mode: 'advisory' });
  assert.equal(outcome.stdout, '');
  assert.equal(outcome.reason, 'too-long');
});

test('an internal failure degrades to silence instead of breaking the session', () => {
  const hostile = {
    get prompt() {
      throw new Error('boom');
    },
  };
  const outcome = safeRunHook(hostile, { mode: 'advisory' });
  assert.equal(outcome.exitCode, 0);
  assert.equal(outcome.stdout, '');
  assert.equal(outcome.reason, 'error');
});
