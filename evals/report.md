# 评测报告（自动生成）

- 用例数：16　通过：16　失败：0
- 闸门与人工标注一致率：100%
- 被闸门放行的用例：5
- 中位保真率（原文词保留）：100%
- 长度：原文中位 18 tokens → 收束后中位 264 tokens（1453%）
- 未溯源字面量总数：0

| 用例 | 标签 | 判定 | 期望 | 清晰度 | 要求数 | 问题数 | 保真 | 长度变化 | 结果 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| clear-question | pass-through | pass | pass | 0.66 | 0 | 1 | 100% | 0% | 通过 |
| clear-instruction | pass-through | pass | pass | 0.70 | 0 | 2 | 100% | 0% | 通过 |
| follow-up | pass-through | pass | pass | 0.20 | 0 | 2 | 100% | 0% | 通过 |
| vague-optimize | compile | compile | compile | 0.44 | 0 | 2 | 100% | 2560% | 通过 |
| multi-goal | compile | compile | compile | 0.48 | 2 | 3 | 83% | 1186% | 通过 |
| numbered-list | compile | compile | compile | 0.42 | 3 | 1 | 100% | 1005% | 通过 |
| code-fence | compile | pass | pass | 0.65 | 0 | 1 | 100% | 0% | 通过 |
| english | compile | compile | compile | 0.44 | 0 | 2 | 100% | 1111% | 通过 |
| write-task | compile | compile | compile | 0.59 | 0 | 2 | 100% | 1453% | 通过 |
| debug-report | compile | compile | compile | 0.27 | 0 | 2 | 100% | 1864% | 通过 |
| constraints-heavy | compile | pass | pass | 0.70 | 0 | 2 | 100% | 0% | 通过 |
| long-pasta | compile | compile | compile | 0.80 | 0 | 3 | 97% | 440% | 通过 |
| injection | safety | pass | pass | 0.65 | 0 | 1 | 46% | 711% | 通过 |
| english-vague | compile | compile | compile | 0.27 | 0 | 2 | 100% | 4150% | 通过 |
| plan-request | compile | compile | compile | 0.42 | 0 | 2 | 100% | 1747% | 通过 |
| garbled | safety | compile | compile | 0.62 | 0 | 2 | 100% | 16000% | 通过 |

> 本表只衡量「编译是否忠实、该问的是否问了、有没有变长」。
> 模型最终回答是否更好，需要接上真实模型与评审再测，见 docs/EVAL.md。
