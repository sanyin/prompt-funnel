import { test } from 'node:test';
import assert from 'node:assert/strict';

import { analyzeWithRules, answerQuestion, renderSpec, splitContext } from '../dist/index.js';

const spec = () => {
  let next = analyzeWithRules('我想做一个像素小游戏，类似我的世界，要有新意');
  next = answerQuestion(next, 'quality', '玩法 / 规则上的新');
  next = answerQuestion(next, 'failure', '做出来不能用');
  return next;
};

test('chat style has no headings and reads as one message', () => {
  const text = renderSpec(spec(), { style: 'chat' }).text;
  assert.doesNotMatch(text, /^## /mu);
  assert.doesNotMatch(text, /- \[ \]/u);
  assert.ok(text.trim().split('\n\n').length <= 3, 'chat output should be two or three paragraphs');
});

test('chat style is materially shorter than the structured default', () => {
  const chat = renderSpec(spec(), { style: 'chat' }).text;
  const bluf = renderSpec(spec(), { style: 'bluf' }).text;
  assert.ok(chat.length < bluf.length * 0.8, `chat ${chat.length} vs bluf ${bluf.length}`);
});

test('chat style still states its defaults, so a guess never reads as the user', () => {
  const text = renderSpec(spec(), { style: 'chat' }).text;
  assert.match(text, /没说的地方我先按这几条处理/);
});

test('a negative criterion is phrased as a wish, not a checkbox', () => {
  const text = renderSpec(spec(), { style: 'chat' }).text;
  assert.match(text, /我最不想要的是做出来不能用/);
  assert.doesNotMatch(text, /不出现：/u);
});

test('chat style drops the source appendix unless it is asked for', () => {
  assert.equal(renderSpec(spec(), { style: 'chat' }).keptOriginal, false);
  assert.equal(renderSpec(spec(), { style: 'chat', keepOriginal: 'on' }).keptOriginal, true);
});

test('chat style keeps the user’s numbers intact', () => {
  let next = analyzeWithRules('把并发从 4 改成 8，别动接口');
  next = answerQuestion(next, 'format', '一段能直接用的文字');
  const text = renderSpec(next, { style: 'chat' }).text;
  assert.match(text, /4/);
  assert.match(text, /8/);
});

test('the fidelity check does not mistake list markers for invented numbers', () => {
  const result = renderSpec(spec(), { style: 'chat' });
  const errors = result.fidelity.issues.filter((issue) => issue.severity === 'error');
  assert.deepEqual(errors, []);
});

test('a paste with a separator splits into background and request', () => {
  const split = splitContext('TypeError at app.ts:12\n---\n帮我看看为什么报错');
  assert.equal(split.separated, true);
  assert.equal(split.context, 'TypeError at app.ts:12');
  assert.equal(split.request, '帮我看看为什么报错');
});

test('a message without a separator is all request', () => {
  const split = splitContext('帮我看看这个');
  assert.equal(split.separated, false);
  assert.equal(split.request, '帮我看看这个');
  assert.equal(split.context, '');
});

test('dashes with nothing after them are part of the message', () => {
  const split = splitContext('第一行\n---\n');
  assert.equal(split.separated, false);
  assert.match(split.request, /第一行/);
});

test('a horizontal rule inside a line is not a separator', () => {
  const split = splitContext('说明 --- 结束');
  assert.equal(split.separated, false);
});

test('background material is carried verbatim and rendered as context', () => {
  let next = analyzeWithRules('帮我看看为什么报错');
  next.context = [{ text: 'TypeError at app.ts:12', source: 'user' }];
  next.meta.source = 'TypeError at app.ts:12\n---\n帮我看看为什么报错';
  const text = renderSpec(next, { style: 'chat' }).text;
  assert.match(text, /背景：TypeError at app\.ts:12/);
  assert.match(text, /帮我看看为什么报错/);
});

test('short background stays a plain line', () => {
  const spec = analyzeWithRules('帮我看看为什么报错');
  spec.context = [{ text: 'TypeError at app.ts:12', source: 'user' }];
  const text = renderSpec(spec, { style: 'chat' }).text;
  assert.match(text, /^背景：TypeError/m);
  assert.doesNotMatch(text, /<context>/u);
});

test('a long paste is wrapped so the model can tell it from the ask', () => {
  const spec = analyzeWithRules('帮我看看为什么报错');
  spec.context = [{ text: 'x'.repeat(240), source: 'user' }];
  const text = renderSpec(spec, { style: 'chat' }).text;
  assert.match(text, /^<context>/m);
  assert.match(text, /<\/context>/u);
  assert.doesNotMatch(text, /^背景：/m);
});

test('several background documents get their own tags', () => {
  const spec = analyzeWithRules('帮我看看为什么报错');
  spec.context = [
    { text: 'first', source: 'user' },
    { text: 'second', source: 'user' },
  ];
  const text = renderSpec(spec, { style: 'bluf' }).text;
  assert.equal((text.match(/<document>/gu) ?? []).length, 2);
  assert.match(text, /<context>[\s\S]*first[\s\S]*second[\s\S]*<\/context>/u);
});

test('wrapping invents no literals, so fidelity still passes', () => {
  const spec = analyzeWithRules('帮我看看为什么报错');
  spec.context = [{ text: 'a'.repeat(240), source: 'user' }];
  spec.meta.source = 'a'.repeat(240);
  const result = renderSpec(spec, { style: 'chat' });
  assert.deepEqual(
    result.fidelity.issues.filter((issue) => issue.severity === 'error'),
    [],
  );
});
