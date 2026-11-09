# 决策日志

Agent 最贵的行为是**重复撞同一堵墙**。它不知道三周前 Redis 已经被否掉了，于是再试一次、再失败一次、再花一次 token。

解法朴素到不像 AI 产品：**仓库里一个 markdown 文件**，写清楚「试过什么、为什么放弃、什么条件下可以重试」，开工前先读它。

不要向量库，不要服务，不要 embedding——因为一条决定很短、很少，而且值得整条读完。

```bash
node tools/decision-log/cli.mjs init
node tools/decision-log/cli.mjs add \
  --topic "Redis 队列" \
  --tried "用 Redis 做上传队列" \
  --result "跑通了" \
  --reason "公司没有实例，运维不批" \
  --retry "有了托管 Redis 之后"
node tools/decision-log/cli.mjs search "Redis"
```

生成 `.decisions.md`：

```markdown
## Redis 队列
- 日期：2026-11-09
- 试过：用 Redis 做上传队列
- 结果：跑通了
- 原因：公司没有实例，运维不批
- 可以重试的条件：有了托管 Redis 之后
```

## 给 agent 用

```bash
node tools/decision-log/mcp.mjs --root /path/to/project
```

两个工具：

| 工具 | 作用 |
| --- | --- |
| `decision_search` | 开工前查「这件事是不是已经试过」 |
| `decision_record` | 把死胡同记下来，下次别再走 |

接进 Claude Code / Cursor / 任何 MCP 宿主，然后在 system prompt 里加一句「动手前先调 decision_search」。

## 为什么是 markdown 而不是数据库

- **能进 review**：决策和代码一起被评审，而不是藏在一个库里。
- **能读**：人说人话，agent 也读得懂。
- **能删**：文件没了就是没了，不需要迁移。

## 限制

- 检索是**全词匹配**，不是语义检索。问「能不能用缓存」搜不到「Redis」。
- 只记「试过什么」，不记录「哪些方案还在候选」——那是另一个文件。
- 不做去重：同一个 topic 写两次会有两条。
