# Codex 接入

Codex 侧的接入只需要两件事：一个 skill（告诉它何时该收束）和一个 MCP server（给它工具）。

## 1. 装 skill

```bash
node adapters/install.mjs codex          # → ~/.codex/skills/prompt-funnel
node adapters/install.mjs project        # → ./.agents/skills/prompt-funnel（只对这个项目生效）
```

装完新开一个会话，`/skills` 里能看到的 `prompt-funnel` 就是它。

## 2. 加 MCP server

`~/.codex/config.toml`：

```toml
[mcp_servers.prompt_funnel]
command = "npx"
args = ["-y", "prompt-funnel", "mcp"]
```

## 3. 验证

输入一句模糊的需求：

> 帮我写个爬虫，顺便加个代理池，再做个面板

期望看到：先给「目标 / 要求 / 待确认」，而不是直接开写。如果你说「就这样」，它应当停止追问并把最终提示词发出去。

## 没有 MCP 时

skill 里写了降级路径：用 `npx prompt-funnel gate "<文本>"` 拿判定，`npx prompt-funnel compile "<文本>"` 拿结果。这条路功能少一点（没有 spec 往返），但不需要任何配置。

## 为什么不做成 Codex 插件包

Codex 的插件目录（`.codex-plugin/plugin.json` + marketplaces）能装，但插件更适合打包「工具 + 资产 + UI」，而这个东西的核心是**行为的约定**——何时该问、问几个、不许编什么。这些写在 skill 里比写在插件清单里更直接，也更容易被别的宿主复用（DSH、Claude Code 用的是同一份 SKILL.md）。
