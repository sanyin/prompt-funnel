/**
 * Cheap lexical signals shared by the gate and the rule-based analyzer.
 *
 * These are heuristics, not a classifier: they exist to answer "is this worth
 * restructuring?" and "what shape does this request have?", and every caller
 * must be able to explain its verdict in words. When a signal is wrong the
 * failure is visible (a pass-through with a reason) rather than silent.
 *
 * @module prompt-funnel/signals
 */

import type { IntentClass } from './types.js';
import { estimateTokens, splitSentences } from './text.js';

/** Verbs that mark a sentence as asking for work to be done. */
const TASK_VERBS =
  /(?:实现|做(?:一个|个|出)?|写(?:一|个|段|份|个)?|改(?:一下|成|为)?|加(?:上|入|个)?|删|移除|重构|优化|设计|分析|整理|总结|翻译|排查|修复|调试|部署|测试|生成|创建|搭建|接入|迁移|对比|评估|审查|检查|补(?:充|齐)|替换|升级|实现一下|实现一个|help me|implement|build|create|add|remove|refactor|optimi[sz]e|design|analy[sz]e|summari[sz]e|translate|debug|fix|deploy|test|generate|migrate|review|compare|write|draft|rewrite|update|upgrade)/iu;

/** Markers that a sentence asks for something *not* to be done. */
export const NON_GOAL_RE =
  /(?:不要(?:再)?(?:做|实现|改|动|管|考虑|处理|加入|引入|支持)|不需要|不用(?:管|做|考虑)|无需|别(?:去)?(?:改|动|管)|禁止(?:改动|修改)|暂不(?:考虑|支持)|先不(?:做|管)|out of scope|do not (?:change|touch|add)|don't (?:worry|change) about)/iu;

/** Markers that a sentence is a constraint rather than a deliverable. */
export const CONSTRAINT_RE =
  /(?:必须|只能|只准|仅限|仅用|只(?:用|支持)|不能|不可|不得|不要(?:用|写|超过|包含)|别(?:用|写)|限制|不超过|不少于|以内|以下|字数|长度|上限|预算|时间(?:限制|要求)?|截止|deadline|用(?:中文|英文|简体|繁体|markdown|json|typescript|python)|风格|语气|口吻|格式要求|保持|兼容|不破坏|向后兼容|minimal|at most|no more than|within \d+|must (?:use|be|stay|remain)|should not exceed)/iu;

/** Markers that a sentence states how completion is judged. */
export const ACCEPTANCE_RE =
  /(?:验收|完成标准|标准是|判定标准|通过测试|测试通过|能运行|能跑起来|可运行|不报错|无报错|跑通|至少(?:要|能)|确保(?:能|不)|必须能|definition of done|acceptance|passes? (?:the )?tests?|should run|must work|no errors?|verifiable|通过\s*(?:pnpm|npm|yarn|bun|pytest|go test|cargo test|jest|vitest|mocha|单测|测试|ci))/iu;

/** Markers that a sentence is background rather than an instruction. */
export const CONTEXT_RE =
  /(?:因为|由于|目前|现在|当前|背景|现状|场景|情况是|我的|我们在|我们团队|项目(?:是|里|中)|仓库|代码库|环境(?:是|为)|上下文|之前(?:已经|做过)|已经在用|because|currently|right now|background|context|our (?:team|project|repo)|we (?:are|have))/iu;

/** Artifact nouns that name a deliverable shape. */
export const ARTIFACT_RE =
  /(?:代码|源码|文件|脚本|函数|接口|组件|页面|服务|配置|测试用例|单元测试|文档|报告|方案|计划|清单|表格|图表|邮件|文案|文章|总结|摘要|提纲|大纲|注释|commit|PR|pull request|README|JSON|YAML|CSV|Markdown|SQL|正则|code|file|script|function|endpoint|component|doc|docs|report|plan|checklist|table|email|draft|outline|essay|summary)/iu;

/**
 * Nouns for things you hand over, as opposed to code entities you talk about.
 *
 * "帮我看看这个函数" mentions a noun but asks for a judgement, not a file; treating
 * it as the deliverable would both mis-fill the section and block a template from
 * supplying the real one.
 */
export const DELIVERABLE_RE =
  /(?:代码|源码|文件|脚本|文档|报告|方案|计划|清单|表格|图表|邮件|文案|文章|总结|摘要|提纲|大纲|测试用例|单元测试|commit|PR|pull request|README|JSON|YAML|CSV|Markdown|SQL|code|file|script|doc|docs|report|plan|checklist|table|email|draft|outline|essay|summary)/iu;

/** Question shapes, including Chinese wh-words that need no question mark. */
const QUESTION_TAIL = /[?？]\s*$/u;
const QUESTION_HEAD =
  /^(?:如何|怎么|怎样|为什么|为何|是否|能不能|可不可以|要不要|哪个|哪些|多少|何时|where|what|why|how|when|which|who|should|can|is|are|does|do)\b/iu;
const QUESTION_INLINE = /(?:如何|怎么|为什么|是否)/u;

/** Short replies that only make sense with the previous turn in view. */
const FOLLOW_UP_RE =
  /^(?:继续|接着|然后呢|好的?|行|可以|嗯+|对|是的|没错|明白|收到|谢谢|再来|再改|改成|换成|换一个|上一个|刚才那个|上面那个|这个|那个|第\s*\d+\s*(?:点|条|项)|ok(?:ay)?|yes|yeah|sure|thanks?|continue|go on|next|same|again)/iu;

/** Greetings and acknowledgements that carry no request at all. */
const TRIVIAL_RE = /^(?:你好|hi|hello|hey|在吗|在不在|测试|test|1)\s*[!！。.]*$/iu;

/** Classify the request. Order matters: specific shapes win over the default. */
export function detectIntent(text: string): IntentClass {
  if (/(?:报错|错误|异常|失败|崩溃|不工作|没反应|无效|诡异|bug|error|exception|crash|traceback|stack trace|broken|fails?|failing)/iu.test(text)) {
    return 'debug';
  }
  // "写" alone is not writing: "写一个爬虫" is an engineering task. Require a
  // text artifact to be named before calling this a writing request.
  const isCode = /(?:代码|函数|脚本|接口|组件|测试|仓库|repo|code|function|script|component|api|test)/iu.test(text);
  const textArtifact = /(?:文章|文案|报告|邮件|总结|说明文档|演讲稿|提纲|大纲|稿件|读后感|essay|email|article|report|summary|outline|post)/iu.test(text);
  const writeVerb = /(?:写|撰写|润色|改写|翻译|起草|draft|write|rewrite|proofread|translate|summari[sz]e)/iu.test(text);
  if (!isCode && textArtifact && writeVerb) return 'write';
  if (/(?:计划|方案|规划|路线图|步骤|拆解|里程碑|排期|roadmap|plan|strategy|milestones|schedule)/iu.test(text)) {
    return 'plan';
  }
  if (isQuestion(text)) return 'answer';
  if (TASK_VERBS.test(text)) return 'execute';
  return 'unknown';
}

/** True when the request is a question rather than an instruction. */
export function isQuestion(text: string): boolean {
  const trimmed = text.trim();
  if (QUESTION_TAIL.test(trimmed)) return true;
  if (QUESTION_HEAD.test(trimmed)) return true;
  // An inline wh-word only makes this a question when there is no work to do;
  // otherwise it is an instruction with a question attached, which countGoals
  // handles as a multi-goal request.
  return QUESTION_INLINE.test(trimmed) && !TASK_VERBS.test(trimmed);
}

/** True when the text is a reply inside a conversation rather than a standalone ask. */
export function isConversational(text: string): boolean {
  const trimmed = text.trim();
  if (TRIVIAL_RE.test(trimmed)) return true;
  return estimateTokens(trimmed) <= 14 && FOLLOW_UP_RE.test(trimmed);
}

/** True when the text contains at least one literal request to do work. */
export function hasTaskVerb(text: string): boolean {
  return TASK_VERBS.test(text);
}

/**
 * Count distinct action-bearing clauses.
 *
 * Splitting on commas as well as sentence terminators is deliberate: the most
 * common bad prompt is one long sentence with three jobs separated by commas
 * ("写个爬虫，加个代理池，再做个面板"). Counting sentences alone would see one.
 */
export function countGoals(text: string): number {
  let goals = 0;
  const seen = new Set<string>();
  for (const clause of text.split(/[，,；;。！？!?\n]+/u)) {
    const trimmed = clause.trim();
    if (trimmed.length === 0 || NON_GOAL_RE.test(trimmed)) continue;
    if (!TASK_VERBS.test(trimmed)) continue;
    const key = trimmed.replace(/[\s\p{P}\p{S}]+/gu, '');
    if (seen.has(key)) continue;
    seen.add(key);
    goals += 1;
  }
  return Math.min(goals, 20);
}

/** True when several goals are joined by an explicit "and also" connector. */
export function hasAdditiveConnector(text: string): boolean {
  return /(?:同时|并且|另外|顺便|还要|以及|再加上|然后再|after that|also|plus|and then)/iu.test(text);
}

/** Count of explicit prompt-injection markers, surfaced as a warning. */
export function injectionMarkers(text: string): number {
  const matches = text.match(/(?:ignore|disregard|forget)\s+(?:all\s+)?(?:the\s+)?(?:previous|above|prior)|忽略(?:以上|之前|上面|前面)|从现在起你|你现在是/giu);
  return matches?.length ?? 0;
}
