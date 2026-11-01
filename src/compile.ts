/**
 * The orchestrator: gate → analyze → render → check.
 *
 * `compile` is the only async entry point, and it is async only because the API
 * engine is optional. With no key configured it resolves synchronously in
 * practice: no network, no model, no surprise.
 *
 * @module prompt-funnel/compile
 */

import type { CompileOptions, CompileResult, PromptSpec, StyleName } from './types.js';
import { analyzeWithRules } from './analyze.js';
import { loadConfig, resolveApiKey, resolveEngine } from './config.js';
import type { FunnelConfig } from './config.js';
import { gate } from './gate.js';
import { requestSpec } from './llm.js';
import { renderSpec } from './render.js';
import { applyTemplate, getTemplate } from './templates.js';
import { checkFidelity, coerceSpec } from './validate.js';

/** Injectable seams, used by tests and by hosts that supply their own model. */
export interface CompileDeps {
  config?: FunnelConfig;
  request?: typeof requestSpec;
}

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Compile a raw request into a spec and a rendered prompt.
 *
 * A `pass` verdict from the gate short-circuits everything: the returned text is
 * byte-for-byte the user's input. That is the behaviour that makes this usable on
 * every message instead of a modal the user learns to skip.
 */
export async function compile(raw: string, options: CompileOptions = {}, deps: CompileDeps = {}): Promise<CompileResult> {
  const source = raw.trim();
  if (source.length === 0) throw new Error('输入为空');

  const config = deps.config ?? loadConfig();
  const style: StyleName = options.style ?? config.style;
  const verdict = gate(source);
  const notes: string[] = [];

  const base = analyzeWithRules(source, verdict, options);
  base.meta.style = style;

  if (options.force !== true && options.template === undefined && verdict.decision === 'pass') {
    const fidelity = checkFidelity(base, source);
    return {
      spec: base,
      rendered: { text: `${source}\n`, fidelity, keptOriginal: false },
      passedThrough: true,
      notes: ['闸门判定：已足够清晰，原样放行（加 --force 可强制收束）'],
    };
  }

  const engine = resolveEngine(options.engine, config);
  let spec: PromptSpec = base;

  if (engine === 'api') {
    const apiKey = resolveApiKey(config);
    if (apiKey === undefined) {
      notes.push('没有找到 API key，已回退到规则引擎');
      spec.meta.engine = 'rules';
    } else {
      try {
        const payload = await (deps.request ?? requestSpec)({ ...config.api, apiKey }, source, base, options.note);
        spec = coerceSpec(payload, base);
        spec.meta.engine = 'api';
        notes.push(`API 引擎：${config.api.model}`);
      } catch (error) {
        notes.push(`API 引擎失败（${errorMessage(error)}），已回退规则引擎`);
        spec.meta.engine = 'rules';
      }
    }
  } else if (engine === 'host') {
    // The host model does the analysis; `compile` only supplies the baseline.
    spec.meta.engine = 'host';
    notes.push('host 引擎：分析由宿主模型完成，结果需回传给 funnel_render');
  } else {
    spec.meta.engine = 'rules';
  }

  if (options.note !== undefined) spec.meta.note = options.note;
  spec.meta.style = style;

  // Template defaults are applied last so an API engine cannot drop them: they
  // are the "what done looks like" half that a vague request never supplies.
  const template = getTemplate(options.template);
  if (template.id !== 'default') spec = applyTemplate(spec, template);

  const rendered = renderSpec(spec, {
    style,
    ...(options.keepOriginal !== undefined ? { keepOriginal: options.keepOriginal } : {}),
  });

  return { spec, rendered, passedThrough: false, notes };
}

/** Rule-only analysis, for callers that want the spec without rendering. */
export function analyze(raw: string, options: CompileOptions = {}): PromptSpec {
  const source = raw.trim();
  if (source.length === 0) throw new Error('输入为空');
  let spec = analyzeWithRules(source, gate(source), options);
  if (options.style !== undefined) spec.meta.style = options.style;
  const template = getTemplate(options.template);
  if (template.id !== 'default') spec = applyTemplate(spec, template);
  return spec;
}
