import { test } from 'node:test';
import assert from 'node:assert/strict';

import { analyzeWithRules, extractHardTokens } from '../dist/index.js';

test('numbered requirements all survive, with no item promoted to objective', () => {
  const spec = analyzeWithRules('1. 支持断点续传\n2. 失败自动重试 3 次\n3. 输出 CSV');
  const texts = spec.requirements.map((requirement) => requirement.text);
  assert.deepEqual(texts, ['支持断点续传', '失败自动重试 3 次', '输出 CSV']);
  assert.equal(spec.objective.source, 'inferred');
  assert.ok(spec.requirements.every((requirement) => requirement.source === 'user'));
});

test('constraints and non-goals are separated', () => {
  const spec = analyzeWithRules('输出必须限制在 500 字以内，不要改动对外 API，不要引入新的依赖');
  assert.ok(spec.constraints.some((item) => item.text.includes('500 字')));
  assert.ok(spec.nonGoals.some((item) => item.text.includes('对外 API')));
  assert.ok(spec.nonGoals.some((item) => item.text.includes('依赖')));
});

test('the objective is copied verbatim from the source', () => {
  const raw = '把登录页的按钮改成蓝色';
  const spec = analyzeWithRules(raw);
  assert.equal(spec.objective.source, 'user');
  assert.ok(raw.includes(spec.objective.text));
});

test('nothing is invented: inferred content is marked', () => {
  const spec = analyzeWithRules('帮我看看这个');
  assert.equal(spec.deliverable.format?.source, 'inferred');
  for (const item of spec.acceptance) {
    assert.notEqual(item.source, 'user');
  }
});

test('code fences become anchors and stay byte-identical', () => {
  const raw = '这段代码为什么慢？\n```js\nconst a = arr.filter(Boolean).map(fn);\n```';
  const spec = analyzeWithRules(raw);
  assert.ok(spec.anchors.some((anchor) => anchor.includes('arr.filter(Boolean)')));
});

test('open questions are capped at four', () => {
  const spec = analyzeWithRules('帮我做一个后台管理系统，同时把数据也迁移过来，另外写一份文档');
  assert.ok(spec.openQuestions.length <= 4);
  assert.ok(spec.assumptions.length >= spec.openQuestions.length);
});

test('hard tokens cover numbers, paths, identifiers and quotes', () => {
  const tokens = extractHardTokens('把 timeout 从 30s 改成 60s，改在 src/config.ts 里，保留 "maxRetries"');
  const values = tokens.map((token) => token.value);
  assert.ok(values.includes('30'));
  assert.ok(values.includes('60'));
  assert.ok(values.some((value) => value.includes('src/config.ts')));
  assert.ok(values.includes('maxRetries'));
});
