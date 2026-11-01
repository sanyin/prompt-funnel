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
  const next = answerQuestion(vague(), 'stack', 'Python');
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
