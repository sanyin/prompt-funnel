/**
 * prompt-funnel — a convergence gate for AI agents.
 *
 * A vague request costs one round trip at best and an invented requirement at
 * worst. This package compiles a request into a structured, auditable spec before
 * it reaches the model, and refuses to invent anything the user did not say.
 *
 * @example
 * ```ts
 * import { compile } from 'prompt-funnel';
 * const { rendered, passedThrough } = await compile('帮我优化一下这个东西');
 * if (!passedThrough) console.log(rendered.text);
 * ```
 *
 * @module prompt-funnel
 */

export { compile, analyze } from './compile.js';
export type { CompileDeps } from './compile.js';
export { gate, COMPILE_THRESHOLD } from './gate.js';
export { analyzeWithRules } from './analyze.js';
export { renderSpec, shouldKeepOriginal } from './render.js';
export { applyPatches, parseRefineNote, REFINE_FORMS } from './refine.js';
export type { Patch, RefineResult, Section } from './refine.js';
export { applyTemplate, getTemplate, TEMPLATES, templateIds } from './templates.js';
export type { Template } from './templates.js';
export { composeContinuation, summarize } from './session.js';
export type { Continuation } from './session.js';
export { checkFidelity, coerceSpec, validateSpec, MAX_REQUIREMENTS, MIN_RETENTION } from './validate.js';
export { diffLines, formatDiff } from './diff.js';
export type { DiffLine } from './diff.js';
export { loadConfig, saveConfig, configPath, funnelHome, resolveApiKey, resolveEngine } from './config.js';
export type { FunnelConfig } from './config.js';
export { loadSpec, saveSpec, specPath, storeDir, textPath, loadText } from './store.js';
export { estimateTokens, extractHardTokens, hasCJK, retention, splitSentences } from './text.js';
export type {
  Assumption,
  CompileOptions,
  CompileResult,
  Deliverable,
  EngineName,
  FidelityReport,
  GateAxes,
  GateResult,
  HardToken,
  IntentClass,
  Issue,
  Item,
  PromptSpec,
  Provenance,
  RenderResult,
  Requirement,
  SpecMeta,
  StyleName,
} from './types.js';
