# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

`plugin/` 是 DSH Web 客户端插件 `@dsh-plan/turn-collapse`（V1）：模仿 Codex/ZCode 的「轮次收纳」——agent 工作时 thinking/tool/中间叙述完整流式可见；当一轮以 `turn/end` + `reason.kind === 'completed'` 且存在最终消息结束时，自动把该轮执行过程折叠为一行永久 summary（`本轮用时 X · N 次工具 · M 段思考`）+ 一条低对比度分割线，最终回答成为视觉主体。点击 summary 可展开/收起，刷新后恢复选择。

- **纯前端插件**：不改 DSH 后端/会话存储；宿主提供 `react`/`react/jsx-runtime`（external）。
- **兼容版本锁定 DSH 0.1.1-rc.2**（`@deepseek-ai/dsh-client-runtime` / `dsh-client-ui-conversation` / `dsh-session` 同版本）。DSH 版本升级必须按 `plugin/docs/maintenance.md` 的清单核查。
- 根目录 `deep-research-report.md` 是 V1 的调研与实施计划（历史文档，含决策理由）。

## 常用命令（在 `plugin/` 下执行）

```bash
npm install --ignore-scripts   # 沙箱环境必须跳过 postinstall
npm run typecheck              # tsc --noEmit
npm test                       # node --test --test-isolation=none "test/*.test.ts"
npm run build                  # powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build.ps1，产物 → lib/
```

- 跑单个测试文件：`node --test --test-isolation=none test/<name>.test.ts`（沙箱禁止 spawn，`--test-isolation=none` 必须保留）。
- 测试用 Node 内置 `node:test`（57 个用例：状态机含 step/end / llm/retry 锚点回归、归属、持久化、格式化、key 解析、final-think 标记），只测纯逻辑模块，无 DOM 测试。测试直接 import `../src/**/*.ts`（依赖 `allowImportingTsExtensions`）。
- `build.ps1` 直接调用 `esbuild.exe`/`tsc`，不走 Node `child_process.spawn`（DSH 沙箱禁止）；`lib/` 是 gitignored 的构建产物。
- 代码注释、文档、提交均用中文。

## 架构

### 两个半部

- **host 半部** `src/index.ts`：空壳插件（`apply()` 无贡献），只为 cordis 组合行存在。
- **client 半部** `src/client/index.ts`：全部功能。`inject = ['slots', 'locale', 'conversationEvents']` 声明硬依赖；`apply()` 注册节点定义、字典、`conversation.chat.node` 槽渲染器，并启动 projector 生命周期。

### 数据流（核心不变量：状态驱动，DOM 从不承担语义判断）

```
Session 事件日志 ──> ConversationNodeDefinition（turn-activity）──> 每 turn 状态
   ──> summary 节点（turn/end 时物化，anchor = min(lastActivitySeq, lastFinalizeSeq - 0.1)）
   ──> React 视图（Disclosure button + 分割线 + data-dsh-ta-* 成员事实）
   ──> CollapseStore（localStorage 'dsh.turn-collapse.v1'，唯一真相源）
   ──> DOMProjector（MutationObserver 仅脏通知 + rAF 合并 reconcile）
   ──> ScrollAnchor（非底部时按锚点行 flowTop 差补偿 scrollTop）
```

- `activity-state.ts`：纯逻辑状态机。每 turn 一个 context，由 `turn/start` 创建、`matchTurnActivity` 匹配的 8 类事件增量更新。`shouldAutoCollapse` 唯一规则：`reason.kind === 'completed'`；`summarizeActivity` 在 `end` 已到且 `hasFinalMessage` 前返回 null（纯工具/空回复 turn 不物化任何节点）。`step/end` 与 `llm/retry` 仅累加 `eventCount`、不推进 `lastActivitySeq`（它们发生在该步 `assistant/message` finalize 之后，会把锚点推越最终答案）；`lastFinalizeSeq` 记录最后一次 `assistant/message` 的 seq，由 `buildViewNode` 做 `min(lastActivitySeq, lastFinalizeSeq - 0.1)` 夹紧。
- `turn-activity.ts`：`ConversationNodeDefinition` 组装，`publication` 对 `turn/end`、`assistant/message`、`tool/call`、`tool/result` 均为 `immediate`（turn/end 之后晚到的 tool 事件需要重新物化 summary、刷新 `data-dsh-ta-tools`，否则 projector tool 分支匹配不上）；其他事件为 `none`。摘要节点 anchor = `min(lastActivitySeq, lastFinalizeSeq - 0.1)`，严格排在 final 行（closing `assistant/message` seq）之前、不影响 `turn-tail` 产物行。
- `summary-view.tsx`：首次挂载时对新鲜完成的 turn 应用一次自动折叠并记录；rehydrate 时恢复记录。向 DOM 写出 `data-dsh-ta-turn/final-step/tools/thinking/duration/session`（最后一项用于多列隔离）。
- `store.ts` + `persist.ts`：`{ [sessionId]: { [turn]: 'collapsed'|'expanded' } }`，两个状态都存（手动展开的 turn 刷新后不被 auto-collapse 覆盖）；`undefined` = 尚无决策。quota/隐私模式降级为内存态。
- `projector.ts` + `row-keys.ts`：行归属计算为纯函数。行 key = `conversationContextKey(kind, id)` 格式 `<kind.length>:<kind><id>`；只识别 `assistant-step`（id = `<turn>:<step>`，final 行**永不隐藏**）与 `tool-call`（id = callId）两种 kind，其余一律不碰（`model-retry` 等会留在展开态）。折叠 = inline `display:none` + `data-dsh-ta-collapsed` 标记，reconcile 幂等。多列时按列内 summary 的 `data-dsh-ta-session` 选 store key，避免多会话/多频道互窜。
- `styles.ts`：固定 `dsh-ta-` 类名（无 CSS module 哈希），颜色只用 DSH 设计令牌 `--dsw-alias-label-tertiary/secondary`、`--dsw-alias-border-l1/l3`，天然适配 light/dark。

### 权威文档（改代码前先读对应篇）

- `docs/architecture.md` — 状态机与 DOM contract（读入/写出属性全表）
- `docs/ui-spec.md` — CSS/UI 规范
- `docs/maintenance.md` — DSH 版本演进适配检查清单

## 关键约束

1. **折叠触发白名单制**：除 `completed` 外的一切 reason（aborted/blocked/error/max-tokens/interrupted）不自动折叠；不确定就不折叠——这是硬性产品门槛。
2. **projector 不猜语义**：finalStep/callId 等成员事实只从 summary 行的 `data-dsh-ta-*` 读回（React 渲染自引擎节点数据），绝不从 DOM 重新推导 turn 归属。同一份理由：`data-dsh-ta-session` 决定该列走哪个 store key，多列场景下也禁止回退到全局 `querySelector('[data-chat-flow]')`。
3. `src/types/dsh-client-ui-slots.d.ts` 是本地 stub：npm 上只有过时的 0.0.1-rc.1 且与依赖树冲突，运行时代码从不 import 它（esbuild 将 `@deepseek-ai/*` 全部 external）。
4. 测试保持纯逻辑风格：新逻辑放进可注入/可单测的模块（如 `projector.ts` 的纯函数、`persist.ts` 可注入 storage），不要写依赖真实 DOM 的测试。
5. **不接"非 completed"reason 的兜底**：DSH 升级若新增 reason kind，默认不折叠（保守降级；见 `plugin/docs/maintenance.md`）。新增事件类型若不在 `matchTurnActivity` 8 类白名单内，不要悄悄让它推进 `lastActivitySeq`，否则会再次把锚点推过 final 行。
