import { test } from 'node:test';
import assert from 'node:assert/strict';

import { analyzeWithRules, applyTemplate, getTemplate, renderSpec, TEMPLATES } from '../dist/index.js';

const spec = () => analyzeWithRules('帮我看看这个函数写得怎么样');

test('every built-in template has an id matching its key and a description', () => {
  for (const [key, template] of Object.entries(TEMPLATES)) {
    assert.equal(template.id, key);
    assert.ok(template.description.length > 5, `${key} has no description`);
  }
});

test('a template adds constraints and acceptance as visible assumptions', () => {
  const next = applyTemplate(spec(), getTemplate('code-review'));
  const added = [...next.constraints, ...next.acceptance].filter((item) => item.source === 'assumption');
  assert.ok(added.length >= 3);
  const text = renderSpec(next, { keepOriginal: 'off' }).text;
  assert.match(text, /（假定）/);
});

test('a template fills a missing deliverable but never overwrites the user', () => {
  const filled = applyTemplate(spec(), getTemplate('code-review'));
  assert.equal(filled.deliverable.format?.text, '一份可逐条处理的评审清单');
  assert.equal(filled.deliverable.format?.source, 'assumption');

  const said = analyzeWithRules('帮我写一份评审报告');
  const kept = applyTemplate(said, getTemplate('code-review'));
  assert.equal(kept.deliverable.format?.text, '帮我写一份评审报告');
  assert.equal(kept.deliverable.format?.source, 'user');
});

test('a template sets the intent and the render style', () => {
  const next = applyTemplate(spec(), getTemplate('image-prompt'));
  assert.equal(next.intent, 'write');
  assert.equal(next.meta.template, 'image-prompt');
});

test('template questions never push the open-question count past four', () => {
  const next = applyTemplate(spec(), getTemplate('research'));
  assert.ok(next.openQuestions.length <= 4);
});

test('an unknown template id falls back to default instead of throwing', () => {
  const fallback = getTemplate('does-not-exist');
  assert.equal(fallback.id, 'default');
  const unchanged = applyTemplate(spec(), fallback);
  assert.equal(unchanged.constraints.length, spec().constraints.length);
});

test('the critique template makes disagreement structural, not a slogan', () => {
  const next = applyTemplate(spec(), getTemplate('critique'));
  const text = next.constraints.map((item) => item.text).join('\n');
  assert.match(text, /第一句就给结论/);
  assert.match(text, /不要用「虽然…但是…」/);
  const added = next.acceptance.filter((item) => item.text.includes('至少指出一个'));
  assert.equal(added.length, 1);
  assert.equal(added[0].source, 'assumption');
});

test('the critique template does not force an intent, so it composes with anything', () => {
  const review = analyzeWithRules('帮我看看这个函数写得怎么样');
  const next = applyTemplate(review, getTemplate('critique'));
  assert.equal(next.intent, review.intent);
});
