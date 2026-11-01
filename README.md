# prompt-funnel · 收束

> 在请求进入模型之前，把缺失的信息显式化。该问的就问，猜的就标出来，编的一律拦掉。

[![node](https://img.shields.io/badge/node-%E2%89%A522-339933)](package.json)
[![ci](https://github.com/sanyin/prompt-funnel/actions/workflows/ci.yml/badge.svg)](https://github.com/sanyin/prompt-funnel/actions/workflows/ci.yml)
[![deps](https://img.shields.io/badge/runtime%20deps-0-blue)](package.json)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)

大多数「AI 不好用」，不是措辞问题，是**目标、交付形态、约束、验收标准**四件事里缺了一两件。模型不会告诉你它缺什么，它会自己补一个——然后给你一份看起来很专业、但不是你要的答案。

这个工具在请求进入模型之前插一道闸门：清晰的请求原样放行，模糊的请求被拆成结构化条目，缺的部分不是猜，而是**写成假设并标明「若不符」的后果**。

```bash
$ funnel review "帮我写一个爬虫，同时加上代理池，另外再做一个可视化面板"
```

```
判定      收束    清晰度 0.48
理由      检测到 3 个并列任务，放在一轮里会互相稀释
```

```markdown
## 目标

帮我写一个爬虫

## 要求

1. 加上代理池
2. 再做一个可视化面板

## 交付

- 形式：可运行的改动 + 简短的变更说明（假定）

## 完成标准

- [ ] 逐条对照上面的要求自检，并说明未满足的条目（假定）

## 待确认

_以下条目未确认，按默认假设处理：_

1. 这几件事是一次全做，还是先做第一件？
2. 希望什么形态的交付物？
3. 怎样算做完？（能跑通的命令 / 通过测试 / 字数范围）

**假定**

- 按顺序全部完成，先交付第一件 —— 若不符：范围超出单个回答的容量，后几项会变浅
```

注意三件事：**没有编造任何内容**；**没确认的地方写成了假设**；**原文被保留在末尾作为权威引用**。

## 它不做什么

| 会做 | 不会做 |
| --- | --- |
| 判定要不要收束，清晰的原样放行 | 不润色你的措辞（改写是编造的主要来源） |
| 拆出目标 / 要求 / 约束 / 非目标 / 验收 | 不替你决定范围、受众、技术栈 |
| 把不确定的写成假设，最多问 3 个问题 | 不做问卷，不要求你填表 |
| 校验输出里的数字、路径、标识符是否来自原文 | 不用「更好的措辞」换掉你的原话 |

## 为什么不是又一个「提示词美化器」

1. **闸门而不是网关**。大部分消息本来就清楚，逐条重写要付延迟、token 和信任三重代价。清晰的请求**逐字节原样放行**（有测试断言）。
2. **结构化对象，不是字符串**。每个字段都记着来源：`user`（你说的）/ `inferred`（规则推的）/ `assumption`（默认值）。渲染时非 `user` 的一律标 `（假定）`。
3. **保真校验是确定性的**。输出里出现原文没有的数字、路径、URL —— 直接判 error，退出码 1，能进 CI。不问模型「你有没有编」，问原文。
4. **跟进追问不重写**。「继续」「再改第 2 点」脱离上文没有独立含义，孤立重写只会把上文没说过的东西编进来。

为什么是「总—分—总」：模型对上下文**首尾**的利用率显著高于中部（[Lost in the Middle, TACL 2024](https://direct.mit.edu/tacl/article/doi/10.1162/tacl_a_00638/119630/Lost-in-the-Middle-How-Language-Models-Use-Long)），所以「要做什么」放最前、「怎样算做完」放最后；而**指令越多遵循率越低**（[IFScale, 2025](https://huggingface.co/papers/2507.11538)），所以要求必须编号、单条可验证，超过 12 条明确警告而不是硬塞。

## 快速开始

```bash
npx prompt-funnel gate   "帮我优化一下这个东西"    # 只看判定
npx prompt-funnel compile "帮我优化一下这个东西"    # 直接拿提示词
npx prompt-funnel review  "帮我优化一下这个东西"    # 交互式：改到满意再发
```

零运行时依赖，不需要 API key，离线可用。

## 三个入口，一个内核

```
用户原文 ──▶ 闸门 gate ──pass──▶ 原样发送（字节相同）
                │
              compile
                ▼
      结构化为 PromptSpec（每条带来源）
        rules：抽取式，离线，默认
        api  ：可选，语义级改写，输出仍要过校验
                ▼
      渲染 bluf / compact / checklist
                ▼
      保真校验：硬字面量 + 保留率
                ▼
      用户评审：同意 / 编辑 / 看差异 / 换排版
                ▼
            发送 + 存证
```

| 入口 | 适合 | 命令 |
| --- | --- | --- |
| CLI | 终端、脚本、管道 | `npx prompt-funnel review "..."` |
| MCP | 任何 agent（DSH / Codex / Claude Code / Cursor） | `npx -y prompt-funnel mcp` |
| Skill | 让 agent 自己知道何时该收束 | `node adapters/install.mjs codex` |

MCP 只做确定性的事（判定 / 分析 / 校验 / 渲染），**语义工作交给宿主自己的模型**——不需要第二个 key，也不额外花 token。

## 实测

16 条手工标注用例，离线可复现（`npm run eval`）：

| 指标 | 结果 |
| --- | --- |
| 闸门与人工标注一致率 | 100%（16/16） |
| 被正确放行的请求 | 5 |
| 原文内容词保留率（中位） | 100% |
| 未溯源字面量（编造） | 0 |
| 长度开销（中位） | 18 → 264 tokens |

最后一行是真实代价，不藏：每条被收束的请求多约 250 tokens。**没有测「模型回答是否更好」**——那需要真实模型与评审，方法和预期结论见 [docs/EVAL.md](docs/EVAL.md)。README 里不放没测过的数字。

三个完整对话示例（放行 / 拆分 / 编辑到认可）见 [docs/EXAMPLE.md](docs/EXAMPLE.md)。

## 目录

```
src/
  gate.ts        闸门：六维加权，判定 + 人话理由
  analyze.ts     抽取式分析：只重排不改写
  render.ts      三种排版 + provenance 标记
  validate.ts    保真校验 + spec 归一化
  llm.ts         可选 API 引擎（OpenAI 兼容）
  cli/           compile / review / gate / render / config
  mcp/           stdio MCP server（零依赖实现）
adapters/        Codex / DSH / Claude Code 的 skill 与安装脚本
evals/           16 条用例 + 离线评测 + 报告
docs/            DESIGN（为什么）/ SPEC（数据结构）/ USAGE / EVAL
```

## 已知局限

- 规则引擎**不理解语义**，靠标记词判断，中文口语会漏标（漏了不会编造，会在保真率里露出来）。
- 一句里同时有约束和动作时不拆（「用 TypeScript 重写这个模块」），整句留在「要求」里。
- 意图分类是词表驱动，没有训练分类器。
- MCP 路径下确认发生在对话里，没有专属 UI。
- 没测模型侧效果（见上）。

完整清单和取舍理由在 [docs/DESIGN.md](docs/DESIGN.md)。

## English

**prompt-funnel** compiles a vague request into an auditable prompt before it reaches the model.

A gate scores six axes and passes clear requests through **byte-for-byte**; ambiguous ones are restructured into objective, numbered requirements, constraints, non-goals, deliverable and acceptance criteria. Anything the user did not say is marked as an assumption with a stated impact, or becomes one of at most three questions. Every literal (number, path, URL, identifier) in the output is checked against the source — an invented one is an error, not a warning.

Zero runtime dependencies, no API key required, works offline. Ships as a CLI, an MCP server (four tools), and skills for Codex / DSH / Claude Code.

```bash
npx prompt-funnel review "帮我优化一下这个东西"
npx -y prompt-funnel mcp
```

See [docs/DESIGN.md](docs/DESIGN.md) for the reasoning, [docs/EVAL.md](docs/EVAL.md) for what is and is not measured.

## License

MIT
