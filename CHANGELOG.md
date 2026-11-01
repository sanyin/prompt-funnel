# 变更记录

## 0.4.0

- **敏感信息扫描**：API 密钥、令牌、私钥、密码、手机号、身份证号、内网地址、本机路径。检测到只**报告**，不自动改字；CLI 用 `--redact` 才打码，`--no-redact` 可关闭。钩子会在注入的上下文里提醒一次。
  - 正则刻意保守：端口、版本号、日期、commit 短哈希、订单号都不会误报（测试里有反例）。
- **浏览器扩展**：`extension/`，Chromium MV3。在 ChatGPT / Claude / DeepSeek / Kimi / 豆包 / Gemini 的输入框旁挂一个按钮，点开是同一套问答，答完把结果写回输入框。
  - 扩展直接 import `dist/` 里的内核，不是第二份实现；`npm run build:extension` 负责同步。
  - 不申请任何权限（`permissions: []`），不拦截发送。
- 网页版加敏感信息面板：逐条「打码」，只改命中那一处。
- GitHub Pages 改为 **push 自动部署**（此前手动触发，导致线上停在旧版本）；README 中英双语同步问答器、脱敏与扩展。
- 测试 99 → 111。

## 0.3.0

- **问答式 playground**：不再让普通人编辑一份结构化提示词。粘一句话 → 看到「还缺几件事」→ 点选项补上 → 复制。开发者功能（模板 / 排版 / 评分 / spec）收进「高级」，默认不出现。
- **问题即数据**：`questionsFor(spec)` / `answerQuestion(spec, id, answer)`。缺口现在带 `id / question / options`，答案按缺口类型落到对应字段（形式 → 交付、验收 → 完成标准、范围/技术栈 → 约束），并标记为 `user`。
- 缺口按 rank 取前 3 个提问——rank 决定优先级，不再一票否决（此前后两档的缺口永远问不到）。
- 每个缺口都有具体选项（新手/专家、清单/代码/指南、500 字以内……），不是一句空问题。

## 0.2.1

- **跨轮去重**：`continue` 新增 `--carry full|minimal|off`（CLI 默认 full，MCP 默认 minimal）。续接时不再把整段线程作为「原文」重附，长对话的开销从「每轮 +25 tokens」变成基本持平。
- `evals/cost.mjs` + [docs/COST.md](docs/COST.md)：成本从「倍数」改成报绝对开销；`compile` / `continue` 每次打印实际 tokens。
- `--budget N`：超出预算自动降级 `compact` + 不附原文，仍然超出会明说。
- playground 增加「直接发，模型会替你决定这些」面板：内容来自当前输入的 `spec.assumptions`，只在该请求确实会被收束时出现。

## 0.2.0

新增能力，全部零运行时依赖。

- **`funnel continue`**：追问续接。把上一轮已确认的目标 / 要求 / 交付作为「已确认（上一轮）」块带进新提示词，只分析本轮增量；连续多轮不会滚掉最初的目标。
- **意图模板**：`code-review` / `debug` / `data-analysis` / `writing` / `image-prompt` / `research`，补的是「怎样算做完」，一律标为假定。
- **`funnel refine`**：对已保存的 spec 定点改一处（第 N 点改成 / 删掉 / 再加一条 / 目标改成 / 长度 / 非目标），其余保持字节不变。
- **Claude Code hook**：`UserPromptSubmit` 入口，`advisory`（默认，只附加结构）/ `block` / `off` 三种模式；任何内部异常都退出 0，不会卡住会话。
- **playground**：单页 demo，直接 import 编译产物，无打包器、无网络请求。
- **`evals/live.mjs`**：真实模型 A/B harness + 盲评表；首次实验结果见 [docs/AB-REPORT.md](docs/AB-REPORT.md)。
- **README 重写**，新增 [英文版](README.en.md)。

修复：

- `funnel hook` 用 `readFileSync(0)` 读 stdin，宿主保持管道不关闭时会死锁整个会话；改为读到能解析或 400ms 为止。
- 分析器把「这个函数」这类被谈论的代码实体当成交付物，导致模板无法补上真正的交付形态；现在只有「报告 / 清单 / 代码」类交付名词才算。
- `fgate` 判定把 `顺便`、`再<动词>` 这类并列连接词漏掉了，导致三件事被拆成一件事。

## 0.1.0

首个可用版本：闸门、抽取式分析（带 provenance）、确定性保真校验、三种排版、CLI、MCP server、Codex/DSH/Claude Code 的 skill、16 条离线评测。
