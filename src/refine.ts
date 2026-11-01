/**
 * Section-scoped refinement.
 *
 * The review loop is fine for a first pass, but the thing people actually say
 * next is "make point 2 shorter" or "把并发改成 8". Re-analysing the whole
 * request for that would reshuffle everything and lose the parts already agreed
 * on. So a refinement is a patch against the existing spec: it touches exactly
 * one section, and the rest stays byte-identical.
 *
 * The parser is deliberately literal — it understands a small set of explicit
 * forms and says so when it does not understand, instead of guessing at intent.
 *
 * @module prompt-funnel/refine
 */

import type { Item, PromptSpec, Requirement } from './types.js';

/** Sections a patch can target. */
export type Section = 'objective' | 'requirements' | 'constraints' | 'nonGoals' | 'acceptance' | 'deliverable';

/** One change to apply to a spec. */
export interface Patch {
  section: Section;
  op: 'append' | 'replace' | 'remove';
  /** Zero-based within the section. */
  index?: number;
  text?: string;
}

/** Outcome of applying patches. */
export interface RefineResult {
  spec: PromptSpec;
  /** Human-readable list of what changed, for the CLI to print. */
  applied: string[];
}

const NUM = String.raw`(\d{1,3})`;
const SPOKEN = String.raw`第\s*` + NUM + String.raw`\s*[点条项]`;

/**
 * Turn one free-text note into patches.
 *
 * Supported forms (the CLI prints them when nothing matches):
 *   第 2 点改成先做爬虫          第 2 条删掉
 *   再加一条：支持断点续传        目标改成……
 *   验收加一条：能通过 pnpm test  不要做：改导出接口
 *   限制在 500 字以内             requirement 2: keep the public API stable
 */
export function parseRefineNote(note: string): Patch[] {
  const text = note.trim();
  if (text.length === 0) return [];
  const patches: Patch[] = [];

  // remove a numbered item
  const removed = new RegExp(`${SPOKEN}\\s*(?:删掉|删除|去掉|移除)|删除${SPOKEN}`, 'u').exec(text);
  if (removed !== null) {
    const spoken = Number(removed[1] ?? removed[2]);
    if (Number.isFinite(spoken)) patches.push({ section: 'requirements', op: 'remove', index: spoken - 1 });
    return patches;
  }

  // replace a numbered item
  const replaced = new RegExp(`${SPOKEN}\\s*(?:改成|改为|换成|重写成?|是|:)\\s*(.+)`, 'u').exec(text);
  if (replaced !== null) {
    patches.push({
      section: 'requirements',
      op: 'replace',
      index: Number(replaced[1]) - 1,
      text: stripTail(replaced[2] ?? ''),
    });
    return patches;
  }

  const englishReplace = /^requirement\s+(\d{1,3})\s*[:：]\s*(.+)$/iu.exec(text);
  if (englishReplace !== null) {
    patches.push({
      section: 'requirements',
      op: 'replace',
      index: Number(englishReplace[1]) - 1,
      text: stripTail(englishReplace[2] ?? ''),
    });
    return patches;
  }

  const objective = /^(?:目标|objective)\s*(?:改成|改为|换成|是|:)\s*(.+)|\bobjective\s*[:：]\s*(.+)$/iu.exec(text);
  if (objective !== null) {
    patches.push({ section: 'objective', op: 'replace', text: stripTail(objective[1] ?? objective[2] ?? '') });
    return patches;
  }

  const length = /(\d+)\s*(?:字|词|words?|chars?)(?:以内|以下|左右|inner)?/iu.exec(text);
  if (length !== null && /(?:字|词|words?|chars?)/iu.test(text)) {
    patches.push({ section: 'deliverable', op: 'replace', text: `${length[1]} 字以内` });
    return patches;
  }

  const acceptance = /^(?:验收|完成标准|done when)\s*(?:加一条|加|改成|是|:)?\s*(.+)$/iu.exec(text);
  if (acceptance !== null) {
    patches.push({ section: 'acceptance', op: 'append', text: stripTail(acceptance[1] ?? '') });
    return patches;
  }

  const nonGoal = /^(?:不要|别|不需要|无需)\s*(?:再)?\s*(.+)$/u.exec(text);
  if (nonGoal !== null) {
    patches.push({ section: 'nonGoals', op: 'append', text: `不要${stripTail(nonGoal[1] ?? '')}` });
    return patches;
  }

  const constraint = /^(?:约束|限制|constraint)\s*(?:加一条|加|是|:)?\s*(.+)$/iu.exec(text);
  if (constraint !== null) {
    patches.push({ section: 'constraints', op: 'append', text: stripTail(constraint[1] ?? '') });
    return patches;
  }

  const appended = /^(?:再加|补充|增加|追加|add)\s*(?:一条|一个)?\s*[:：]?\s*(.+)$/iu.exec(text);
  if (appended !== null) {
    patches.push({ section: 'requirements', op: 'append', text: stripTail(appended[1] ?? '') });
    return patches;
  }

  return patches;
}

function stripTail(value: string): string {
  return value.trim().replace(/^[:：，,\s]+/u, '').replace(/[。.；;]+$/u, '').trim();
}

function renumber(requirements: Requirement[]): Requirement[] {
  return requirements.map((requirement, index) => ({ ...requirement, id: `R${index + 1}` }));
}

const SECTION_LABEL: Record<Section, string> = {
  objective: '目标',
  requirements: '要求',
  constraints: '约束',
  nonGoals: '非目标',
  acceptance: '完成标准',
  deliverable: '交付',
};

/**
 * Apply patches, returning a new spec. The input is not mutated.
 *
 * Refined text is marked `user`: it is the user's own words from the note, not
 * something the compiler inferred, and it should not be rendered as an assumption.
 */
export function applyPatches(spec: PromptSpec, patches: Patch[]): RefineResult {
  const next: PromptSpec = {
    ...spec,
    requirements: [...spec.requirements],
    constraints: [...spec.constraints],
    nonGoals: [...spec.nonGoals],
    acceptance: [...spec.acceptance],
    deliverable: { ...spec.deliverable },
    meta: { ...spec.meta },
  };
  const applied: string[] = [];
  const userItem = (text: string): Item => ({ text: text.trim(), source: 'user' });

  for (const patch of patches) {
    if (patch.text !== undefined && patch.text.trim().length === 0 && patch.op !== 'remove') continue;
    const text = patch.text?.trim() ?? '';

    if (patch.section === 'objective') {
      next.objective = userItem(text);
      applied.push(`目标 → ${text}`);
      continue;
    }

    if (patch.section === 'deliverable') {
      next.deliverable.length = userItem(text);
      applied.push(`篇幅 → ${text}`);
      continue;
    }

    if (patch.section === 'requirements') {
      const index = patch.index ?? -1;
      if (patch.op === 'append') {
        next.requirements = renumber([...next.requirements, { id: 'R?', text, source: 'user' }]);
        applied.push(`新增要求 ${next.requirements.length}：${text}`);
        continue;
      }
      if (index < 0 || index >= next.requirements.length) {
        applied.push(`第 ${index + 1} 条不存在，已跳过（当前共 ${next.requirements.length} 条）`);
        continue;
      }
      if (patch.op === 'remove') {
        const [removed] = next.requirements.splice(index, 1);
        next.requirements = renumber(next.requirements);
        applied.push(`删除要求 ${index + 1}：${removed?.text ?? ''}`.trimEnd());
        continue;
      }
      next.requirements[index] = { id: next.requirements[index]?.id ?? `R${index + 1}`, text, source: 'user' };
      applied.push(`要求 ${index + 1} → ${text}`);
      continue;
    }

    const list =
      patch.section === 'constraints'
        ? next.constraints
        : patch.section === 'nonGoals'
          ? next.nonGoals
          : next.acceptance;

    if (patch.op === 'append') {
      list.push(userItem(text));
      applied.push(`新增${SECTION_LABEL[patch.section]}：${text}`);
      continue;
    }

    const index = patch.index ?? -1;
    if (index < 0 || index >= list.length) {
      applied.push(`${SECTION_LABEL[patch.section]} 第 ${index + 1} 条不存在，已跳过`);
      continue;
    }
    if (patch.op === 'remove') {
      const [removed] = list.splice(index, 1);
      applied.push(`删除${SECTION_LABEL[patch.section]}：${removed?.text ?? ''}`.trimEnd());
      continue;
    }
    list[index] = userItem(text);
    applied.push(`${SECTION_LABEL[patch.section]} ${index + 1} → ${text}`);
  }

  // The note is user input too; keeping it lets the fidelity check accept the
  // literals the user just typed instead of flagging their own edit as invented.
  const notes = [spec.meta.note, ...patches.map((patch) => patch.text ?? '')].filter(
    (entry): entry is string => typeof entry === 'string' && entry.length > 0,
  );
  next.meta.note = notes.join('；').slice(0, 2000);
  return { spec: next, applied };
}

/** The forms {@link parseRefineNote} understands, for user-facing errors. */
export const REFINE_FORMS = [
  '第 2 点改成 <新内容>',
  '第 2 条删掉',
  '再加一条：<新要求>',
  '目标改成 <新目标>',
  '验收加一条：<标准>',
  '不要做：<非目标>',
  '限制在 500 字以内',
  'requirement 2: <new text>',
];
