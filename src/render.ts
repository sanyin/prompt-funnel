/**
 * Rendering a spec into the text that actually reaches the model.
 *
 * The default `bluf` style is the 总-分-总 shape, but for a reason rather than a
 * fashion: models use the beginning and the end of a context best, so the ask
 * goes first (bottom line up front) and the acceptance criteria go last (recency
 * on the checkable part). The middle is a flat numbered list, because numbered,
 * individually checkable items are followed more reliably than a paragraph.
 *
 * @module prompt-funnel/render
 */

import type { FidelityReport, Item, PromptSpec, RenderResult, StyleName } from './types.js';
import { renderLanguage } from './analyze.js';
import { checkFidelity } from './validate.js';

type Lang = 'zh' | 'en';

interface Labels {
  objective: string;
  context: string;
  requirements: string;
  constraints: string;
  nonGoals: string;
  deliverable: string;
  format: string;
  length: string;
  audience: string;
  acceptance: string;
  questions: string;
  original: string;
  assumed: string;
  defaults: string;
}

const LABELS: Record<Lang, Labels> = {
  zh: {
    objective: '目标',
    context: '背景',
    requirements: '要求',
    constraints: '约束',
    nonGoals: '不要做',
    deliverable: '交付',
    format: '形式',
    length: '篇幅',
    audience: '受众',
    acceptance: '完成标准',
    questions: '待确认',
    original: '原文（与上文冲突时以此为准）',
    assumed: '假定',
    defaults: '以下条目未确认，按默认假设处理',
  },
  en: {
    objective: 'Objective',
    context: 'Context',
    requirements: 'Requirements',
    constraints: 'Constraints',
    nonGoals: 'Out of scope',
    deliverable: 'Deliverable',
    format: 'Format',
    length: 'Length',
    audience: 'Audience',
    acceptance: 'Done when',
    questions: 'Open questions',
    original: 'Original request (authoritative if it conflicts)',
    assumed: 'assumed',
    defaults: 'Unconfirmed items are handled with these defaults',
  },
};

/** Append a provenance marker to anything the user did not literally write. */
function itemText(item: Item, labels: Labels): string {
  if (item.source === 'user') return item.text;
  return `${item.text}（${labels.assumed}）`;
}

/** Render one item as a markdown line, keeping multi-line content intact. */
function line(item: Item, labels: Labels, prefix = ''): string {
  const text = itemText(item, labels).replace(/\n/gu, '\n  ');
  return `${prefix}${text}`;
}

function section(heading: string, body: string[]): string[] {
  if (body.length === 0) return [];
  return [`## ${heading}`, '', ...body, ''];
}

/** `bluf`: the fully structured 总-分-总 rendering. */
function renderBluf(spec: PromptSpec, labels: Labels): string[] {
  const out: string[] = [];

  out.push(`## ${labels.objective}`, '', itemText(spec.objective, labels), '');

  out.push(
    ...section(
      labels.context,
      spec.context.map((item) => `- ${line(item, labels)}`),
    ),
  );

  if (spec.requirements.length > 0) {
    out.push(`## ${labels.requirements}`, '');
    spec.requirements.forEach((requirement, index) => {
      out.push(`${index + 1}. ${line(requirement, labels)}`);
    });
    out.push('');
  }

  out.push(
    ...section(
      labels.constraints,
      spec.constraints.map((item) => `- ${line(item, labels)}`),
    ),
    ...section(
      labels.nonGoals,
      spec.nonGoals.map((item) => `- ${line(item, labels)}`),
    ),
  );

  const deliverable: string[] = [];
  if (spec.deliverable.format !== undefined) {
    deliverable.push(`- ${labels.format}：${itemText(spec.deliverable.format, labels)}`);
  }
  if (spec.deliverable.length !== undefined) {
    deliverable.push(`- ${labels.length}：${itemText(spec.deliverable.length, labels)}`);
  }
  if (spec.deliverable.audience !== undefined) {
    deliverable.push(`- ${labels.audience}：${itemText(spec.deliverable.audience, labels)}`);
  }
  out.push(...section(labels.deliverable, deliverable));

  out.push(
    ...section(
      labels.acceptance,
      spec.acceptance.map((item) => `- [ ] ${line(item, labels)}`),
    ),
  );

  if (spec.openQuestions.length > 0 || spec.assumptions.length > 0) {
    const block: string[] = [];
    if (spec.openQuestions.length > 0) {
      block.push(`_${labels.defaults}：_`, '');
      spec.openQuestions.forEach((question, index) => block.push(`${index + 1}. ${question}`));
      block.push('');
    }
    if (spec.assumptions.length > 0) {
      block.push(`**${labels.assumed}**`, '');
      for (const assumption of spec.assumptions) {
        block.push(`- ${assumption.text} —— 若不符：${assumption.impact}`);
      }
    }
    out.push(...section(labels.questions, block));
  }

  return out;
}

/** `compact`: for short requests where headers would outweigh the content. */
function renderCompact(spec: PromptSpec, labels: Labels): string[] {
  const out: string[] = [];
  out.push(`**${labels.objective}**：${itemText(spec.objective, labels)}`);

  if (spec.requirements.length > 0) {
    const numbered = spec.requirements.map((requirement, index) => `${index + 1}) ${line(requirement, labels)}`);
    out.push(`**${labels.requirements}**：${numbered.join('；')}`);
  }
  if (spec.constraints.length > 0) {
    out.push(`**${labels.constraints}**：${spec.constraints.map((item) => line(item, labels)).join('；')}`);
  }
  if (spec.nonGoals.length > 0) {
    out.push(`**${labels.nonGoals}**：${spec.nonGoals.map((item) => line(item, labels)).join('；')}`);
  }
  if (spec.deliverable.format !== undefined) {
    out.push(`**${labels.deliverable}**：${itemText(spec.deliverable.format, labels)}`);
  }
  if (spec.acceptance.length > 0) {
    out.push(`**${labels.acceptance}**：${spec.acceptance.map((item) => line(item, labels)).join('；')}`);
  }
  if (spec.openQuestions.length > 0) {
    out.push(`**${labels.questions}**：${spec.openQuestions.join('；')}`);
  }
  return out;
}

/** `checklist`: everything as checkboxes, for agent handoff. */
function renderChecklist(spec: PromptSpec, labels: Labels): string[] {
  const out: string[] = [];
  out.push(`- [ ] ${labels.objective}：${itemText(spec.objective, labels)}`);
  for (const requirement of spec.requirements) out.push(`- [ ] ${line(requirement, labels)}`);
  for (const item of spec.constraints) out.push(`- [ ] ${labels.constraints}：${line(item, labels)}`);
  for (const item of spec.nonGoals) out.push(`- [ ] ${labels.nonGoals}：${line(item, labels)}`);
  if (spec.deliverable.format !== undefined) {
    out.push(`- [ ] ${labels.deliverable}：${itemText(spec.deliverable.format, labels)}`);
  }
  for (const item of spec.acceptance) out.push(`- [ ] ${labels.acceptance}：${line(item, labels)}`);
  if (spec.openQuestions.length > 0) {
    out.push(`- [ ] ${labels.questions}：${spec.openQuestions.join('；')}`);
  }
  return out;
}

/** Decide whether to re-attach the source text. */
export function shouldKeepOriginal(spec: PromptSpec, mode: 'auto' | 'on' | 'off'): boolean {
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  return spec.anchors.length > 0 || spec.assumptions.length > 0 || spec.openQuestions.length > 0;
}

/** Render a spec to prompt text and check it against its own source. */
export function renderSpec(
  spec: PromptSpec,
  options: { style?: StyleName; keepOriginal?: 'auto' | 'on' | 'off' } = {},
): RenderResult {
  const style = options.style ?? spec.meta.style ?? 'bluf';
  const lang = renderLanguage(spec.meta.source);
  const labels = LABELS[lang];

  const body =
    style === 'compact'
      ? renderCompact(spec, labels)
      : style === 'checklist'
        ? renderChecklist(spec, labels)
        : renderBluf(spec, labels);

  const keptOriginal = shouldKeepOriginal(spec, options.keepOriginal ?? 'auto');
  const parts = body.filter((entry, index, array) => !(entry === '' && array[index - 1] === ''));
  const text = parts.join('\n').trimEnd();

  const withOriginal = keptOriginal
    ? `${text}\n\n---\n\n## ${labels.original}\n\n${spec.meta.source.trim()}\n`
    : `${text}\n`;

  // Fidelity is measured on the compiled body only: re-attaching the original
  // quote would make every invented literal look "found" in the source.
  const fidelity: FidelityReport = checkFidelity(spec, text);
  return { text: withOriginal, fidelity, keptOriginal };
}
