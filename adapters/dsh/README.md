# DSH 接入

DSH 会从四个位置发现 skill：项目里的 `.dsh/skills`、`.agents/skills`，和用户主目录下的 `~/.dsh/skills`、`~/.agents/skills`。

## 1. 装 skill

```bash
node adapters/install.mjs dsh        # → ~/.dsh/skills/prompt-funnel
node adapters/install.mjs project    # → ./.agents/skills/prompt-funnel
```

## 2. 加 MCP server

在 profile 的 `cordis.yml` 里加一个 MCP client 条目（`transport: stdio`）：

```yaml
plugins:
  "@deepseek-ai/dsh-mcp-client":
    transport: stdio
    command: npx
    args: ["-y", "prompt-funnel", "mcp"]
```

字段名以你本机的 DSH 版本为准；核心是 `transport: stdio` + `command: npx` + `args: ["-y", "prompt-funnel", "mcp"]` 这三项。

## 3. 验证

```
/prompt-funnel 帮我把这个需求整理一下：给登录页加个验证码
```

或直接输入模糊需求，看它是否先给「目标 / 假设 / 待确认」，再等你确认。

## 为什么不直接做输入框插件

体验上最理想的是在发送前就地弹一个可编辑的收束面板。这需要 DSH 前端插件运行时的 `__ModuleLoader__` 打包格式与对应构建工具，属于宿主的内部契约，改动会破坏兼容性。

所以 v1 选择了 MCP + skill：**今天就能用**，且同一份 skill 在 Codex、Claude Code 上通用。等宿主提供稳定的「发送前钩子」再补 UI，届时只需要把 `funnel_analyze` / `funnel_render` 挂到那个钩子上——内核不用动。
