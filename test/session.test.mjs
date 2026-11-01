import { test } from 'node:test';
import assert from 'node:assert/strict';

import { analyzeWithRules, composeContinuation, renderSpec, rootObjective, summarize } from '../dist/index.js';

const previous = () =>
  analyzeWithRules('帮我写一个爬虫，同时加上代理池，另外再做一个可视化面板');

test('the carried summary names the objective and the requirements', () => {
  const summary = summarize(previous());
  assert.match(summary, /目标：帮我写一个爬虫/);
  assert.match(summary, /1\. 加上代理池/);
});

test('a continuation keeps last turn and adds this one, without re-deriving', () => {
  const { spec, notes } = composeContinuation(previous(), '再补一个断点续传');
  assert.equal(spec.objective.text, '再补一个断点续传');
  assert.ok(spec.carried !== undefined);
  assert.match(spec.carried.text, /代理池/);
  assert.ok(notes.some((entry) => entry.includes('上一轮')));
});

test('the combined source lets fidelity accept literals from either turn', () => {
  const { spec } = composeContinuation(previous(), '并发上限 8');
  const rendered = renderSpec(spec, { keepOriginal: 'off' });
  assert.equal(rendered.fidelity.ok, true, rendered.fidelity.issues.map((i) => i.detail).join('; '));
  assert.match(spec.meta.source, /爬虫/);
  assert.match(spec.meta.source, /并发上限 8/);
});

test('a continuation does not warn about low retention', () => {
  const long = analyzeWithRules(`${'背景说明。'.repeat(40)}帮我优化一下这个东西`);
  const { spec } = composeContinuation(long, '继续');
  const rendered = renderSpec(spec, { keepOriginal: 'off' });
  assert.equal(rendered.fidelity.issues.some((issue) => issue.kind === 'low-retention'), false);
});

test('without a previous turn it degrades to a plain compile', () => {
  const { spec, notes } = composeContinuation(undefined, '帮我优化一下这个东西');
  assert.equal(spec.carried, undefined);
  assert.ok(notes.some((entry) => entry.includes('普通请求')));
});

test('the rendered prompt shows the carried block before the new objective', () => {
  const { spec } = composeContinuation(previous(), '再补一个断点续传');
  const text = renderSpec(spec, { keepOriginal: 'off' }).text;
  assert.ok(text.indexOf('## 已确认') < text.indexOf('## 目标'));
});

test('an empty follow-up is rejected', () => {
  assert.throws(() => composeContinuation(previous(), '   '), /输入为空/);
});

test('carry=off sends the increment alone', () => {
  const { spec, notes } = composeContinuation(previous(), '再补一个断点续传', { carry: 'off' });
  assert.equal(spec.carried, undefined);
  assert.ok(notes.some((entry) => entry.includes('未携带')));
});

test('carry=minimal keeps the root objective but drops the requirements', () => {
  const { spec } = composeContinuation(previous(), '再补一个断点续传', { carry: 'minimal' });
  assert.match(spec.carried.text, /目标：帮我写一个爬虫/);
  assert.doesNotMatch(spec.carried.text, /代理池/);
});

test('the root objective survives a chain of continuations', () => {
  const first = composeContinuation(previous(), '再补一个断点续传').spec;
  const second = composeContinuation(first, '再加个日志', { carry: 'minimal' }).spec;
  assert.equal(rootObjective(second), '帮我写一个爬虫');
});

test('a continuation does not re-attach the growing transcript by default', () => {
  const { spec } = composeContinuation(previous(), '再补一个断点续传');
  const auto = renderSpec(spec); // keepOriginal defaults to auto
  assert.equal(auto.keptOriginal, false);

  const forced = renderSpec(spec, { keepOriginal: 'on' });
  assert.equal(forced.keptOriginal, true);
});

test('carry modes are monotonically cheaper', () => {
  const size = (mode) =>
    renderSpec(composeContinuation(previous(), '再补一个断点续传', { carry: mode }).spec).text.length;
  assert.ok(size('minimal') < size('full'));
  assert.ok(size('off') < size('minimal'));
});

