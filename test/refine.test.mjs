import { test } from 'node:test';
import assert from 'node:assert/strict';

import { analyzeWithRules, applyPatches, parseRefineNote, renderSpec } from '../dist/index.js';

const base = () => analyzeWithRules('帮我写一个爬虫，同时加上代理池，另外再做一个可视化面板');

test('a numbered replacement targets exactly one requirement', () => {
  const patches = parseRefineNote('第 2 点改成先做爬虫骨架');
  assert.deepEqual(patches, [{ section: 'requirements', op: 'replace', index: 1, text: '先做爬虫骨架' }]);

  const { spec, applied } = applyPatches(base(), patches);
  assert.equal(spec.requirements[1]?.text, '先做爬虫骨架');
  assert.equal(spec.requirements[0]?.text, '加上代理池');
  assert.match(applied[0] ?? '', /要求 2/);
});

test('removing an item renumbers the rest', () => {
  const { spec } = applyPatches(base(), parseRefineNote('第 1 条删掉'));
  assert.deepEqual(
    spec.requirements.map((requirement) => [requirement.id, requirement.text]),
    [
      ['R1', '再做一个可视化面板'],
    ],
  );
});

test('appending a requirement gives it a fresh id', () => {
  const { spec } = applyPatches(base(), parseRefineNote('再加一条：支持断点续传'));
  const last = spec.requirements.at(-1);
  assert.equal(last?.text, '支持断点续传');
  assert.equal(last?.source, 'user');
  assert.equal(last?.id, `R${spec.requirements.length}`);
});

test('objective and length patches land in the right fields', () => {
  const objective = applyPatches(base(), parseRefineNote('目标改成先跑通最小爬虫'));
  assert.equal(objective.spec.objective.text, '先跑通最小爬虫');
  assert.equal(objective.spec.objective.source, 'user');

  const length = applyPatches(base(), parseRefineNote('限制在 500 字以内'));
  assert.equal(length.spec.deliverable.length?.text, '500 字以内');
});

test('a "don\'t do X" note becomes a non-goal, not a constraint', () => {
  const { spec } = applyPatches(base(), parseRefineNote('别动导出接口'));
  assert.equal(spec.nonGoals.at(-1)?.text, '不要动导出接口');
});

test('english refinement works too', () => {
  const patches = parseRefineNote('requirement 1: use asyncio instead');
  assert.deepEqual(patches, [{ section: 'requirements', op: 'replace', index: 0, text: 'use asyncio instead' }]);
});

test('an unrecognised note yields no patches instead of a guess', () => {
  assert.deepEqual(parseRefineNote('嗯……你觉得怎么好就怎么来吧'), []);
});

test('an out-of-range index is reported, not silently dropped', () => {
  const { applied, spec } = applyPatches(base(), [{ section: 'requirements', op: 'remove', index: 9 }]);
  assert.equal(spec.requirements.length, 2);
  assert.match(applied[0] ?? '', /不存在/);
});

test('literals typed in the note are not reported as invented', () => {
  const spec = base();
  const { spec: refined } = applyPatches(spec, [{ section: 'requirements', op: 'append', text: '并发上限 8' }]);
  const rendered = renderSpec(refined, { keepOriginal: 'off' });
  assert.equal(rendered.fidelity.ok, true, rendered.fidelity.issues.map((issue) => issue.detail).join('; '));

  // A literal that appears in neither the source nor the note is still an error.
  const injected = applyPatches(spec, []).spec;
  injected.constraints.push({ text: '内存不超过 512MB', source: 'inferred' });
  const bad = renderSpec(injected, { keepOriginal: 'off' });
  assert.equal(bad.fidelity.ok, false);
});

test('the input spec is not mutated', () => {
  const spec = base();
  const before = JSON.stringify(spec);
  applyPatches(spec, parseRefineNote('第 2 点改成 X'));
  assert.equal(JSON.stringify(spec), before);
});
