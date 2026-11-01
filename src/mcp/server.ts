/**
 * MCP server (stdio, JSON-RPC 2.0, newline-delimited).
 *
 * Why a tool server rather than a host-specific plugin: the loop this project
 * needs — gate, analyze, let the user edit, render — is expressible in four
 * tools, and every agent that speaks MCP can host it. The host's own model does
 * the semantic work, so no second API key is required and no extra tokens are
 * spent on a separate rewriter.
 *
 * Implemented without the SDK: the surface is four tools and one lifecycle
 * method, and a dependency-free server starts faster inside an agent's tool
 * sandbox than an `npm install` does.
 *
 * @module prompt-funnel/mcp/server
 */

import { createInterface } from 'node:readline';

import { analyze, compile } from '../compile.js';
import { loadConfig } from '../config.js';
import { gate } from '../gate.js';
import { applyPatches, REFINE_FORMS, parseRefineNote } from '../refine.js';
import { renderSpec } from '../render.js';
import { composeContinuation } from '../session.js';
import { loadSpec } from '../store.js';
import { coerceSpec, validateSpec } from '../validate.js';
import type { PromptSpec, StyleName } from '../types.js';
import { VERSION } from '../version.js';

const PROTOCOL_VERSION = '2024-11-05';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: unknown;
}

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const STYLE_ENUM = ['bluf', 'compact', 'checklist'];

const TOOLS: ToolDefinition[] = [
  {
    name: 'funnel_gate',
    description:
      'Decide whether a user request is clear enough to send as-is, or worth restructuring first. ' +
      'Cheap and deterministic: returns a decision, a 0..1 clarity score, per-axis scores and readable reasons. ' +
      'Call this first when the user pushes back on rewriting ("just send it"), or to explain why the tool would change anything.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: "The user's raw request, verbatim." } },
      required: ['text'],
    },
  },
  {
    name: 'funnel_analyze',
    description:
      'Turn a raw request into a PromptSpec: objective, numbered requirements, constraints, non-goals, ' +
      'deliverable, acceptance criteria, explicit assumptions and at most three open questions. ' +
      'Deterministic and extractive — it reorders and flags, it never invents content. ' +
      'Use it at the start of a turn whose request is ambiguous or bundles several tasks. ' +
      'Show the returned review card to the user, apply their edits to the spec, then call funnel_render.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: "The user's raw request, verbatim." },
        style: { type: 'string', enum: STYLE_ENUM, description: 'Rendering style to plan for.' },
        template: {
          type: 'string',
          description: 'Intent template id (code-review, debug, data-analysis, writing, image-prompt, research).',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'funnel_render',
    description:
      'Validate a PromptSpec and render it into the final prompt text. ' +
      'Re-run this after the user edits the spec: it re-checks that nothing in the text contradicts the original, ' +
      'flags literals that do not appear in the source, and warns when too many requirements were bundled. ' +
      'The returned prompt is what you should send to the model for this turn.',
    inputSchema: {
      type: 'object',
      properties: {
        spec: { type: 'object', description: 'PromptSpec, possibly edited by the user. Partial objects are merged with a fresh analysis.' },
        source: { type: 'string', description: "Original request. Required when `spec` lacks meta.source; used for the fidelity check." },
        style: { type: 'string', enum: STYLE_ENUM },
        keepOriginal: {
          type: 'string',
          enum: ['auto', 'on', 'off'],
          description: 'Re-attach the source as an authoritative quote. Default auto: only when assumptions exist.',
        },
      },
      required: ['spec'],
    },
  },
  {
    name: 'funnel_continue',
    description:
      'Handle a follow-up turn ("再补个测试", "继续", "顺便加个日志") without losing what was already agreed. ' +
      'Takes the previous PromptSpec as settled context and analyses only the new increment, so the model sees ' +
      '"已确认（上一轮）" followed by this turn\'s ask. ' +
      'Use this instead of funnel_analyze whenever a spec already exists and the user is adding to it.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'This turn only — what is being added or changed.' },
        spec: { type: 'object', description: 'Previous spec. Omit to use the most recent one on disk.' },
        carry: {
          type: 'string',
          enum: ['minimal', 'full', 'off'],
          description:
            'How much of the previous turn to re-send. Default minimal (the host already has the conversation); ' +
            'full repeats requirements, for hosts with no history.',
        },
        style: { type: 'string', enum: STYLE_ENUM },
        keepOriginal: { type: 'string', enum: ['auto', 'on', 'off'] },
      },
      required: ['text'],
    },
  },
  {
    name: 'funnel_refine',
    description:
      'Apply one targeted change to an existing PromptSpec instead of re-analysing the request: ' +
      '"make point 2 shorter", "第 2 条删掉", "再加一条：…". Only the named section changes; everything already agreed on is preserved. ' +
      'Returns the rendered prompt plus a line per change. ' +
      'Use this for follow-ups after a spec exists — never re-run funnel_analyze for a small edit.',
    inputSchema: {
      type: 'object',
      properties: {
        note: { type: 'string', description: 'The refinement, e.g. "第 2 点改成先做爬虫".' },
        spec: { type: 'object', description: 'Spec to refine. Omit to use the most recent one on disk.' },
        source: { type: 'string', description: "Original request, required when `spec` lacks meta.source." },
        style: { type: 'string', enum: STYLE_ENUM },
        keepOriginal: { type: 'string', enum: ['auto', 'on', 'off'] },
      },
      required: ['note'],
    },
  },
  {
    name: 'funnel_compile',
    description:
      'One-shot convenience: gate, analyze and render in a single call, optionally using an OpenAI-compatible API ' +
      'when a key is configured. Returns the prompt, the spec, and whether the gate passed the request through unchanged. ' +
      'Use when the user wants the result without reviewing intermediate steps.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: "The user's raw request, verbatim." },
        style: { type: 'string', enum: STYLE_ENUM },
        engine: { type: 'string', enum: ['auto', 'rules', 'api'] },
        keepOriginal: { type: 'string', enum: ['auto', 'on', 'off'] },
      },
      required: ['text'],
    },
  },
];

function text(value: unknown): string {
  if (typeof value !== 'object' || value === null) return '';
  const record = value as Record<string, unknown>;
  return typeof record['text'] === 'string' ? record['text'] : '';
}

function styleOf(value: unknown): StyleName | undefined {
  return value === 'bluf' || value === 'compact' || value === 'checklist' ? value : undefined;
}

function keepOf(value: unknown): 'auto' | 'on' | 'off' | undefined {
  return value === 'auto' || value === 'on' || value === 'off' ? value : undefined;
}

/** Human-readable review card, for the host to paste into the conversation. */
function reviewCard(spec: PromptSpec): string {
  const lines: string[] = [];
  lines.push(`意图：${spec.intent}　目标：${spec.objective.text}`);
  lines.push(`要求 ${spec.requirements.length} 条　约束 ${spec.constraints.length} 条　非目标 ${spec.nonGoals.length} 条`);
  if (spec.assumptions.length > 0) {
    lines.push('默认假设（若不回答，就按这些走）：');
    for (const assumption of spec.assumptions) lines.push(`  - ${assumption.text}（若不符：${assumption.impact}）`);
  }
  if (spec.openQuestions.length > 0) {
    lines.push('建议先问用户：');
    spec.openQuestions.forEach((question, index) => lines.push(`  ${index + 1}. ${question}`));
  }
  return lines.join('\n');
}

const NEXT_STEP =
  '下一步：把 review 给用户看 → 用户认可/修改后调整 spec（不得新增原文没有的事实）→ 调用 funnel_render → 把返回的 prompt 作为本轮发给模型的内容。' +
  '用户明确说"就这样/直接发"时，不要再改写。';

async function callTool(name: string, args: unknown): Promise<string> {
  switch (name) {
    case 'funnel_gate': {
      const source = text(args);
      if (source.trim().length === 0) throw new Error('text 不能为空');
      const verdict = gate(source);
      return JSON.stringify({ ...verdict, advice: verdict.decision === 'pass' ? '原样发送' : '值得先收束' }, null, 2);
    }
    case 'funnel_analyze': {
      const source = text(args);
      if (source.trim().length === 0) throw new Error('text 不能为空');
      const record = args as Record<string, unknown>;
      const style = styleOf(record['style']);
      const template = typeof record['template'] === 'string' ? record['template'] : undefined;
      const spec = analyze(source, {
        ...(style !== undefined ? { style } : {}),
        ...(template !== undefined ? { template } : {}),
      });
      return [
        '## spec（可被用户修改后传回 funnel_render）',
        '```json',
        JSON.stringify(spec, null, 2),
        '```',
        '',
        '## review（给用户看的摘要）',
        reviewCard(spec),
        '',
        '## 说明',
        `闸门判定：${spec.meta.gate.decision}　清晰度：${spec.meta.gate.score}　引擎：${spec.meta.engine}`,
        NEXT_STEP,
      ].join('\n');
    }
    case 'funnel_render': {
      const record = typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {};
      const rawSpec = record['spec'];
      const source = typeof record['source'] === 'string' ? record['source'] : '';
      const base = source.trim().length > 0 ? analyze(source) : undefined;
      if (base === undefined) {
        throw new Error('缺少 source：spec 里没有 meta.source 时必须传 source，否则无法做保真校验');
      }
      const spec = coerceSpec(rawSpec, base);
      const issues = validateSpec(spec);
      const style = styleOf(record['style']);
      const keepOriginal = keepOf(record['keepOriginal']);
      const rendered = renderSpec(spec, {
        ...(style !== undefined ? { style } : {}),
        ...(keepOriginal !== undefined ? { keepOriginal } : {}),
      });
      const problems = [...issues, ...rendered.fidelity.issues];
      return [
        '## prompt（本轮发给模型的内容）',
        '```markdown',
        rendered.text.trimEnd(),
        '```',
        '',
        '## 校验',
        `保真：原文保留 ${(rendered.fidelity.retention * 100).toFixed(0)}%　未溯源字面量：${rendered.fidelity.unverifiable.length}　${rendered.fidelity.ok ? '通过' : '有错误'}`,
        ...problems.map((issue) => `- ${issue.severity === 'error' ? '错误' : '提示'}：${issue.detail}`),
        '',
        '若校验报了未溯源字面量，先问用户那些数字/路径是否正确，再发送。',
      ].join('\n');
    }
    case 'funnel_refine': {
      const record = typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {};
      const refinement = typeof record['note'] === 'string' ? record['note'].trim() : '';
      if (refinement.length === 0) throw new Error('note 不能为空');

      const source = typeof record['source'] === 'string' ? record['source'] : '';
      const given = record['spec'];
      let spec: PromptSpec | undefined;

      if (typeof given === 'object' && given !== null) {
        const base = source.trim().length > 0 ? analyze(source) : loadSpec();
        if (base === undefined) throw new Error('缺少 source：spec 里没有 meta.source 时必须传 source');
        spec = coerceSpec(given, base);
      } else {
        spec = loadSpec();
        if (spec === undefined) throw new Error('没有可修改的 spec：先调用 funnel_analyze，或直接传 spec');
      }

      if (typeof spec.meta.source !== 'string') {
        throw new Error('spec 缺少 meta.source，无法做保真校验');
      }

      const patches = parseRefineNote(refinement);
      if (patches.length === 0) {
        return ['没看懂这条意见。支持的形式：', ...REFINE_FORMS.map((form) => `- ${form}`)].join('\n');
      }

      const { spec: next, applied } = applyPatches(spec, patches);
      const style = styleOf(record['style']);
      const keepOriginal = keepOf(record['keepOriginal']);
      const rendered = renderSpec(next, {
        ...(style !== undefined ? { style } : {}),
        ...(keepOriginal !== undefined ? { keepOriginal } : {}),
      });

      return [
        '## prompt（本轮发给模型的内容）',
        '```markdown',
        rendered.text.trimEnd(),
        '```',
        '',
        '## 改了什么',
        ...applied.map((entry) => `- ${entry}`),
        '',
        `保真：原文保留 ${(rendered.fidelity.retention * 100).toFixed(0)}%　${rendered.fidelity.ok ? '通过' : '有错误'}`,
        ...rendered.fidelity.issues.map((issue) => `- ${issue.severity === 'error' ? '错误' : '提示'}：${issue.detail}`),
      ].join('\n');
    }
    case 'funnel_continue': {
      const record = typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {};
      const text = typeof record['text'] === 'string' ? record['text'].trim() : '';
      if (text.length === 0) throw new Error('text 不能为空');

      const given = record['spec'];
      const fromCall =
        typeof given === 'object' && given !== null && typeof (given as PromptSpec).meta?.source === 'string'
          ? (given as PromptSpec)
          : undefined;
      const previous = fromCall ?? loadSpec();

      // A chat host already has the conversation; repeating the requirements
      // every turn is pure duplication. The CLI defaults to full because it is
      // usually stateless.
      const carryRaw = record['carry'];
      const carry = carryRaw === 'full' || carryRaw === 'minimal' || carryRaw === 'off' ? carryRaw : 'minimal';
      const { spec, notes } = composeContinuation(previous, text, { carry });
      const style = styleOf(record['style']);
      const keepOriginal = keepOf(record['keepOriginal']);
      const rendered = renderSpec(spec, {
        ...(style !== undefined ? { style } : {}),
        ...(keepOriginal !== undefined ? { keepOriginal } : {}),
      });

      return [
        '## prompt（本轮发给模型的内容）',
        '```markdown',
        rendered.text.trimEnd(),
        '```',
        '',
        '## 说明',
        ...(notes.length > 0 ? notes.map((entry) => `- ${entry}`) : ['- 没有上一轮 spec，按普通请求处理']),
        `保真：原文保留 ${(rendered.fidelity.retention * 100).toFixed(0)}%　${rendered.fidelity.ok ? '通过' : '有错误'}`,
        ...rendered.fidelity.issues.map((issue) => `- ${issue.severity === 'error' ? '错误' : '提示'}：${issue.detail}`),
      ].join('\n');
    }
    case 'funnel_compile': {
      const record = typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {};
      const source = text(args);
      if (source.trim().length === 0) throw new Error('text 不能为空');
      const style = styleOf(record['style']);
      const keepOriginal = keepOf(record['keepOriginal']);
      const engine = record['engine'];
      const result = await compile(source, {
        ...(style !== undefined ? { style } : {}),
        ...(keepOriginal !== undefined ? { keepOriginal } : {}),
        ...(engine === 'auto' || engine === 'rules' || engine === 'api' ? { engine } : {}),
      });
      return [
        result.passedThrough ? '## 闸门放行：原文已足够清晰，未改写' : '## prompt',
        '```markdown',
        result.rendered.text.trimEnd(),
        '```',
        '',
        `引擎：${result.spec.meta.engine}　保真：${(result.rendered.fidelity.retention * 100).toFixed(0)}%`,
        ...result.notes.map((entry) => `- ${entry}`),
      ].join('\n');
    }
    default:
      throw new Error(`未知工具：${name}`);
  }
}

/** Handle one JSON-RPC message; returns the response, or undefined for notifications. */
export async function handleMessage(message: JsonRpcRequest): Promise<unknown | undefined> {
  const isNotification = message.id === undefined || message.id === null;

  try {
    switch (message.method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id: message.id ?? null,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: 'prompt-funnel', version: VERSION },
            instructions:
              '提示词收束入口：在把模糊请求发给模型之前，用 funnel_analyze 生成 spec，向用户确认，再用 funnel_render 产出最终提示词。',
          },
        };
      case 'notifications/initialized':
      case 'notifications/cancelled':
        return undefined;
      case 'ping':
        return { jsonrpc: '2.0', id: message.id ?? null, result: {} };
      case 'tools/list':
        return { jsonrpc: '2.0', id: message.id ?? null, result: { tools: TOOLS } };
      case 'tools/call': {
        const params = (message.params ?? {}) as { name?: string; arguments?: unknown };
        if (typeof params.name !== 'string') {
          return {
            jsonrpc: '2.0',
            id: message.id ?? null,
            error: { code: -32602, message: 'tools/call 缺少 name' },
          };
        }
        const output = await callTool(params.name, params.arguments ?? {});
        return {
          jsonrpc: '2.0',
          id: message.id ?? null,
          result: { content: [{ type: 'text', text: output }], isError: false },
        };
      }
      default:
        if (isNotification) return undefined;
        return {
          jsonrpc: '2.0',
          id: message.id ?? null,
          error: { code: -32601, message: `不支持的方法：${message.method}` },
        };
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (isNotification) return undefined;
    return {
      jsonrpc: '2.0',
      id: message.id ?? null,
      result: { content: [{ type: 'text', text: `错误：${detail}` }], isError: true },
    };
  }
}

/** Serve MCP over stdio until stdin closes. */
export async function serve(): Promise<void> {
  // Touch config once so a broken file is reported on stderr at startup, not
  // halfway through a turn.
  loadConfig();
  process.stderr.write(`prompt-funnel ${VERSION} MCP server ready (stdio)\n`);

  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let parsed: JsonRpcRequest;
    try {
      parsed = JSON.parse(trimmed) as JsonRpcRequest;
    } catch {
      process.stdout.write(
        `${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } })}\n`,
      );
      continue;
    }
    const response = await handleMessage(parsed);
    if (response !== undefined) process.stdout.write(`${JSON.stringify(response)}\n`);
  }
}

