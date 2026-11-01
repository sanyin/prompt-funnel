# prompt-funnel · 收束

[![npm](https://img.shields.io/badge/npm-prompt--funnel-cb3837)](https://www.npmjs.com/package/prompt-funnel)
[![ci](https://github.com/sanyin/prompt-funnel/actions/workflows/ci.yml/badge.svg)](https://github.com/sanyin/prompt-funnel/actions/workflows/ci.yml)
[![node](https://img.shields.io/badge/node-%E2%89%A522-339933)](package.json)
[![deps](https://img.shields.io/badge/runtime%20deps-0-blue)](package.json)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)

> 在请求进入模型之前，把缺失的信息显式化。该问的就问，猜的就标出来，编的一律拦掉。

[English](./README.en.md) · [设计说明](./docs/DESIGN.md) · [用法](./docs/USAGE.md) · [实测](./docs/AB-REPORT.md)

![playground](docs/assets/playground.png)

## 它解决的是哪一件事

大多数「AI 答不好」，不是措辞问题，是**目标、交付形态、约束、验收标准**四件事里缺了一两件。模型不会说它缺什么——它会自己补一个，然后给你一份看起来很专业、但不是你要的答案。

真实的对比（同一个请求「帮我写个爬虫，顺便加个代理池，再做个面板」）：

| 直接发 | 收束后发 |
| --- | --- |
| 「下面给你一套可直接运行的完整方案……」 | 「**由于你未指定目标网站**，我采用 Python 技术栈，以 httpbin.org/ip 作为示例目标……」 |
| 3000 字实现，不说哪里是猜的 | 第一句就交代了哪些是替你决定的 |

在 60 次受控调用里，「明确说出自己的假设」从 **5/30 提到 18/30**。完整方法、混杂因素和**不能证明什么**都在 [docs/AB-REPORT.md](./docs/AB-REPORT.md)。

## 快速开始

```bash
npx prompt-funnel review "帮我优化一下这个东西"    # 交互式：改到满意再发
npx prompt-funnel compile "帮我优化一下这个东西"    # 直接拿提示词
npx prompt-funnel gate   "帮我优化一下这个东西"    # 只看判定，不改
```

零运行时依赖，不需要 API key，离线可用。Node ≥ 22。

不想装任何东西：**https://sanyin.github.io/prompt-funnel/**（每次 push 自动部署，Pages 若显示旧版请 Ctrl+Shift+R 强刷）。

## 六种用法

| 入口 | 适合 | 怎么用 |
| --- | --- | --- |
| **网页** | 不装任何东西，先用一眼 | `npm run playground` |
| **浏览器扩展** | 在 ChatGPT / Claude / DeepSeek 里直接补 | `npm run build:extension`（[安装](./extension/README.md)） |
| **CLI** | 终端、脚本、管道 | `npx prompt-funnel review "..."` |
| **MCP** | 任何 agent：DSH / Codex / Claude Code / Cursor | `npx -y prompt-funnel mcp` |
| **Hook** | Claude Code 发送前自动收束 | `funnel hook`（[配置](./adapters/claude-code/README.md)） |
| **Skill** | 让 agent 自己知道何时该收束 | `node adapters/install.mjs codex` |

![extension](docs/assets/extension.png)

扩展不拦截发送：你点它，它才出现；点「插回输入框」，它把结果写回去，你照常按发送。

MCP 只做确定性的事（判定 / 分析 / 校验 / 渲染），**语义工作交给宿主自己的模型**：不需要第二个 key，也不额外花 token。六个工具：

| 工具 | 作用 |
| --- | --- |
| `funnel_gate` | 要不要收束 |
| `funnel_analyze` | 原话 → 结构化 spec |
| `funnel_render` | spec → 最终提示词（带保真校验） |
| `funnel_continue` | 追问：带上已确认的上一轮，只做本轮增量 |
| `funnel_refine` | 定点改一处（「第 2 点改成 X」） |
| `funnel_compile` | 一步到位 |

## 它做什么 / 不做什么

| 会做 | 不会做 |
| --- | --- |
| 判定要不要收束，清晰的**逐字节原样放行** | 不润色你的措辞（改写是编造的主要来源） |
| 拆出目标 / 要求 / 约束 / 非目标 / 验收 | 不替你决定范围、受众、技术栈 |
| 把缺失变成**点一下就答的问题**，最多 3 个 | 不做问卷，不要求你写作文 |
| 校验输出里的数字、路径、标识符是否来自原文 | 不用「更好的措辞」换掉你的原话 |
| 扫出要发出去的密钥、手机号、内网地址 | **不替你改字**：打不打码你决定 |
| 追问时带上已确认的上下文 | 不猜「继续」是什么意思 |

## 发送前，先看清要发出去的是什么

普通人最常见的泄露不是黑客攻击，是**粘贴**：把带 `sk-...` 的日志、带手机号的报错、带 `C:\Users\...` 的堆栈直接发了出去。

四个入口都会扫一遍：API 密钥 / 令牌 / 私钥 / 密码 / 邮箱 / 手机号 / 身份证号 / 内网地址 / 本机路径。命中就告诉你**几处、什么类型、多长**——但**不会把密钥本身打印出来**（终端历史也是泄露面），也**不会自作主张改你的字**。

要不要打码由你决定：网页上是逐条「打码」按钮，只改命中那一处；CLI 是 `--redact`；不想扫就 `--no-redact`。

规则写得保守：端口、版本号、日期、commit 短哈希、订单号都不会误报，测试里有反例断言。宁可漏一个，也不当那个喊狼来了的人。

## 空话要被问成选项

「有竞争力」「有新意」这类词没法验证——模型会给你一个**听起来**新的东西，然后它就"达标"了。所以这类词会被单独拎出来，变成一道选择题：新意落在玩法 / 视觉 / 技术，还是「先给我三个方向挑」。

选前者，约束里写死方向；选后者，要求里加一条「先给 3 个方向，各一句话说明取舍，等我选定再展开」。

**生成方向的是模型，不是这个工具。** 规则引擎不编内容，它只负责把「没法验证」变成「可以决定」——这正是它该干的活。

## 不想听场面话，就把「别谄媚」写成验收条件

页面上有个 **「要它说实话」** 开关（CLI / 模板里叫 `critique`）。

它不是加一句「请不要谄媚用户」——那句话模型很容易表面满足：先来一句"你说得很有道理"，再转折，最后还是顺着说。所以模板加的是**可检查的结构**：

- 第一句就给结论：可行 / 不可行 / 有条件可行，不许先铺垫
- 不同意的直接说，不许用「虽然…但是」把反对意见包装成同意
- 不确定就说「不确定」，不许用笃定的措辞填空
- 至少指出一个会让它失败的具体原因

「别谄媚」是态度，「先给结论 + 至少一个致命风险」是验收标准。**只有后者能被检查，也只有后者会真的改变输出。**

## 什么情况算失败

「怎样算做完」几乎人人会问，「什么算失败」几乎没人问。但模型不会主动避开你没说过的坑。

所以它会问一句：**做出来不能用 / 能用但不是我想的样子 / 方向对但太粗糙 / 我也说不上来**。选前三个，会变成一条反面验收标准（「不出现：做出来不能用」）；选最后一个也完全可以——它只会把问题撤掉，不会替你编一个标准。

关于「要不要加一个 AI 给灵感」，以及为什么模型只能待在「候选层」、永远不能直接改写提示词：[docs/DESIGN.md §10](./docs/DESIGN.md)。

## 四个设计决定

**1. 闸门，不是网关。** 大部分消息本来就清楚，逐条重写要付延迟、token 和信任三重代价。清晰的请求原样放行——字节相同，有测试断言。

**2. 产物是结构化对象，不是字符串。** 每个字段都记着来源：`user`（你说的）/ `inferred`（规则推的）/ `assumption`（默认值）。渲染时非 `user` 的一律标 `（假定）`。

**3. 保真校验是确定性的。** 输出里出现原文没有的数字、路径、URL → 直接 error，退出码 1，能进 CI。不问模型「你有没有编」，问原文。你自己在 `refine` 里新写的字面量会被记进 `meta.note` 放行——那是你的输入，不是编造。

**4. 追问不重写，而是续接。** 「再补个测试」脱离上文没有意义。`funnel continue` 把上一轮的目标/要求/交付作为「已确认」块放进新提示词，只分析本轮的增量。

为什么是「总—分—总」：模型对上下文**首尾**的利用率显著高于中部（[Lost in the Middle, TACL 2024](https://direct.mit.edu/tacl/article/doi/10.1162/tacl_a_00638/119630/Lost-in-the-Middle-How-Language-Models-Use-Long)），所以「要做什么」放最前、「怎样算做完」放最后；而**指令越多遵循率越低**（[IFScale, 2025](https://huggingface.co/papers/2507.11538)），所以要求必须编号、单条可验证，超过 12 条明确警告而不是硬塞。完整论证在 [docs/DESIGN.md](./docs/DESIGN.md)。

## 工作方式

```
用户原文 ──▶ 敏感信息扫描 ──▶ 闸门 gate ──pass──▶ 原样发送（字节相同）
                │                  │
          命中就报，不自动改     compile
                │                  ▼
                │        结构化为 PromptSpec（每条带来源）
                │          rules：抽取式，离线，默认
                │          api  ：可选，语义改写，仍要过校验
                │                  ▼
                │          + 模板（code-review / debug / …）
                │          + 上一轮已确认（追问时）
                │                  ▼
                │          渲染 bluf / compact / checklist
                │                  ▼
                │          保真校验：硬字面量 + 保留率
                ▼                  ▼
         逐条「打码」       评审：点答问题 / 编辑 / 看差异
                                   ▼
                              发送 + 存证
```

## 实测

**离线评测**（16 条手工用例，不需要 key，`npm run eval`）：

| 指标 | 结果 |
| --- | --- |
| 闸门与人工标注一致率 | 16/16 |
| 原文内容词保留率（中位） | 100% |
| 未溯源字面量（编造） | 0 |
| 长度开销（中位） | 18 → 304 tokens |

**真实模型 A/B**（deepseek-chat，60 次调用）：假设外显 5/30 → 18/30，自检表述 2/30 → 17/30，每条多约 258 输入 tokens。全文与不可证明的部分见 [docs/AB-REPORT.md](./docs/AB-REPORT.md)。README 里不放没测过的数字。

**成本**：绝对开销约 **+117 ~ +272 tokens**（取决于排版），默认档最贵。实测表、三档做法和「什么时候别用」在 [docs/COST.md](./docs/COST.md)。`funnel compile --budget 150` 会在超预算时自动降级并告诉你。

## 目录

```
src/
  gate.ts        闸门：六维加权，判定 + 人话理由
  analyze.ts     抽取式分析：只重排不改写；缺口带 id/问题/选项
  questions.ts   把缺口变成可点选的问题，答案写回对应字段
  redact.ts      敏感信息扫描：密钥 / 手机号 / 内网地址 / 本机路径
  refine.ts      单点修改：第 2 点改成 X / 再加一条 / 删掉
  session.ts     追问续接：把已确认的一轮带进下一轮
  templates.ts   意图模板：为特定任务补上缺的验收标准
  render.ts      三种排版 + provenance 标记
  validate.ts    保真校验 + spec 归一化
  hook.ts        Claude Code 发送前钩子（advisory / block / off）
  llm.ts         可选 API 引擎（OpenAI 兼容）
  cli/           compile / review / refine / continue / gate / render / templates / config / hook
  mcp/           stdio MCP server（零依赖实现，6 个工具）
playground/      单页问答器：浏览器里直接跑同一份内核
extension/       Chromium MV3 扩展：从 dist/ 直接 import 内核，无权限申请
adapters/        Codex / DSH / Claude Code 的 skill、安装脚本与配置说明
evals/           16 条离线用例 + 真实模型 A/B harness + 成本测量
docs/            DESIGN / SPEC / USAGE / EVAL / AB-REPORT / COST / EXAMPLE
```

## 已知局限

- 规则引擎**不理解语义**，靠标记词判断，中文口语会漏标（漏了不会编造，会在保真率里露出来）。
- 一句里同时有约束和动作时不拆（「用 TypeScript 重写这个模块」），整句留在「要求」里。
- `refine` 只认 8 种固定句式；看不懂时直接列出来，不猜。
- 追问续接是「拼接 + 摘要」，不做真正的对话理解；超过几轮后 `已确认` 块会变长，需要手动精简。
- Hook 装在 Claude Code 上：已用探针确认 Claude Code 会以正确 payload 调用 `UserPromptSubmit`，`funnel hook` 本身有单测且响应在毫秒级；**但「注入的内容是否被模型采用」没有量化验证**，依赖模型本身。
- 真实 A/B 只测了一个模型、10 个用例、3 次采样，且质量维度尚未人工盲评。
- **敏感信息靠正则**：能抓常见格式（`sk-` / `ghp_` / JWT / 手机号 / 内网 IP…），抓不到你们内部自定义的密钥格式。宁可漏报也不误报——被假警报训练出来的「无脑点忽略」比漏一个更危险。
- **浏览器扩展只在本地假页面验证过**（`extension/test/fixture.html`），没在真实站点上验证；「找输入框」依赖页面结构，站点改版可能失效（失效表现是按钮没反应，不会破坏页面）。

## 参与

见 [CONTRIBUTING.md](./CONTRIBUTING.md)。最有价值的贡献是**加评测用例**和**评完 `rating.csv`**。

## License

MIT
