import { test } from 'node:test';
import assert from 'node:assert/strict';

import { analyzeWithRules, answerAll, answerQuestion, questionsFor, renderSpec } from '../dist/index.js';

const vague = () => analyzeWithRules('帮我优化一下这个东西');

test('a vague request exposes answerable questions with options', () => {
  const questions = questionsFor(vague());
  assert.ok(questions.length >= 2);
  for (const question of questions) {
    assert.ok(question.question.length > 4);
    assert.ok(question.options.length >= 3, `${question.id} has too few options`);
    assert.ok(question.assumption.text.length > 0);
  }
});

test('answering replaces the default and removes the question', () => {
  const spec = vague();
  const before = questionsFor(spec).length;
  const next = answerQuestion(spec, 'format', '一份清单或表格');

  assert.equal(questionsFor(next).length, before - 1);
  assert.equal(next.deliverable.format?.text, '一份清单或表格');
  assert.equal(next.deliverable.format?.source, 'user');
  assert.ok(!next.openQuestions.some((question) => question.includes('形态')));
});

test('the answer shows up in the rendered prompt without an assumed marker', () => {
  const next = answerQuestion(vague(), 'format', '一份清单或表格');
  const text = renderSpec(next, { keepOriginal: 'off' }).text;
  assert.match(text, /一份清单或表格/);
  assert.doesNotMatch(text, /一份清单或表格（假定）/);
});

test('a scope answer lands in constraints, not requirements', () => {
  const spec = analyzeWithRules('帮我写个爬虫，顺便加个代理池，再做个面板');
  const next = answerQuestion(spec, 'scope', '先做第一件');
  assert.ok(next.constraints.some((item) => item.text === '先做第一件'));
  assert.ok(!next.requirements.some((item) => item.text === '先做第一件'));
});

test('the stack answer is labelled so it reads as a constraint', () => {
  // Earlier gaps are only skipped when the request already answers them; the
  // question cap then lets the stack through.
  const spec = analyzeWithRules('把 src/app.ts 的并发改成 8，最后给我一份报告，改完要能通过 pnpm test');
  const ids = questionsFor(spec).map((question) => question.id);
  assert.ok(ids.includes('stack'), ids.join(','));

  const next = answerQuestion(spec, 'stack', 'Python');
  assert.ok(next.constraints.some((item) => item.text === '技术栈：Python'));
});

test('answering everything leaves no questions and drops the pending section', () => {
  let spec = vague();
  for (const question of questionsFor(spec)) spec = answerQuestion(spec, question.id, question.options[0]);
  assert.equal(questionsFor(spec).length, 0);
  assert.equal(spec.openQuestions.length, 0);
});

test('answers can be applied as a batch and unknown ids are ignored', () => {
  const answers = new Map([
    ['format', '能跑的代码 + 说明'],
    ['acceptance', '能跑通 / 通过测试'],
    ['nope', 'whatever'],
  ]);
  const next = answerAll(vague(), answers);
  assert.ok(!questionsFor(next).some((question) => question.id === 'format'));
  assert.ok(!questionsFor(next).some((question) => question.id === 'acceptance'));
  assert.equal(next.deliverable.format?.text, '能跑的代码 + 说明');
  assert.ok(next.acceptance.some((item) => item.text === '能跑通 / 通过测试'));
});

test('the input spec is not mutated', () => {
  const spec = vague();
  const before = JSON.stringify(spec);
  answerQuestion(spec, 'format', 'X');
  assert.equal(JSON.stringify(spec), before);
});

test('english input gets english questions and options', () => {
  const questions = questionsFor(analyzeWithRules('make it better'));
  assert.ok(questions.length > 0);
  assert.match(questions[0].question, /[A-Za-z]/);
  assert.ok(questions[0].options.some((option) => /[A-Za-z]/.test(option)));
});

test('hollow praise words are turned into a decidable question, ranked first', () => {
  const spec = analyzeWithRules('我想做一个像素小游戏，要有新意，有竞争力');
  const questions = questionsFor(spec);
  assert.equal(questions[0].id, 'quality');
  assert.ok(questions[0].options.length >= 4);
});

test('picking an axis pins the novelty instead of leaving it to the model', () => {
  const spec = analyzeWithRules('要有新意，有竞争力');
  const next = answerQuestion(spec, 'quality', '视觉 / 氛围上的新');
  assert.ok(next.constraints.some((item) => item.text.includes('视觉 / 氛围上的新')));
  assert.equal(questionsFor(next).length, questionsFor(spec).length - 1);
});

test('asking for directions becomes a requirement, not a constraint', () => {
  const spec = analyzeWithRules('要有新意，有竞争力');
  const next = answerQuestion(spec, 'quality', '先给我三个方向选');
  assert.ok(next.requirements.some((item) => item.text.includes('先给 3 个方向')));
  assert.ok(!next.constraints.some((item) => item.text.includes('先给 3 个方向')));
});

test('a request without hollow praise gets no quality question', () => {
  const spec = analyzeWithRules('把 src/app.ts 的并发从 4 改成 8');
  assert.ok(!questionsFor(spec).some((question) => question.id === 'quality'));
});

test('a build request is asked what failure looks like', () => {
  const ids = questionsFor(analyzeWithRules('帮我写个爬虫，顺便加个代理池')).map((q) => q.id);
  assert.ok(ids.includes('failure'), ids.join(','));
});

test('a question or a bug report is not asked about failure modes', () => {
  const answer = questionsFor(analyzeWithRules('这个报错为什么不生效？'));
  assert.ok(!answer.some((q) => q.id === 'failure'));
});

test('naming a failure turns it into a negative acceptance criterion', () => {
  const spec = analyzeWithRules('帮我写个爬虫');
  const next = answerQuestion(spec, 'failure', '做出来不能用');
  assert.ok(next.acceptance.some((item) => item.text === '不出现：做出来不能用'));
  assert.equal(next.acceptance.find((item) => item.text.includes('做出来不能用'))?.source, 'user');
});

test('"I cannot say" is a real answer and invents nothing', () => {
  const spec = analyzeWithRules('帮我写个爬虫');
  const before = spec.acceptance.length;
  const next = answerQuestion(spec, 'failure', '我也说不上来');
  assert.equal(next.acceptance.length, before);
  assert.ok(!questionsFor(next).some((q) => q.id === 'failure'));
});
