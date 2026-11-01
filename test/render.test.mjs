import { test } from 'node:test';
import assert from 'node:assert/strict';

import { analyzeWithRules, renderSpec } from '../dist/index.js';

const raw = '帮我把这个模块改成支持并发下载，最多 5 个并发，不要改动导出接口';

test('bluf renders the 总-分-总 shape', () => {
  const spec = analyzeWithRules('帮我把这个模块改成支持并发下载，最多 5 个并发，不要改动导出接口');
  const { text } = renderSpec(spec, { style: 'bluf', keepOriginal: 'off' });
  assert.ok(text.startsWith('## 目标'));
  assert.ok(text.includes('## 不要做'));
  assert.ok(text.includes('## 完成标准'));
  assert.ok(text.indexOf('## 完成标准') > text.indexOf('## 不要做'));
});

test('inferred items carry a visible marker', () => {
  const spec = analyzeWithRules('帮我看看这个');
  const { text } = renderSpec(spec, { keepOriginal: 'off' });
  assert.ok(text.includes('（假定）'));
});

test('the original is re-attached only when it adds information', () => {
  const clear = analyzeWithRules('把 a.ts 里的 foo 函数改成 async，改完能通过测试');
  const withoutAssumptions = renderSpec(clear, { keepOriginal: 'auto' });
  // No assumptions and no anchors: attaching the source would just repeat it.
  if (clear.assumptions.length === 0 && clear.anchors.length === 0) {
    assert.equal(withoutAssumptions.keptOriginal, false);
  }

  const vague = analyzeWithRules('帮我看看这个');
  const withAssumptions = renderSpec(vague, { keepOriginal: 'auto' });
  assert.equal(withAssumptions.keptOriginal, true);
  assert.ok(withAssumptions.text.includes('## 原文'));
});

test('compact stays short and checklist is all checkboxes', () => {
  const spec = analyzeWithRules(raw);
  const compact = renderSpec(spec, { style: 'compact', keepOriginal: 'off' }).text;
  const checklist = renderSpec(spec, { style: 'checklist', keepOriginal: 'off' }).text;

  assert.ok(!compact.includes('## 目标'));
  assert.ok(compact.includes('**目标**'));
  assert.ok(checklist.split('\n').every((line) => line.length === 0 || line.startsWith('- [ ]')));
});

test('english input renders english labels', () => {
  const spec = analyzeWithRules('Refactor src/app.ts to use the new cache layer, keep the public API stable');
  const { text } = renderSpec(spec, { keepOriginal: 'off' });
  assert.ok(text.includes('## Objective'));
});

test('rendering is deterministic', () => {
  const spec = analyzeWithRules(raw, undefined, { now: '2026-01-01T00:00:00.000Z' });
  const first = renderSpec(spec, { keepOriginal: 'off' }).text;
  const second = renderSpec(spec, { keepOriginal: 'off' }).text;
  assert.equal(first, second);
});
