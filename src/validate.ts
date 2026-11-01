/**
 * Validation.
 *
 * Two separate jobs:
 *  1. **Fidelity** — did the compiled text contain anything the source did not?
 *     This is deterministic on purpose. A model asked "did you invent anything?"
 *     says no; a literal check against the source cannot.
 *  2. **Shape** — is this object a usable PromptSpec? Hosts and the API engine
 *     return JSON from outside, so everything crossing that boundary is coerced
 *     and checked before it is rendered.
 *
 * @module prompt-funnel/validate
 */

import type {
  Assumption,
  Deliverable,
  FidelityReport,
  Issue,
  Item,
  PromptSpec,
  Provenance,
  Requirement,
} from './types.js';
import { injectionMarkers } from './signals.js';
import { extractHardTokens, retention } from './text.js';

/** Max requirements before a prompt starts losing constraint adherence. */
export const MAX_REQUIREMENTS = 12;

/** Below this retention the compiler probably dropped meaning. */
export const MIN_RETENTION = 0.55;

function issue(kind: Issue['kind'], detail: string, severity: Issue['severity']): Issue {
  return { kind, detail, severity };
}

/**
 * Compare a rendered body against its own source.
 *
 * @param spec - the spec being rendered.
 * @param body - the compiled text only, without the re-attached original quote.
 */
export function checkFidelity(spec: PromptSpec, body: string): FidelityReport {
  const source = spec.meta.source;
  const sourceLower = source.toLowerCase();
  const issues: Issue[] = [];

  const unverifiable: string[] = [];
  for (const token of extractHardTokens(body)) {
    if (sourceLower.includes(token.value.toLowerCase())) continue;
    unverifiable.push(token.value);
    if (token.kind === 'number' || token.kind === 'url' || token.kind === 'path') {
      issues.push(issue('unverifiable-token', `输出里的「${token.value}」在原文中找不到`, 'error'));
    }
  }

  const kept = retention(source, body);
  if (kept < MIN_RETENTION) {
    issues.push(
      issue('low-retention', `原文字词保留率 ${(kept * 100).toFixed(0)}%，低于 ${MIN_RETENTION * 100}%，可能删掉了关键信息`, 'warn'),
    );
  }
  if (spec.requirements.length > MAX_REQUIREMENTS) {
    issues.push(
      issue('too-many-requirements', `共 ${spec.requirements.length} 条要求，超过 ${MAX_REQUIREMENTS} 条后遵循率明显下降，建议拆成多轮`, 'warn'),
    );
  }
  if (spec.objective.text.trim().length === 0) {
    issues.push(issue('empty-objective', '目标为空', 'error'));
  }
  if (spec.acceptance.length === 0) {
    issues.push(issue('no-acceptance', '没有任何完成标准，模型无法自检', 'warn'));
  }
  if (injectionMarkers(source) > 0) {
    issues.push(
      issue('injection-suspected', '原文含“忽略以上指令”类字样；它被当作待处理内容保留，而不是指令', 'warn'),
    );
  }

  return {
    retention: Number(kept.toFixed(3)),
    unverifiable: [...new Set(unverifiable)],
    issues,
    ok: issues.every((entry) => entry.severity !== 'error'),
  };
}

/** Shape and check a spec that may have arrived from a model or a host. */
export function validateSpec(spec: PromptSpec): Issue[] {
  const issues: Issue[] = [];
  if (spec.version !== '1') issues.push(issue('empty-objective', `未知的 spec 版本：${String(spec.version)}`, 'warn'));
  if (spec.objective.text.trim().length === 0) issues.push(issue('empty-objective', '目标为空', 'error'));
  if (spec.requirements.length > MAX_REQUIREMENTS) {
    issues.push(issue('too-many-requirements', `共 ${spec.requirements.length} 条要求，建议拆分`, 'warn'));
  }
  if (spec.acceptance.length === 0) issues.push(issue('no-acceptance', '缺少完成标准', 'warn'));
  const ids = new Set<string>();
  for (const requirement of spec.requirements) {
    if (ids.has(requirement.id)) issues.push(issue('empty-objective', `要求 id 重复：${requirement.id}`, 'warn'));
    ids.add(requirement.id);
    if (requirement.text.trim().length === 0) {
      issues.push(issue('empty-objective', `要求 ${requirement.id} 为空`, 'error'));
    }
  }
  if (spec.openQuestions.length > 5) {
    issues.push(issue('no-question-mark', `待确认问题 ${spec.openQuestions.length} 个，超过 5 个用户会失去耐心`, 'warn'));
  }
  return issues;
}

const PROVENANCE: readonly Provenance[] = ['user', 'inferred', 'assumption'];

function asProvenance(value: unknown): Provenance {
  return typeof value === 'string' && (PROVENANCE as readonly string[]).includes(value)
    ? (value as Provenance)
    : 'inferred';
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function asItem(value: unknown, fallbackSource: Provenance = 'inferred'): Item | undefined {
  if (typeof value === 'string') {
    const text = value.trim();
    return text.length === 0 ? undefined : { text, source: fallbackSource };
  }
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const text = asText(record['text']);
  if (text.length === 0) return undefined;
  return { text, source: asProvenance(record['source'] ?? fallbackSource) };
}

function asItems(value: unknown): Item[] {
  return Array.isArray(value)
    ? value.map((entry) => asItem(entry)).filter((entry): entry is Item => entry !== undefined)
    : [];
}

function asRequirements(value: unknown): Requirement[] {
  const items = asItems(value);
  return items.map((item, index) => ({ id: `R${index + 1}`, text: item.text, source: item.source }));
}

function asAssumptions(value: unknown): Assumption[] {
  if (!Array.isArray(value)) return [];
  const out: Assumption[] = [];
  for (const entry of value) {
    if (typeof entry === 'string') {
      const text = entry.trim();
      if (text.length > 0) out.push({ text, impact: '未说明' });
      continue;
    }
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const text = asText(record['text']);
    if (text.length === 0) continue;
    out.push({ text, impact: asText(record['impact']) || '未说明' });
  }
  return out;
}

function asDeliverable(value: unknown): Deliverable {
  if (typeof value !== 'object' || value === null) return {};
  const record = value as Record<string, unknown>;
  const deliverable: Deliverable = {};
  const format = asItem(record['format']);
  const length = asItem(record['length']);
  const audience = asItem(record['audience']);
  if (format !== undefined) deliverable.format = format;
  if (length !== undefined) deliverable.length = length;
  if (audience !== undefined) deliverable.audience = audience;
  return deliverable;
}

/**
 * Coerce arbitrary JSON into a spec, keeping `base` for anything missing.
 *
 * Used for both the API engine and host-supplied specs. Nothing is invented here:
 * a missing field falls back to the rule-based analysis that was already derived
 * from the user's own words.
 */
export function coerceSpec(value: unknown, base: PromptSpec): PromptSpec {
  if (typeof value !== 'object' || value === null) return base;
  const record = value as Record<string, unknown>;

  const objective = asItem(record['objective'], 'user') ?? base.objective;
  const requirements = asRequirements(record['requirements']);
  const context = asItems(record['context']);
  const constraints = asItems(record['constraints']);
  const nonGoals = asItems(record['nonGoals'] ?? record['non_goals']);
  const acceptance = asItems(record['acceptance']);
  const deliverable = asDeliverable(record['deliverable']);
  const assumptions = asAssumptions(record['assumptions']);
  const openQuestions = Array.isArray(record['openQuestions'] ?? record['open_questions'])
    ? ((record['openQuestions'] ?? record['open_questions']) as unknown[])
        .map((entry) => asText(entry))
        .filter((entry) => entry.length > 0)
    : [];

  const intent =
    typeof record['intent'] === 'string' && ['execute', 'answer', 'debug', 'write', 'plan', 'unknown'].includes(record['intent'])
      ? (record['intent'] as PromptSpec['intent'])
      : base.intent;

  return {
    version: '1',
    intent,
    objective,
    context: context.length > 0 ? context : base.context,
    requirements: requirements.length > 0 ? requirements : base.requirements,
    constraints: constraints.length > 0 ? constraints : base.constraints,
    nonGoals: nonGoals.length > 0 ? nonGoals : base.nonGoals,
    deliverable: Object.keys(deliverable).length > 0 ? deliverable : base.deliverable,
    acceptance: acceptance.length > 0 ? acceptance : base.acceptance,
    assumptions: assumptions.length > 0 ? assumptions : base.assumptions,
    openQuestions: openQuestions.length > 0 ? openQuestions : base.openQuestions,
    anchors: base.anchors,
    meta: base.meta,
  };
}
