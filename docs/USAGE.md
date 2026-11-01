# 用法

## 安装

```bash
# 不安装，直接跑
npx prompt-funnel gate "帮我优化一下这个东西"

# 或装到全局
pnpm add -g prompt-funnel
npm i -g prompt-funnel

# 还没发到 npm 时，也可以直接从仓库装（会自动构建）
npm i -g github:sanyin/prompt-funnel
```

要求 Node ≥ 22。**零运行时依赖**，不联网也能用（规则引擎）。

## 30 秒上手

```bash
$ funnel gate "帮我写一个爬虫，同时加上代理池，另外再做一个可视化面板"
compile  score=0.48  intent=execute
  goal         1.00
  deliverable  0.25
  ...
  · 检测到 3 个并列任务，放在一轮里会互相稀释
  · 加权清晰度 0.48 低于阈值 0.62，值得先收束
```

```bash
$ funnel review "帮我写一个爬虫，同时加上代理池，另外再做一个可视化面板"
```

`review` 是主入口：它把收束结果打出来，然后等你按键。

```
[回车] 采用并输出  ·  [e] 编辑  ·  [r] 给意见重做  ·  [d] 看差异  ·  [s] 换排版  ·  [q] 退出
```

- `e` 打开 `$EDITOR`，改完保存即生效（不再经过任何模型）
- `d` 看原文与收束结果的逐行差异
- `r` 给一句意见（「太长了」「要更严格」）；规则引擎只调结构，会明确告诉你它做了什么
- `s` 在三种排版间切换：`bluf`（默认）/ `compact` / `checklist`
- 回车：接受，输出到 stdout，同时写入 `.funnel/last.md`

## 三种用法

### 1. 终端

```bash
funnel compile "把 src/app.ts 的并发改成 8"        # 输出提示词
funnel compile "..." --json                        # 输出 spec，便于自己改
cat prompt.txt | funnel compile --style compact    # 从管道读
funnel review "$(cat prompt.txt)"                  # 交互式
```

诊断信息一律走 stderr，所以可以直接接管道：

```bash
funnel compile "..." | pbcopy        # macOS
funnel compile "..." | clip          # Windows
funnel compile "..." | xclip -sel c  # Linux
```

### 2. 任何 agent（MCP）

```bash
funnel mcp        # 装了全局之后
funnel-mcp        # 独立可执行文件
```

通用的 MCP 客户端配置：

```json
{
  "mcpServers": {
    "prompt-funnel": {
      "command": "npx",
      "args": ["-y", "prompt-funnel", "mcp"]
    }
  }
}
```

暴露四个工具：

| 工具 | 用途 | 成本 |
| --- | --- | --- |
| `funnel_gate` | 判定要不要收束 | 纯本地，< 1ms |
| `funnel_analyze` | 产出 spec + 给用户看的 review 摘要 | 纯本地 |
| `funnel_render` | 校验并把 spec 渲染成最终提示词 | 纯本地 |
| `funnel_compile` | 一次搞定（有 key 时可用 API 引擎） | 可选一次模型调用 |

推荐流程是 `analyze → 用户改 → render`：语义工作由**宿主自己的模型**完成，不需要第二个 API key，也不额外花 token。

### 3. 装成 skill（Codex / DSH / Claude Code）

```bash
node adapters/install.mjs codex     # → ~/.codex/skills/prompt-funnel
node adapters/install.mjs dsh       # → ~/.dsh/skills/prompt-funnel
node adapters/install.mjs claude    # → ~/.claude/skills/prompt-funnel
node adapters/install.mjs project   # → ./.agents/skills/prompt-funnel
```

skill 里写清了「什么时候触发、循环怎么走、哪些事不许做」。没有 MCP 工具时，它会退化成调用 CLI 或纯手工规则。

## CLI 参考

```
funnel compile "<请求>"     收束并输出提示词
funnel review  "<请求>"     交互式收束
funnel refine  "<意见>"     对上一次的 spec 定点改一处，其余不动
funnel gate    "<请求>"     只看判定，不生成
funnel render  [spec.json]  从已有 spec 重新渲染
funnel config  [show|set]   查看 / 修改配置
funnel mcp                  启动 MCP server
funnel hook                 Claude Code 钩子入口（读 stdin）
```

### 单点修改：`refine`

收束过一次之后，最多余的动作是「第 2 点改成先做爬虫」——重跑分析会把已经谈好的部分全洗牌。`refine` 只改你指的那一处：

```bash
funnel refine "第 2 点改成先做爬虫骨架"
funnel refine "第 3 条删掉"
funnel refine "再加一条：支持断点续传"
funnel refine "目标改成先跑通最小可用版本"
funnel refine "限制在 500 字以内"
funnel refine "别动导出接口"        # 进「不要做」
funnel refine "..." --dry          # 只看会改什么，不落盘
```

改完会重跑一次保真校验。**你在意见里新写的数字、路径不算编造**——它们也是你的输入，会被记进 `meta.note` 作为允许来源。

支持的形式列在 `REFINE_FORMS` 里；看不懂时它直接列给你，不会猜。

### 网页版

```bash
npm run playground     # 构建 site/ 并在 http://127.0.0.1:8080 起服务
```

页面直接 `import` 编译后的 `dist/` 模块——核心模块不碰 `node:`，所以不需要打包器，也不用联网。同一份代码，不是复制品。

| 参数 | 说明 |
| --- | --- |
| `--style bluf\|compact\|checklist` | 排版 |
| `--engine auto\|rules\|api\|host` | `auto` = 有 key 走 API，否则规则 |
| `--force` | 闸门放行时也强制收束 |
| `--keep-original auto\|on\|off` | 是否在末尾附原文（默认 auto：有假设/锚点时附） |
| `--json` | 输出 spec 而不是提示词 |
| `--out <file>` | 写入文件 |
| `-f, --file <path>` | 从文件读请求 |
| `--note "<意见>"` | 改写意见（API 引擎会用它） |

退出码：`0` 成功；`1` 保真校验有 error（可接 CI）；`2` 用法错误；`130` 用户取消。

## 配置

```bash
funnel config show
funnel config set engine api
funnel config set api.baseUrl https://api.deepseek.com/v1
funnel config set api.model deepseek-chat
```

配置写在 `~/.funnel/config.json`。环境变量优先：

| 变量 | 作用 |
| --- | --- |
| `FUNNEL_API_KEY` / `DEEPSEEK_API_KEY` / `OPENAI_API_KEY` | API 引擎的 key（任一） |
| `FUNNEL_API_BASE` | OpenAI 兼容端点，默认 `https://api.deepseek.com/v1` |
| `FUNNEL_MODEL` | 模型名，默认 `deepseek-chat` |
| `FUNNEL_ENGINE` / `FUNNEL_STYLE` | 覆盖默认引擎 / 排版 |
| `FUNNEL_HOME` / `FUNNEL_CONFIG` | 状态目录与配置文件位置 |
| `NO_COLOR` | 关闭颜色 |

## 接入 DSH

1. 装 skill：`node adapters/install.mjs dsh`（或放到项目的 `.agents/skills/`、`.dsh/skills/`）。
2. 在 profile 的 `cordis.yml` 里加一个 MCP 条目，`transport: stdio`，`command: npx`，`args: ["-y", "prompt-funnel", "mcp"]`。
3. 重启 DSH，问一句模糊的需求，看它是否先给出「目标 / 假设 / 待确认」。

## 接入 Codex

1. 装 skill：`node adapters/install.mjs codex`。
2. 在 `~/.codex/config.toml` 里加 MCP server：

```toml
[mcp_servers.prompt_funnel]
command = "npx"
args = ["-y", "prompt-funnel", "mcp"]
```

3. 新会话里输入「帮我把这个需求整理成提示词」。

## 接入 Claude Code

Claude Code 有公开的 `UserPromptSubmit` 钩子，是唯一能在「发送前」真正介入的宿主。

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [ { "type": "command", "command": "funnel hook", "timeout": 10 } ] }
    ]
  }
}
```

写进 `~/.claude/settings.json`。默认 `advisory`（只附加结构，不拦人），`--mode block` 才会拦。细节和限制见 [adapters/claude-code](../adapters/claude-code/README.md)。

## 常见问题

**为什么它经常什么都不改？**
因为大部分请求本来就清楚。这是设计目标，不是 bug：闸门判定 `pass` 时，输出与输入**逐字节相同**。想强制收束用 `--force`。

**为什么它不润色我的话？**
规则引擎是抽取式的——只分组、编号、排序、标注。改写是编造的主要来源。需要语义级改写时接 API 引擎，它的输出仍要过保真校验。

**为什么我的数字被标红了？**
输出里出现了原文没有的数字/路径/URL。要么是编译错了，要么是你自己编辑时加的（那就可以忽略）。数字被当作 error 而非 warning，是为了让 CI 能拦住「看起来很专业」的幻觉。

**`.funnel/` 要不要提交？**
不要，已经在 `.gitignore` 里。它是每次编译的草稿状态（`last.json` + `last.md`）。
