# Contributing

English | [中文](#贡献指南)

Contributions are welcome. This is a small, focused plugin, so a little coordination up front saves everyone time.

## Before you write code

**Open an issue first** for anything beyond a typo or an obvious bug fix — a new tool, a config field, a behavior change, a new dependency. A short description of the problem you hit is enough. It avoids the case where a finished PR turns out to conflict with the plugin's design.

Bug reports are always welcome without an issue-first discussion: include your OS, Node version, browser channel, the plugin config you used, and what the agent did versus what you expected.

## Pull requests

- Base on `main`; keep one PR to one concern.
- `corepack pnpm install && corepack pnpm run build` must pass (CI checks this).
- Say in the PR body **what you changed and how you verified it** — a real run against a real page beats "looks right". Screenshots or the agent transcript are ideal.
- Match the surrounding code: named exports only (no default export in this plugin), every tunable is a `Config` field rather than a constant, every registration goes through `ctx.effect` / `ctx.on` so unloading unwinds it, and tool presenters stay pure functions of their arguments.
- New model-facing text (tool descriptions, error messages) is part of the interface: write it for the model, state what to do next, and keep it terse.

## Security

Do not open a public issue for a security problem (sandbox escape, credential exposure, audit-rule bypass or credential exposure). Use GitHub's private vulnerability reporting on this repository instead.

---

# 贡献指南

欢迎贡献。这是一个小而专注的插件，动手前稍作沟通能省下双方的时间。

## 写代码之前

除了错别字和显而易见的 bug 修复，**请先开一个 issue**——新工具、新配置项、行为变更、新依赖都算。简单描述你遇到的问题即可，避免辛苦写完的 PR 与插件设计冲突。

Bug 报告随时欢迎，不需要先讨论：请附上操作系统、Node 版本、浏览器渠道、你使用的插件配置，以及 agent 实际行为与你的预期。

## 提交 PR

- 基于 `main`；一个 PR 只做一件事。
- 必须能通过 `corepack pnpm install && corepack pnpm run build`（CI 会检查）。
- 在 PR 描述里说明**你改了什么、如何验证的**——真实页面上的实跑远胜过"看着没问题"，附截图或 agent 对话记录最佳。
- 与现有代码保持一致：只用具名导出（本插件没有 default export）、可调项一律做成 `Config` 字段而非常量、所有注册走 `ctx.effect` / `ctx.on` 以便卸载时自动回收、工具的展示函数保持为参数的纯函数。
- 面向模型的文本（工具描述、错误信息）属于接口的一部分：为模型而写，说清下一步该做什么，保持简洁。

## 安全问题

请**不要**为安全问题（沙箱逃逸、凭证泄漏、审计规则绕过、凭证泄漏）开公开 issue，改用本仓库的 GitHub 私密漏洞报告功能。
