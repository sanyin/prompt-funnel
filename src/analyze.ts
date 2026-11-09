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
  CONSTRAINT_RE,
  CONTEXT_RE,
  DELIVERABLE_RE,
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

/** A comma followed by one of these starts a new requirement. */
const JUNCTION =
  /[，,]\s*(?:(?:并且|同时|另外|还要|顺便|以及|然后)|再(?=[做加写改实现补生成跑试]))/u;

/** Comma that introduces a prohibition starts a new unit. */
const NEGATION_LEAD = /[，,]\s*(?=(?:不要|别|无需|不需要|禁止|不得|不考虑|不允许))/u;

/** Split a block into clauses, keeping units semantically whole. */
function segment(block: string): string[] {
  const bySemicolon = block.split(/[；;]/u);
  const byNegation = bySemicolon.flatMap((part) => part.split(NEGATION_LEAD));
  return byNegation.flatMap((part) => (JUNCTION.test(part) ? part.split(JUNCTION) : [part]));
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

/** Pull the narrowest clause that names a deliverable. */
function findDeliverableSentence(units: Unit[]): string | undefined {
  for (const unit of units) {
    if (!DELIVERABLE_RE.test(unit.text)) continue;
    const clauses = unit.text.split(/[，,]/u).map((clause) => clause.trim());
    return clauses.find((value) => DELIVERABLE_RE.test(value)) ?? unit.text;
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
  multi?: boolean;
  rank: number;
  question: string;
  options: string[];
  assumption: Assumption;
}

/**
 * Praise that cannot be checked.
 *
 * "有竞争力 / 有新意" is a feeling, not a requirement: the model will happily
 * produce something that merely *sounds* novel. Ranking this gap first turns an
 * unanswerable adjective into a choice between concrete axes.
 */
const HOLLOW_QUALITY =
  /(?:新意|新颖|创新|竞争力|亮点|高级感|高大上|有质感|惊艳|爆款|别具一格|与众不同)/u;

/**
 * A role stated in the request itself.
 *
 * "你是一个资深程序员，帮我优化一下" already says who should answer. Asking
 * again, or printing "未指定", would be the tool not reading what it was given.
 */
function detectRole(raw: string): string | undefined {
  const match =
    /(?:你(?:现在|将)?(?:是|作为)|扮演|以)\s*([^，。；、\n]{2,24}?)(?:的身份|的角度)?(?=[，。；、\n]|$)/u.exec(raw);
  const captured = match?.[1]?.trim();
  if (captured === undefined || captured.length === 0) return undefined;
  const stripped = captured.replace(/^(?:一个|一名|一位|个)\s*/u, '').trim();
  return stripped.length >= 2 ? stripped : undefined;
}

/** Words that say this is coursework rather than engineering. */
const STUDENT_RE = /(?:作业|论文|课程|实验报告|答辩|开题|绩点|老师|教授|导师|学校|学期|期末|文献综述|引用|参考文献)/iu;
/** Words that say this is engineering work. */
const DEV_RE = /(?:代码|接口|仓库|函数|报错|异常|部署|依赖|数据库|重构|单元测试|编译|api|bug|docker|git)/iu;

/**
 * Answer choices for each gap.
 *
 * A question with no options forces the user to write prose; a question with
 * three concrete options gets answered. These are the shapes people actually
 * pick, not a taxonomy.
 */
const GAP_OPTIONS: Record<Lang, Record<string, string[]>> = {
  zh: {
    audience: ['完全的新手', '有基础的人', '领域专家', '要拿去做决定的人'],
    scope: ['一次全做', '先做第一件', '按顺序，做完一件再确认'],
    format: ['一段能直接用的文字', '一份清单或表格', '能跑的代码 + 说明', '分步骤的操作指南'],
    acceptance: ['能跑通 / 通过测试', '覆盖所有要求', '500 字以内', '能直接发给别人'],
    stack: ['沿用现有技术栈', 'TypeScript / Node', 'Python', '不确定，你来选'],
    quality: ['玩法 / 规则上的新', '视觉 / 氛围上的新', '技术实现上的新', '先给我三个方向选'],
    failure: ['做出来不能用', '能用，但不是我想的样子', '方向对，但太粗糙', '我也说不上来'],
    role: ['不需要，按通用助手来', '这行的资深从业者', '严格的评审者', '完全不懂这块的人（帮你检查是否说人话）'],
    approach: ['直接做', '先给计划，我确认后再做', '先给两三个方案让我对比'],
    rubric: ['老师有评分表（我贴给你）', '字数有硬性要求', '要附参考文献 / 引用格式', '要能讲清推导过程', '不能看起来像 AI 写的'],
    forbidden: ['不许改现有接口', '不许加新依赖', '不许动数据库结构', '先别写代码，只给方案'],
    repro: ['本机 Node 22', 'Docker 里跑', '公司 / 学校的内网环境', '不确定，按最常见的来'],
  },
  en: {
    audience: ['A complete beginner', 'Someone with basics', 'A domain expert', 'Someone deciding something'],
    scope: ['All at once', 'The first one only', 'In order, confirm after each'],
    format: ['A paragraph I can use as-is', 'A list or table', 'Runnable code + notes', 'Step-by-step instructions'],
    acceptance: ['It runs / tests pass', 'It covers every requirement', 'Under 500 words', 'I can send it to someone'],
    stack: ['The existing stack', 'TypeScript / Node', 'Python', 'Not sure, you pick'],
    quality: ['New mechanics', 'New look and feel', 'New technical approach', 'Give me three directions first'],
    failure: ['It does not run', 'It runs but is not what I meant', 'Right direction, too rough', 'I cannot say'],
    role: ['No role, just a general assistant', 'A senior practitioner of this craft', 'A strict reviewer', 'Someone who knows nothing about this (checks if it reads)'],
    approach: ['Just do it', 'Give me a plan first, then I confirm', 'Give me two or three options to compare'],
    rubric: ['There is a marking rubric (I will paste it)', 'A hard word limit', 'References / citation style required', 'Show the derivation', 'It must not read as AI-written'],
    forbidden: ['Do not change the existing interface', 'No new dependencies', 'Do not touch the schema', 'Do not write code yet, plan first'],
    repro: ['Node 22 on my machine', 'Inside Docker', 'A locked-down work network', 'Not sure, use the usual'],
  },
};

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
      options: GAP_OPTIONS[lang].audience ?? [],
      assumption: { text: content.gaps.audience.assumption, impact: content.gaps.audience.impact },
    });
  }
  if (HOLLOW_QUALITY.test(raw)) {
    gaps.push({
      id: 'quality',
      rank: 0,
      question:
        lang === 'zh'
          ? '「新意 / 竞争力」具体指哪一方面？'
          : 'What kind of "novel" do you mean?',
      options: GAP_OPTIONS[lang].quality ?? [],
      multi: true,
      assumption: {
        text:
          lang === 'zh'
            ? '按「玩法 / 规则上的新」理解，先做一个能跑的版本'
            : 'Novelty in mechanics: one playable version first',
        impact:
          lang === 'zh'
            ? '方向选错，做出来的东西对但不对味'
            : 'Wrong axis: the thing will be built, and be the wrong kind of new',
      },
    });
  }
  if (goals >= 2) {
    gaps.push({
      id: 'scope',
      rank: 1,
      question: content.gaps.scope.question,
      options: GAP_OPTIONS[lang].scope ?? [],
      assumption: { text: content.gaps.scope.assumption, impact: content.gaps.scope.impact },
    });
  }
  if (intent === 'execute' || intent === 'plan' || intent === 'write') {
    gaps.push({
      id: 'failure',
      rank: 2,
      question:
        lang === 'zh'
          ? '什么情况算失败？（你最不想要的结果）'
          : 'What would count as a failure here?',
      options: GAP_OPTIONS[lang].failure ?? [],
      multi: true,
      assumption: {
        text:
          lang === 'zh'
            ? '没有失败条件，按这类任务最常见的坑自查'
            : 'No stated failure mode; check against the usual traps for this kind of task',
        impact:
          lang === 'zh'
            ? '不说清什么算失败，模型不会主动避开它'
            : 'A failure you never named is one the model will not avoid',
      },
    });
  }
  if (detectRole(raw) === undefined && (intent === 'plan' || intent === 'debug' || intent === 'answer')) {
    gaps.push({
      id: 'role',
      rank: 2,
      question: lang === 'zh' ? '要它扮演谁？' : 'Who should answer?',
      options: GAP_OPTIONS[lang].role ?? [],
      assumption: {
        text: lang === 'zh' ? '按通用助手回答' : 'A general assistant',
        impact: lang === 'zh' ? '不给身份，回答的深度会按「普通人」来' : 'Depth will default to a general reader',
      },
    });
  }
  if (intent === 'execute' || intent === 'plan') {
    gaps.push({
      id: 'approach',
      rank: 3,
      question: lang === 'zh' ? '直接做，还是先给计划？' : 'Act now, or plan first?',
      options: GAP_OPTIONS[lang].approach ?? [],
      assumption: {
        text: lang === 'zh' ? '直接给结果' : 'Do it directly',
        impact: lang === 'zh' ? '不先说，方向错了要整体返工' : 'A wrong direction means rework',
      },
    });
  }
  if (STUDENT_RE.test(raw)) {
    gaps.push({
      id: 'rubric',
      rank: 2,
      multi: true,
      question: lang === 'zh' ? '这份东西按什么标准评？' : 'How will this be marked?',
      options: GAP_OPTIONS[lang].rubric ?? [],
      assumption: {
        text: lang === 'zh' ? '按「读得懂、能自圆其说」处理' : 'Readable and defensible',
        impact: lang === 'zh' ? '不说评分标准，模型会按「看起来专业」来写' : 'It will optimise for sounding competent',
      },
    });
  }
  if (DEV_RE.test(raw) && !STUDENT_RE.test(raw)) {
    gaps.push({
      id: 'forbidden',
      rank: 2,
      multi: true,
      question: lang === 'zh' ? '有什么是不能动的？' : 'What must not be touched?',
      options: GAP_OPTIONS[lang].forbidden ?? [],
      assumption: {
        text: lang === 'zh' ? '没说不许动，就按改动最小的方式做' : 'Minimal change',
        impact: lang === 'zh' ? '不说禁区，模型可能顺手重构你不想动的地方' : 'It may refactor things you wanted left alone',
      },
    });
    gaps.push({
      id: 'repro',
      rank: 3,
      question: lang === 'zh' ? '在什么环境里跑？' : 'Which environment?',
      options: GAP_OPTIONS[lang].repro ?? [],
      assumption: {
        text: lang === 'zh' ? '按最常见的环境处理' : 'The usual environment',
        impact: lang === 'zh' ? '环境不符，代码在你这儿跑不起来' : 'It may not run where you are',
      },
    });
  }
  if (deliverable.format === undefined) {
    gaps.push({
      id: 'format',
      rank: 2,
      question: content.gaps.format.question,
      options: GAP_OPTIONS[lang].format ?? [],
      multi: true,
      assumption: { text: defaultDeliverable(intent, lang), impact: content.gaps.format.impact },
    });
  }
  if (acceptance.length === 0) {
    gaps.push({
      id: 'acceptance',
      rank: 2,
      question: content.gaps.acceptance.question,
      options: GAP_OPTIONS[lang].acceptance ?? [],
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
      options: GAP_OPTIONS[lang].stack ?? [],
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
  // A single sentence cannot be both the ask and its own background: the
  // classifier calls long sentences "context", which duplicated the objective.
  const objectiveText = objective.item.text;
  const detectedRole = detectRole(raw);

  const context = toItems(units.filter((unit) => unit.role === 'context'))
    .filter((item) => item.text !== objectiveText && !objectiveText.includes(item.text))
    .slice(0, 8);

  const formatSentence = findDeliverableSentence(units);
  const deliverable: Deliverable = {};
  if (formatSentence !== undefined) deliverable.format = { text: formatSentence, source: 'user' };
  const length = detectLength(raw);
  if (length !== undefined) deliverable.length = { text: length, source: 'user' };
  const audience = detectAudience(raw);
  if (audience !== undefined) deliverable.audience = { text: audience, source: 'user' };

  const gaps = collectGaps(intent, deliverable, acceptance, result.signals.goals, raw, lang);
  // Gaps are pushed in rank order, so the first three are the ones worth a
  // round-trip. Rank decides *priority*, not eligibility: a third-tier gap still
  // gets asked when nothing more important is missing.
  const asked = [...gaps].sort((left, right) => left.rank - right.rank).slice(0, 4);
  const openQuestions = asked.map((gap) => gap.question);
  // Only the gaps that were actually asked become answerable in the UI; the rest
  // stay as silent defaults so the prompt never grows a fourth question.
  const assumptions = gaps.map((gap) =>
    asked.includes(gap)
      ? {
          ...gap.assumption,
          gap: {
            id: gap.id,
            question: gap.question,
            options: gap.options,
            ...(gap.multi === true ? { multi: true } : {}),
          },
        }
      : gap.assumption,
  );

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
    ...(detectedRole !== undefined ? { role: { text: detectedRole, source: 'user' as const } } : {}),
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

