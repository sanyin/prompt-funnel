/**
 * Rule-based analyzer.
 *
 * Important design decision: this engine is **extractive**. It reorders,
 * groups, numbers, and flags what the user already wrote — it never paraphrases.
 * Paraphrase is exactly where a rewrite invents requirements, so it is reserved
 * for the API engine, where the output can be checked against the source.
 *
 * @module prompt-funnel/analyze
 */

import type {
  Assumption,
  CompileOptions,
  Deliverable,
  GateResult,
  IntentClass,
  Item,
  PromptSpec,
  Requirement,
  StyleName,
} from './types.js';
import { gate } from './gate.js';
import {
  ACCEPTANCE_RE,
  ARTIFACT_RE,
  CONSTRAINT_RE,
  CONTEXT_RE,
  NON_GOAL_RE,
  detectIntent,
  hasTaskVerb,
} from './signals.js';
import { estimateTokens, hashText, hasCJK, splitInjection, splitSentences } from './text.js';

type Role = 'requirement' | 'constraint' | 'non-goal' | 'acceptance' | 'context';

interface Unit {
  text: string;
  role: Role;
  /** True when the unit was already a list item, i.e. the user numbered it. */
  fromList: boolean;
}

const LIST_MARKER = /^\s*(?:[-*+•]|\d+[.)、]|[①-⑳])\s+/u;

const stripMarker = (text: string): string => text.replace(LIST_MARKER, '').trim();

const dedupeKey = (text: string): string =>
  text.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '').slice(0, 200);

/**
 * Assign one role per unit. Order encodes precedence: a "don't do X" sentence is
 * a non-goal even if it also reads like a constraint.
 *
 * Known limitation: a sentence that both constrains and acts ("用 TypeScript
 * 重写这个模块") stays whole as a requirement. Splitting it would mean dropping
 * the verb or the constraint; keeping it whole costs a little precision in the
 * constraints section and loses nothing in meaning.
 */
function classify(text: string): Role {
  if (NON_GOAL_RE.test(text)) return 'non-goal';
  if (ACCEPTANCE_RE.test(text)) return 'acceptance';
  if (CONSTRAINT_RE.test(text) && !hasTaskVerb(text)) return 'constraint';
  if (hasTaskVerb(text)) return 'requirement';
  if (CONTEXT_RE.test(text)) return 'context';
  return estimateTokens(text) > 8 ? 'context' : 'requirement';
}

/** Comma that introduces a prohibition starts a new unit. */
const NEGATION_LEAD = /[，,]\s*(?=(?:不要|别|无需|不需要|禁止|不得|不考虑|不允许))/u;

/** Split a block into clauses, keeping units semantically whole. */
function segment(block: string): string[] {
  const bySemicolon = block.split(/[；;]/u);
  const byNegation = bySemicolon.flatMap((part) => part.split(NEGATION_LEAD));
  return byNegation.flatMap((part) =>
    hasJunction(part) ? part.split(/[，,]\s*(?:并且|同时|另外|还要|以及|然后)/u) : [part],
  );
}

/** Split one block into units, keeping list items whole. */
function splitUnits(block: string, fromList: boolean): Unit[] {
  const units: Unit[] = [];
  for (const part of segment(block)) {
    for (const sentence of splitSentences(part)) {
      const text = stripMarker(sentence);
      if (text.length === 0) continue;
      units.push({ text, role: classify(text), fromList });
    }
  }
  return units;
}

function hasJunction(text: string): boolean {
  return /[，,]\s*(?:并且|同时|另外|还要|以及|然后)/u.test(text);
}

/** Collect fenced code and quoted spans; both must survive verbatim. */
function collectAnchors(raw: string): { anchors: string[]; body: string } {
  const anchors: string[] = [];
  let body = '';
  let inFence = false;
  let fence: string[] = [];

  for (const line of raw.split(/\r?\n/u)) {
    if (line.trim().startsWith('```')) {
      if (inFence) {
        anchors.push(fence.join('\n').trim());
        fence = [];
        inFence = false;
      } else {
        inFence = true;
      }
      continue;
    }
    if (inFence) {
      fence.push(line);
      continue;
    }
    body += `${line}\n`;
  }
  if (fence.length > 0) anchors.push(fence.join('\n').trim());

  for (const match of raw.matchAll(/`([^`\n]{2,120})`/gu)) {
    anchors.push(match[1] ?? '');
  }
  return { anchors: anchors.filter((value) => value.length > 0), body };
}

/** Pull the narrowest clause containing an artifact noun. */
function findDeliverableSentence(units: Unit[]): string | undefined {
  for (const unit of units) {
    if (!ARTIFACT_RE.test(unit.text)) continue;
    const clauses = unit.text.split(/[，,]/u).map((clause) => clause.trim());
    return clauses.find((value) => ARTIFACT_RE.test(value)) ?? unit.text;
  }
  return undefined;
}

type Lang = 'zh' | 'en';

/**
 * Every string the analyzer generates itself, in both languages.
 *
 * These are the only words in a compiled prompt that the user did not write, so
 * they are also the only place a language mismatch can show up. Keeping them in
 * one table makes that impossible to forget when adding a new inference.
 */
const CONTENT = {
  zh: {
    emptyObjective: '（未提供具体内容）',
    listObjective: '完成下列要求',
    acceptanceFallback: '逐条对照上面的要求自检，并说明未满足的条目',
    deliverable: {
      answer: '直接回答，先给结论，再给依据',
      debug: '根因判断 + 修复方案 + 验证方式',
      write: '可直接使用的成稿文本',
      plan: '分步计划，每步含产出与验收',
      execute: '可运行的改动 + 简短的变更说明',
      unknown: '按最小可行形式交付，并说明你做了哪些假设',
    },
    gaps: {
      audience: {
        question: '这份内容主要给谁看？（决定深度、术语与语气）',
        assumption: '受众默认具备基础背景的通用读者',
        impact: '受众判断错，深度与措辞需要重写',
      },
      scope: {
        question: '这几件事是一次全做，还是先做第一件？',
        assumption: '按顺序全部完成，先交付第一件',
        impact: '范围超出单个回答的容量，后几项会变浅',
      },
      format: {
        question: '希望什么形态的交付物？',
        impact: '形态不对需要整体返工',
      },
      acceptance: {
        question: '怎样算做完？（能跑通的命令 / 通过测试 / 字数范围）',
        assumption: '按上文逐条自检，并说明哪些条目未满足',
        impact: '无法验收，返工概率上升',
      },
      stack: {
        question: '技术栈与运行环境是什么？',
        assumption: '沿用项目现有技术栈与版本',
        impact: '环境不符会导致代码不可用',
      },
    },
  },
  en: {
    emptyObjective: '(nothing concrete provided)',
    listObjective: 'Complete the requirements below',
    acceptanceFallback: 'Check each requirement above before answering, and name any you could not meet',
    deliverable: {
      answer: 'A direct answer: conclusion first, then the reasoning',
      debug: 'Root cause + fix + how to verify',
      write: 'A finished text the user can ship as-is',
      plan: 'A step-by-step plan, each step with an output and a check',
      execute: 'A working change plus a short note on what changed',
      unknown: 'The smallest useful form of the deliverable, with the assumptions stated',
    },
    gaps: {
      audience: {
        question: 'Who is this for? (sets depth, jargon and tone)',
        assumption: 'A general reader with basic background',
        impact: 'Wrong audience means the depth and wording must be rewritten',
      },
      scope: {
        question: 'Do all of these at once, or the first one only?',
        assumption: 'All of them, in order, delivering the first first',
        impact: 'Too much scope for one answer; later items get shallow',
      },
      format: {
        question: 'What form should the deliverable take?',
        impact: 'Wrong form means a full redo',
      },
      acceptance: {
        question: 'How will you know it is done? (a command that runs / tests that pass / a length)',
        assumption: 'Self-check against the requirements above and name anything unmet',
        impact: 'Nothing to verify against; rework becomes likely',
      },
      stack: {
        question: 'Which stack and runtime versions?',
        assumption: 'The project’s existing stack and versions',
        impact: 'Wrong environment means the code cannot run',
      },
    },
  },
} as const;

function defaultDeliverable(intent: IntentClass, lang: Lang): string {
  return CONTENT[lang].deliverable[intent];
}

function detectAudience(raw: string): string | undefined {
  const match =
    /(?:给|面向|供|写给)\s*([^，。；、\n]{2,20}?)\s*(?:看|读|用|使用)/u.exec(raw) ??
    /(?:受众|读者|用户|客户)是\s*([^，。；、\n]{2,20})/u.exec(raw);
  return match?.[1]?.trim();
}

function detectLength(raw: string): string | undefined {
  const match = /(\d+\s*(?:字|词|行|句话|words?|chars?|lines?)(?:以内|以下|左右|内)?)/iu.exec(raw);
  return match?.[1]?.trim();
}

/**
 * Choose the objective.
 *
 * A numbered list has no summary sentence, so borrowing item 1 would silently
 * demote it out of the requirements. In that case the objective is an explicitly
 * marked inference instead, and every item stays a requirement.
 */
function pickObjective(units: Unit[], intent: IntentClass, lang: Lang): { item: Item; unit?: Unit } {
  const content = CONTENT[lang];
  if (units.length === 0) return { item: { text: content.emptyObjective, source: 'inferred' } };

  if (intent === 'answer') {
    const question = units.find((unit) => /[?？]/u.test(unit.text)) ?? units[0];
    return question === undefined
      ? { item: { text: content.emptyObjective, source: 'inferred' } }
      : { item: { text: question.text, source: 'user' }, unit: question };
  }

  const standalone = units.find((unit) => unit.role === 'requirement' && !unit.fromList);
  if (standalone !== undefined) return { item: { text: standalone.text, source: 'user' }, unit: standalone };

  const anyRequirement = units.find((unit) => unit.role === 'requirement');
  if (anyRequirement === undefined) {
    return { item: { text: units[0]?.text ?? content.emptyObjective, source: 'user' }, unit: units[0] };
  }
  return { item: { text: content.listObjective, source: 'inferred' } };
}

interface Gap {
  id: string;
  rank: number;
  question: string;
  assumption: Assumption;
}

function collectGaps(
  intent: IntentClass,
  deliverable: Deliverable,
  acceptance: Item[],
  goals: number,
  raw: string,
  lang: Lang,
): Gap[] {
  const content = CONTENT[lang];
  const gaps: Gap[] = [];
  const isWriting = intent === 'write' || intent === 'plan';

  if (isWriting && deliverable.audience === undefined) {
    gaps.push({
      id: 'audience',
      rank: 1,
      question: content.gaps.audience.question,
      assumption: { text: content.gaps.audience.assumption, impact: content.gaps.audience.impact },
    });
  }
  if (goals >= 2) {
    gaps.push({
      id: 'scope',
      rank: 1,
      question: content.gaps.scope.question,
      assumption: { text: content.gaps.scope.assumption, impact: content.gaps.scope.impact },
    });
  }
  if (deliverable.format === undefined) {
    gaps.push({
      id: 'format',
      rank: 2,
      question: content.gaps.format.question,
      assumption: { text: defaultDeliverable(intent, lang), impact: content.gaps.format.impact },
    });
  }
  if (acceptance.length === 0) {
    gaps.push({
      id: 'acceptance',
      rank: 2,
      question: content.gaps.acceptance.question,
      assumption: { text: content.gaps.acceptance.assumption, impact: content.gaps.acceptance.impact },
    });
  }
  if (
    (intent === 'execute' || intent === 'debug') &&
    !/(?:node|python|typescript|javascript|react|vue|go|rust|java|windows|linux|macos|版本|环境|依赖)/iu.test(raw)
  ) {
    gaps.push({
      id: 'stack',
      rank: 3,
      question: content.gaps.stack.question,
      assumption: { text: content.gaps.stack.assumption, impact: content.gaps.stack.impact },
    });
  }
  return gaps;
}

/** Build a spec from raw text using only deterministic rules. */
export function analyzeWithRules(raw: string, gateResult?: GateResult, options: CompileOptions = {}): PromptSpec {
  const result = gateResult ?? gate(raw);
  const intent = result.signals.intent === 'unknown' ? detectIntent(raw) : result.signals.intent;

  // Text that tries to address the rewriter is kept in the source and in the
  // anchors, but never promoted into an instruction slot.
  const { clean, suspicious } = splitInjection(raw);
  const analyzed = suspicious === undefined ? raw : clean;
  const lang: Lang = hasCJK(analyzed) ? 'zh' : 'en';
  const { anchors, body } = collectAnchors(analyzed);

  const blocks = body.split(/\n\s*\n/u);
  const units: Unit[] = [];
  const seen = new Set<string>();
  for (const block of blocks) {
    const fromList = LIST_MARKER.test(block.trimStart());
    for (const unit of splitUnits(block, fromList)) {
      const key = dedupeKey(unit.text);
      if (key.length === 0 || seen.has(key)) continue;
      seen.add(key);
      units.push(unit);
    }
  }

  const objective = pickObjective(units, intent, lang);
  const requirementUnits = units.filter((unit) => unit.role === 'requirement' && unit !== objective.unit);
  const requirements: Requirement[] = requirementUnits.map((unit, index) => ({
    id: `R${index + 1}`,
    text: unit.text,
    source: 'user',
  }));

  const constraints = toItems(units.filter((unit) => unit.role === 'constraint'));
  const nonGoals = toItems(units.filter((unit) => unit.role === 'non-goal'));
  const acceptance = toItems(units.filter((unit) => unit.role === 'acceptance'));
  const context = toItems(units.filter((unit) => unit.role === 'context')).slice(0, 8);

  const formatSentence = findDeliverableSentence(units);
  const deliverable: Deliverable = {};
  if (formatSentence !== undefined) deliverable.format = { text: formatSentence, source: 'user' };
  const length = detectLength(raw);
  if (length !== undefined) deliverable.length = { text: length, source: 'user' };
  const audience = detectAudience(raw);
  if (audience !== undefined) deliverable.audience = { text: audience, source: 'user' };

  const gaps = collectGaps(intent, deliverable, acceptance, result.signals.goals, raw, lang);
  const openQuestions = gaps
    .filter((gap) => gap.rank <= 2)
    .slice(0, 3)
    .map((gap) => gap.question);
  const assumptions = gaps.map((gap) => gap.assumption);

  if (deliverable.format === undefined) {
    deliverable.format = { text: defaultDeliverable(intent, lang), source: 'inferred' };
  }
  if (acceptance.length === 0) {
    acceptance.push({ text: CONTENT[lang].acceptanceFallback, source: 'inferred' });
  }

  const allAnchors = suspicious === undefined ? anchors : [...anchors, suspicious];

  return {
    version: '1',
    intent,
    objective: objective.item,
    context,
    requirements,
    constraints,
    nonGoals,
    deliverable,
    acceptance,
    assumptions,
    openQuestions,
    anchors: allAnchors,
    meta: {
      gate: result,
      engine: 'rules',
      style: (options.style ?? 'bluf') as StyleName,
      source: raw,
      sourceHash: hashText(raw),
      createdAt: options.now ?? new Date().toISOString(),
      ...(options.note !== undefined ? { note: options.note } : {}),
    },
  };
}

function toItems(units: Unit[]): Item[] {
  return units.map((unit) => ({ text: unit.text, source: 'user' as const }));
}

/** Language for rendered labels: follow the source, defaulting to English. */
export function renderLanguage(raw: string): 'zh' | 'en' {
  return hasCJK(raw) ? 'zh' : 'en';
}
