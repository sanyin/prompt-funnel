import { test } from 'node:test';
import assert from 'node:assert/strict';

import { compile } from '../dist/index.js';

const config = (engine) => ({
  engine,
  style: 'bluf',
  api: { baseUrl: 'http://127.0.0.1:1/v1', model: 'fake', apiKeyEnv: 'FUNNEL_TEST_KEY', timeoutMs: 500 },
});

test('a clear request passes through byte-for-byte', async () => {
  const raw = '这段代码为什么报 TypeError: Cannot read properties of undefined？';
  const result = await compile(raw, {}, { config: config('rules') });
  assert.equal(result.passedThrough, true);
  assert.equal(result.rendered.text, `${raw}\n`);
  assert.equal(result.rendered.keptOriginal, false);
});

test('--force compiles even when the gate says pass', async () => {
  const raw = '这段代码为什么报 TypeError: Cannot read properties of undefined？';
  const result = await compile(raw, { force: true }, { config: config('rules') });
  assert.equal(result.passedThrough, false);
  assert.ok(result.rendered.text.includes('## 目标'));
});

test('the api engine is used when a key exists and its output is merged', async () => {
  process.env['FUNNEL_TEST_KEY'] = 'test-key';
  const raw = '帮我优化一下这个东西';
  const fake = async () => ({
    intent: 'execute',
    objective: { text: '优化这个模块', source: 'inferred' },
    requirements: [{ text: '减少重复渲染', source: 'inferred' }],
    assumptions: [{ text: '优化目标是最小改动', impact: '若想大改需要重写方案' }],
  });
  const result = await compile(raw, {}, { config: config('api'), request: fake });
  assert.equal(result.spec.meta.engine, 'api');
  assert.equal(result.spec.objective.text, '优化这个模块');
  assert.deepEqual(result.spec.requirements.map((r) => r.text), ['减少重复渲染']);
  // The source is still attached so the model can check the rewrite.
  assert.ok(result.rendered.text.includes(raw));
  delete process.env['FUNNEL_TEST_KEY'];
});

test('an api failure degrades to rules instead of failing the turn', async () => {
  process.env['FUNNEL_TEST_KEY'] = 'test-key';
  const failing = async () => {
    throw new Error('HTTP 500: upstream');
  };
  const result = await compile('帮我优化一下这个东西', {}, { config: config('api'), request: failing });
  assert.equal(result.spec.meta.engine, 'rules');
  assert.ok(result.notes.some((entry) => entry.includes('回退')));
  assert.ok(result.rendered.text.length > 0);
  delete process.env['FUNNEL_TEST_KEY'];
});

test('missing key degrades to rules with a note', async () => {
  delete process.env['FUNNEL_TEST_KEY'];
  const result = await compile('帮我优化一下这个东西', { engine: 'api' }, { config: config('api') });
  assert.equal(result.spec.meta.engine, 'rules');
  assert.ok(result.notes.some((entry) => entry.includes('API key')));
});

test('empty input is rejected', async () => {
  await assert.rejects(() => compile('   ', {}, { config: config('rules') }), /输入为空/);
});
