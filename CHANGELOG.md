# 变更记录

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
