import { test } from 'node:test';
import assert from 'node:assert/strict';

import { detectDomain, seedCount, seedsFor } from '../dist/index.js';

test('the library is small, hand-written and complete', () => {
  assert.ok(seedCount() >= 20, `only ${seedCount()} seeds`);
  for (const domain of ['game', 'tool', 'writing', 'data', 'dev']) {
    const seeds = seedsFor('test', { domain, limit: 3 });
    assert.ok(seeds.length > 0, `${domain} has no seeds`);
    for (const seed of seeds) {
      assert.equal(seed.domain, domain);
      assert.ok(seed.title.length > 4 && seed.why.length > 10);
      assert.ok(['low', 'medium', 'high'].includes(seed.cost));
      assert.match(seed.id, /^[a-z][a-z0-9-]*$/);
    }
  }
});

test('the same request always yields the same directions', () => {
  const text = '我想做一个像素游戏，要有新意';
  assert.deepEqual(
    seedsFor(text).map((seed) => seed.id),
    seedsFor(text).map((seed) => seed.id),
  );
});

test('the domain is inferred from the request', () => {
  assert.equal(detectDomain('我想做一个像素游戏'), 'game');
  assert.equal(detectDomain('帮我分析一下这个数据的留存'), 'data');
  assert.equal(detectDomain('写一篇公众号文章'), 'writing');
  assert.equal(detectDomain('重构这个仓库的接口'), 'dev');
  assert.equal(detectDomain('做一个浏览器插件'), 'tool');
});

test('at most three are offered, and never more than asked', () => {
  assert.equal(seedsFor('做一个工具').length, 3);
  assert.equal(seedsFor('做一个工具', { limit: 1 }).length, 1);
  assert.equal(seedsFor('做一个工具', { limit: 99 }).length, 3);
});

test('cheap directions come first: an idea you can try today beats a beautiful one', () => {
  for (const domain of ['game', 'tool', 'writing', 'data', 'dev']) {
    const seeds = seedsFor('x', { domain });
    const rank = { low: 0, medium: 1, high: 2 };
    for (let i = 1; i < seeds.length; i += 1) {
      assert.ok(rank[seeds[i].cost] >= rank[seeds[i - 1].cost], `${domain} is not cost-ordered`);
    }
  }
});

test('different requests in one domain do not always get the same three', () => {
  const a = seedsFor('我想做一个像素游戏，要有新意').map((seed) => seed.id).join();
  const b = seedsFor('做一个类似我的世界的沙盒游戏').map((seed) => seed.id).join();
  assert.notEqual(a, b);
});

test('an unrecognised request still gets usable directions', () => {
  const seeds = seedsFor('嗯……随便吧');
  assert.equal(seeds.length, 3);
});

