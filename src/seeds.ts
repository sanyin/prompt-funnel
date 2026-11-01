/**
 * A hand-written library of directions.
 *
 * When the user says "I want it to feel new" and cannot say along which axis, the
 * honest options are: ask again (annoying), call a model (non-deterministic,
 * unverifiable), or offer something curated. This is the third one.
 *
 * Every entry here was written by a person, is traceable to a commit, and says
 * what it costs to try. Nothing is generated at runtime. That is the whole point:
 * a suggestion you cannot audit is just a confident guess.
 *
 * A seed is a **candidate**, never a requirement: it enters the prompt only after
 * the user picks it, at which point it becomes their word (`source: 'user'`).
 *
 * @module prompt-funnel/seeds
 */

/** One direction someone could take. */
export interface Seed {
  id: string;
  domain: SeedDomain;
  /** The direction, one line. */
  title: string;
  /** What it buys, and what to watch out for. */
  why: string;
  /** Effort to get to something playable/readable. */
  cost: 'low' | 'medium' | 'high';
}

export type SeedDomain = 'game' | 'tool' | 'writing' | 'data' | 'dev';

const SEEDS: Seed[] = [
  // ---------------------------------------------------------------- game
  {
    id: 'game-rules-not-content',
    domain: 'game',
    title: '让两个规则互相作用，而不是堆内容',
    why: '新意来自规则组合（比如「重力 + 建造」），不来自更多方块。先做 3 种方块 × 2 条规则，跑起来就知道好不好玩。',
    cost: 'low',
  },
  {
    id: 'game-one-verb',
    domain: 'game',
    title: '只留一个动词，把它做深',
    why: '推、挖、连、叠——每个好玩的游戏通常只有一个核心动作。删到只剩一个，手感才立得住。',
    cost: 'low',
  },
  {
    id: 'game-world-remembers',
    domain: 'game',
    title: '世界会记住你做过什么',
    why: '每次行动留下永久痕迹（挖过的洞、烧过的地），回头能看到自己的历史。实现便宜，体验罕见。',
    cost: 'medium',
  },
  {
    id: 'game-constraint-is-design',
    domain: 'game',
    title: '给玩家一个苛刻的约束',
    why: '不能跳、只能垂直移动、只有三格空间——限制本身就是玩法，比加功能更能逼出设计。',
    cost: 'low',
  },
  {
    id: 'game-3-minute-loop',
    domain: 'game',
    title: '一局三分钟，输了立刻能再来',
    why: '短局最适合验证手感：做的对不对，五分钟内你自己就知道。',
    cost: 'low',
  },
  {
    id: 'game-pixels-are-rules',
    domain: 'game',
    title: '像素不是滤镜，是规则',
    why: '每个像素有状态（沙 / 水 / 火），美术风格就变成了模拟系统——同样分辨率，完全不同的游戏。',
    cost: 'high',
  },

  // ---------------------------------------------------------------- tool
  {
    id: 'tool-one-action',
    domain: 'tool',
    title: '只做好一个动作，一步到位',
    why: '工具的价值等于「省下的步数」。把最常用的那个操作压到一次点击，其余全部砍掉。',
    cost: 'low',
  },
  {
    id: 'tool-paste-to-result',
    domain: 'tool',
    title: '粘进去就出结果，没有配置项',
    why: '设置项是给作者的，不是给用户的。默认值对不对，决定它有没有人用第二次。',
    cost: 'low',
  },
  {
    id: 'tool-local-first',
    domain: 'tool',
    title: '本地优先，数据不出机器',
    why: '当所有工具都在上传时，「不联网」本身就是卖点——而且可以验证。',
    cost: 'medium',
  },
  {
    id: 'tool-receipt',
    domain: 'tool',
    title: '给结果附一张可核对的凭据',
    why: '哈希、时间戳、来源链接——让用户能自己验证你说的不是编的。',
    cost: 'medium',
  },
  {
    id: 'tool-error-is-product',
    domain: 'tool',
    title: '把失败路径当功能做',
    why: '出错时告诉用户下一步做什么，比任何成功动画都更让人愿意留下。',
    cost: 'low',
  },
  {
    id: 'tool-narrow-audience',
    domain: 'tool',
    title: '只服务一种人',
    why: '「给写周报的人」比「给所有人」好用十倍。范围一窄，默认值就有依据了。',
    cost: 'low',
  },

  // ------------------------------------------------------------- writing
  {
    id: 'writing-conclusion-first',
    domain: 'writing',
    title: '第一句就是结论',
    why: '读者只给你一句话的时间。结论先给，理由再展开；好处是写的人也被迫想清楚。',
    cost: 'low',
  },
  {
    id: 'writing-one-person',
    domain: 'writing',
    title: '写给一个具体的人',
    why: '「写给刚入职的同事」会让所有句子具体起来，比任何风格指南都有效。',
    cost: 'low',
  },
  {
    id: 'writing-by-counterexample',
    domain: 'writing',
    title: '用反例划边界',
    why: '说什么是对的容易空泛，说什么不算才见功力——反例能立刻暴露作者是否真懂。',
    cost: 'low',
  },
  {
    id: 'writing-one-number',
    domain: 'writing',
    title: '至少给一个可核对的数字',
    why: '一个真实数字顶十句形容。没有数字的时候，说明你还没查。',
    cost: 'medium',
  },
  {
    id: 'writing-cut-third',
    domain: 'writing',
    title: '砍掉三分之一再交',
    why: '初稿一定太长。先删修饰词，再删重复的段落，最后删你自己最得意的那句。',
    cost: 'low',
  },

  // ---------------------------------------------------------------- data
  {
    id: 'data-define-first',
    domain: 'data',
    title: '先定口径，再算数',
    why: '「活跃用户」有几个定义，结论就有几个版本。口径写在最前面，后面才可信。',
    cost: 'low',
  },
  {
    id: 'data-one-source',
    domain: 'data',
    title: '一个指标一个来源',
    why: '两个来源的同一个指标，迟早会打架。说清楚谁说了算。',
    cost: 'low',
  },
  {
    id: 'data-falsifiable',
    domain: 'data',
    title: '结论要写成能被推翻的样子',
    why: '「用户更喜欢 A」无法验证；「A 的次日留存比 B 高 3 个点」可以被推翻。',
    cost: 'low',
  },
  {
    id: 'data-show-the-boring',
    domain: 'data',
    title: '把不好看的数据也放进去',
    why: '只展示支持结论的样本，等于没做分析。异常值往往才是真问题。',
    cost: 'medium',
  },

  // ----------------------------------------------------------------- dev
  {
    id: 'dev-acceptance-first',
    domain: 'dev',
    title: '先写验收，再写实现',
    why: '先确定「怎么算完成」，实现路径会自己收敛；反过来通常要返工两次。',
    cost: 'low',
  },
  {
    id: 'dev-small-reversible',
    domain: 'dev',
    title: '每一步都能回滚',
    why: '小步提交 + 可回滚的开关，比「一次做对」现实得多，也更容易定位问题。',
    cost: 'low',
  },
  {
    id: 'dev-uncertainty-as-flag',
    domain: 'dev',
    title: '拿不准的地方做成开关',
    why: '不要在代码里赌一个判断——把它变成配置项，上线后用数据决定。',
    cost: 'medium',
  },
  {
    id: 'dev-delete-first',
    domain: 'dev',
    title: '先想能删掉什么',
    why: '增加功能几乎总是可行，删掉功能才需要判断力。先问「不做会怎样」。',
    cost: 'low',
  },
  {
    id: 'dev-one-interface',
    domain: 'dev',
    title: '只留一个入口',
    why: '一个函数、一个命令、一个页面。入口一多，边界就说不清楚。',
    cost: 'low',
  },
];

/** Keyword → domain. Ordered; first match wins. */
const DOMAIN_HINTS: Array<{ domain: SeedDomain; pattern: RegExp }> = [
  { domain: 'game', pattern: /(?:游戏|关卡|玩家|玩法|我的世界|像素|roguelike|game|level|player)/iu },
  { domain: 'data', pattern: /(?:数据|指标|报表|分析|统计|留存|转化|dashboard|metric|analytics)/iu },
  { domain: 'writing', pattern: /(?:文章|文案|报告|写作|润色|稿|公众号|邮件|essay|article|copy|post)/iu },
  { domain: 'dev', pattern: /(?:代码|接口|重构|服务|脚本|函数|仓库|api|refactor|service|script|repo)/iu },
  { domain: 'tool', pattern: /(?:工具|插件|应用|助手|产品|小程序|tool|plugin|app|utility)/iu },
];

/** Guess which shelf of the library to look at. */
export function detectDomain(text: string): SeedDomain {
  for (const hint of DOMAIN_HINTS) if (hint.pattern.test(text)) return hint.domain;
  return 'tool';
}

/** Longest list of directions a single answer should ever contain. */
export const MAX_SEEDS = 3;

/**
 * Pick directions for one request.
 *
 * Deterministic: the same text always yields the same three seeds, in the same
 * order. No ranking by popularity, no randomness, no network.
 */
export function seedsFor(text: string, options: { limit?: number; domain?: SeedDomain } = {}): Seed[] {
  const limit = Math.min(options.limit ?? MAX_SEEDS, MAX_SEEDS);
  const domain = options.domain ?? detectDomain(text);

  const pool = SEEDS.filter((seed) => seed.domain === domain);

  // Rotate by a cheap hash of the request, so two different requests in the same
  // domain do not always get the identical three.
  const offset = [...text].reduce((sum, char) => sum + char.codePointAt(0)!, 0) % Math.max(1, pool.length);
  const rotated = [...pool.slice(offset), ...pool.slice(0, offset)];

  // Then prefer the cheapest: a direction you can try in an hour is worth more
  // than a beautiful one that never gets built. The sort is stable, so rotation
  // still decides which low-cost seeds come first.
  const order = { low: 0, medium: 1, high: 2 } as const;
  return rotated
    .map((seed, index) => ({ seed, index }))
    .sort((a, b) => order[a.seed.cost] - order[b.seed.cost] || a.index - b.index)
    .map((entry) => entry.seed)
    .slice(0, limit);
}

/** Every domain that has seeds, for `funnel ideas --domain`. */
export function seedDomains(): SeedDomain[] {
  return [...new Set(SEEDS.map((seed) => seed.domain))];
}

/** Total size of the library, for honest reporting. */
export function seedCount(): number {
  return SEEDS.length;
}
