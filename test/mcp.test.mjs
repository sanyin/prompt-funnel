import { test } from 'node:test';
import assert from 'node:assert/strict';

import { analyze } from '../dist/index.js';
import { handleMessage } from '../dist/mcp/server.js';

const request = (method, params, id = 1) => ({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) });

test('initialize advertises the tools capability', async () => {
  const response = await handleMessage(request('initialize', { protocolVersion: '2024-11-05' }));
  assert.equal(response.result.serverInfo.name, 'prompt-funnel');
  assert.ok(response.result.capabilities.tools !== undefined);
});

test('notifications get no response', async () => {
  const response = await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(response, undefined);
});

test('six tools are listed with input schemas', async () => {
  const response = await handleMessage(request('tools/list'));
  const names = response.result.tools.map((tool) => tool.name);
  assert.deepEqual(names, [
    'funnel_gate',
    'funnel_analyze',
    'funnel_render',
    'funnel_continue',
    'funnel_refine',
    'funnel_compile',
  ]);
  for (const tool of response.result.tools) {
    assert.equal(tool.inputSchema.type, 'object');
    assert.ok(tool.description.length > 40);
  }
});

test('funnel_gate returns the verdict', async () => {
  const response = await handleMessage(
    request('tools/call', { name: 'funnel_gate', arguments: { text: '帮我优化一下这个东西' } }),
  );
  assert.equal(response.result.isError, false);
  const payload = JSON.parse(response.result.content[0].text);
  assert.equal(payload.decision, 'compile');
});

test('funnel_analyze emits a spec and a review card', async () => {
  const response = await handleMessage(
    request('tools/call', { name: 'funnel_analyze', arguments: { text: '写个爬虫，同时加代理池' } }),
  );
  const body = response.result.content[0].text;
  assert.ok(body.includes('## spec'));
  assert.ok(body.includes('## review'));
  assert.ok(body.includes('funnel_render'));
});

test('analyze → render round-trip produces the final prompt', async () => {
  const raw = '帮我把这个模块改成支持并发下载，最多 5 个并发，不要改动导出接口';
  const spec = analyze(raw);
  const response = await handleMessage(
    request('tools/call', { name: 'funnel_render', arguments: { spec, source: raw, keepOriginal: 'off' } }),
  );
  const body = response.result.content[0].text;
  assert.equal(response.result.isError, false);
  assert.ok(body.includes('## prompt'));
  assert.ok(body.includes('最多 5 个并发'));
  assert.ok(body.includes('保真'));
});

test('render refuses when it cannot verify against a source', async () => {
  const response = await handleMessage(
    request('tools/call', { name: 'funnel_render', arguments: { spec: { objective: { text: 'x' } } } }),
  );
  assert.equal(response.result.isError, true);
  assert.match(response.result.content[0].text, /source/);
});

test('unknown methods answer with a JSON-RPC error', async () => {
  const response = await handleMessage(request('tools/unknown'));
  assert.equal(response.error.code, -32601);
});
