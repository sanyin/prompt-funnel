# PromptSpec 规范

`PromptSpec` 是编译器的中间表示，也是 MCP 工具之间传递的对象。它有两个设计约束：

1. **可审计**：每个字段都能回答「这是用户说的，还是推导出来的」。
2. **可编辑**：宿主模型或用户改了一个字段，不需要重跑整个流程。

版本号固定为 `"1"`。破坏性变更会升到 `"2"`，并保留旧版解析。

---

## 顶层结构

```jsonc
{
  "version": "1",
  "intent": "execute",             // execute | answer | debug | write | plan | unknown
  "objective": Item,
  "context": Item[],
  "requirements": Requirement[],
  "constraints": Item[],
  "nonGoals": Item[],
  "deliverable": { "format": Item, "length": Item, "audience": Item },
  "acceptance": Item[],
  "assumptions": [{ "text": string, "impact": string }],
  "openQuestions": string[],
  "anchors": string[],             // 必须逐字保留的片段（代码块、引号内容、注入片段）
  "meta": SpecMeta
}
```

### Item

```jsonc
{ "text": "把并发从 4 改成 8", "source": "user" }
```

`source` 取值：

| 值 | 含义 | 渲染 |
| --- | --- | --- |
| `user` | 用户原文 | 直接输出 |
| `inferred` | 规则推导 | 追加 `（假定）` |
| `assumption` | 默认值 | 追加 `（假定）`，同时列入 `assumptions` |

规则引擎只产出 `user` 和 `inferred`；API 引擎可能返回 `assumption`，`coerceSpec` 会把非法值降级为 `inferred`。

### Requirement

```jsonc
{ "id": "R1", "text": "失败自动重试 3 次", "source": "user" }
```

`id` 在同一 spec 内唯一，渲染时替换为 `1. 2. 3.`。数量建议不超过 12（见 [DESIGN.md](./DESIGN.md) §2.2），超过只警告，不截断——截断要求比多几条更危险。

### Assumption

```jsonc
{ "text": "沿用项目现有技术栈与版本", "impact": "环境不符会导致代码不可用" }
```

`impact` 必填，渲染时写成「若不符：…」。没有影响说明的假设等于没写，因为它无法被判断是否该推翻。

### SpecMeta

```jsonc
{
  "gate": GateResult,
  "engine": "rules",              // rules | api | host
  "style": "bluf",                // bluf | compact | checklist
  "source": "原始输入，逐字",
  "sourceHash": "16 位十六进制",
  "createdAt": "2026-11-01T12:00:00.000Z",
  "note": "可选的改写意见"
}
```

---

## 闸门算法

清晰度 = 六个维度的加权和，每个维度 0..1：

| 维度 | 权重 | 1 分的条件 |
| --- | --- | --- |
| `goal` | 0.30 | 有祈使动词，或是一个明确的提问 |
| `deliverable` | 0.20 | 点名了交付物形态，或指明了要改哪个文件 |
| `context` | 0.15 | 长度足够，或含路径/报错/背景词 |
| `constraints` | 0.15 | 出现「必须/只能/不超过/不要」等标记 |
| `acceptance` | 0.15 | 出现了验收方式（测试命令、字数、验收标准） |
| `risk` | 0.05 | 短、单一目标 |

判定规则：

```
if 是对话追问（≤14 tokens 且匹配追问词表）        → pass
if goal 数 ≥ 3，或（goal 数 = 2 且有「同时/另外」）→ compile
if 清晰度 < 0.62                                  → compile
else                                              → pass
```

阈值和权重写在 `src/gate.ts` 里，不放进配置文件：一个没人会调的阈值，不如一个写在代码里、有注释、有测试的阈值。

`GateResult.reasons` 必须能用人话解释判定，CLI 会原样打印。加一条规则时必须同时加一条理由，否则用户看到的就是「莫名其妙被改了」。

---

## 渲染约定

| 样式 | 用途 | 特征 |
| --- | --- | --- |
| `bluf` | 默认，通用 | `##` 标题 + 编号要求 + `- [ ]` 验收清单 |
| `compact` | 短请求 | 行内 `**目标**：…`，无标题层级 |
| `checklist` | 交给 agent 执行 | 全部是 `- [ ]` 勾选项 |

标签语言跟随输入：含 CJK 用中文标签，否则用英文。

`keepOriginal` 决定是否把原文附在末尾：

- `on`：总是附加；
- `off`：从不附加；
- `auto`（默认）：有锚点、假设或待确认问题时附加——此时原文携带了编译正文没有的信息，重复是对的。

---

## 保真报告

```jsonc
{
  "retention": 0.93,
  "unverifiable": ["3000"],
  "issues": [
    { "kind": "unverifiable-token", "detail": "输出里的「3000」在原文中找不到", "severity": "error" }
  ],
  "ok": false
}
```

`ok` 只表示没有 `error` 级问题；`warn` 不影响退出码。

问题类型一览：

| kind | 级别 | 触发条件 |
| --- | --- | --- |
| `unverifiable-token` | error（数字/URL/路径）或忽略（标识符） | 输出含原文没有的字面量 |
| `low-retention` | warn | 原文内容词保留率 < 55% |
| `too-many-requirements` | warn | 要求超过 12 条 |
| `empty-objective` | error | 目标为空 |
| `no-acceptance` | warn | 没有完成标准 |
| `no-question-mark` | warn | 待确认问题超过 5 个 |
| `injection-suspected` | warn | 原文含「忽略以上指令」类字样 |

---

## 从宿主模型接收 spec

`funnel_render` 接受任意 JSON，经 `coerceSpec` 归一化：

- 缺字段 → 回落到该次请求的规则分析结果，不编造；
- `source` 非法 → 降级为 `inferred`；
- `spec.meta.source` 缺失且未传 `source` → 直接报错，因为没法和原文比对，保真校验就失效了。

把「无法校验」当成错误而不是放行，是这个项目的基本原则。
