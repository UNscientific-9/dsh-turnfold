# 代码审查报告 — 2026-08-26

- 范围：`plugin/src/client/{projector,summary-view,turn-activity,activity-state,persist}.ts(x)` + `plugin/test/projector.test.ts`
- 触发方式：`/code-review` 子代理
- 状态：发现已记录，**未做修改**；待用户确认修复顺序

## 严重度统计

| 级别 | 数量 | 含义 |
|------|------|------|
| 🔴 CRITICAL | 1 | 已有 bug，影响用户可见行为 |
| 🟠 HIGH | 1 | 时序 / 竞态，可能被触发 |
| 🟡 MEDIUM | 7 | 性能 / 正确性隐患 |
| 🔵 LOW | 4 | 代码质量 / 文档漂移 |

---

## 🔴 C-1 `applyTurnCollapse` 跨列错位

- 文件：`plugin/src/client/projector.ts:440-468`
- 子代理结论：`document.querySelector` 拿全文档第一行 → 多列时把别列当本列处理；rAF reconcile 要一帧才纠正，视觉闪烁 + scroll 错位。

**复核注**：实际代码为

```ts
const summaryRow = document.querySelector<HTMLElement>(`[${DATA_TURN}="${turn}"]`);
let column: HTMLElement | null = null;
if (summaryRow !== null) {
  column = summaryRow.closest<HTMLElement>('[data-chat-flow]');
}
if (column === null) {
  column = document.querySelector<HTMLElement>('[data-chat-flow]');
}
```

happy path 走的是 `summaryRow.closest('[data-chat-flow]')`，已经按列作用域定位；子代理声称的「用 querySelector 拿第一行」只在**未挂载的 fallback**（第 454-456 行）成立。结论里**多列错位属实但被夸大**：仅当 summary 行未渲染就触发 `applyTurnCollapse` 时会拿到首个 `[data-chat-flow]`。

**待办**：
1. 决定 fallback 是否在多列宿主下要改成「按 caller session 在所有列里二分」
2. 若改：补 `applyTurnCollapse` 多列单测（见 T-1）

---

## 🟠 H-1 `useEffect` rAF 闭包竞态

- 文件：`plugin/src/client/summary-view.tsx:94-113`

```ts
useEffect(() => {
  ...
  let decision = store.getCollapsed(sessionId, summary.turn);
  if (decision === undefined && shouldAutoCollapse(summary)) {
    store.setCollapsed(sessionId, summary.turn, 'collapsed');
    decision = 'collapsed';
  }
  if (decision !== undefined) {
    projector.applyTurnCollapse(sessionId, summary.turn, decision === 'collapsed');
    requestAnimationFrame(() => {
      projector.applyTurnCollapse(sessionId, summary.turn, decision === 'collapsed');
    });
  }
}, [sessionId, summary]);
```

- 子代理结论：rAF 闭包捕获 effect 当时的 `decision`，用户点击后旧 rAF 仍用旧值写回。
- 触发场景：自动折叠触发的 rAF 还在排队 → 用户立刻点 `expanded` → store 已写 `expanded`，但旧 rAF 用 `'collapsed'` 覆盖回去。
- 修复方向：用 ref 记录最新 decision，或在 rAF 回调内重新 `store.getCollapsed(...)` 后再写。

**待办**：
- 修法二选一前先确认 `applyTurnCollapse` 自身的幂等性是否需要新参数（避免重复补偿 scrollTop）

---

## 🟡 MEDIUM

### M-1 `attributeFilter` 自相矛盾

- `plugin/src/client/projector.ts:416`
- `attributeFilter: ['class', 'data-chat-anchor-key', 'data-chat-flow-kind', 'data-dsh-ta-collapsed']`
- 同函数上文（406-411 行）注释明确说「observing our own writes would schedule a redundant rAF reconcile」并把 `data-dsh-ta-collapsed` 排除。
- 修复：从 filter 里删掉 `data-dsh-ta-collapsed`；同时核对其它 6 个 membership 属性是否漏列（`data-dsh-ta-turn / final-step / tools / thinking / session`）。

### M-2 `tool/call` / `tool/result` 立即重发布

- `plugin/src/client/turn-activity.ts:89-99`
- 长工具链场景下一次 turn 内可能触发百次重发布。
- 注释（76-88 行）只解释了「late tool/call after turn/end」的合理性，**没有**解释 turn 内 `tool/call` 也走 immediate 的必要性。
- 修复方向：turn/end 之前 `tool/call` 应返回 `none`（`buildViewNode` 已返回 null，注释自陈是 no-op），仅保留 `turn/end` 之后的 `tool/call` 走 immediate。

### M-3 `persistence.read()` 每次全量 JSON.parse

- `plugin/src/client/persist.ts:26-36`
- 每次订阅通知都重读 + 重 parse 全表。
- 修复：模块内 `let cache: { raw: string | null, map: PersistedMap }`，`write` 时清缓存，`read` 命中 `raw` 相同就复用。

### M-4 `pushUnique` O(N²)

- `plugin/src/client/activity-state.ts:119-121`
- 工具链长时每次插入都 `Array.includes` 扫描。
- 修复：`Set` 内部表示 + 暴露时回转数组，或在 `updateTurnActivityState` 内聚合去重。

### M-5 MutationObserver + applyAll 全列遍历 = 60 次/帧

- `plugin/src/client/projector.ts` (observer 监听 `document.body, subtree: true`) + `applyAll`
- 任意节点变动都触发全列 `computeRowTargets`，N 列 × M 行。
- 修复方向：observer 回调只标记脏列，rAF reconcile 时只对脏列跑 `applyColumn`；非脏列跳过。

### M-6 `findScrollableAncestor` 触发 layout thrashing

- `plugin/src/client/projector.ts:190` 附近
- 逐级 `getComputedStyle` walk，每帧多次强制 layout。
- 修复：缓存上一次结果 + 失效条件（元素 detached / 父链变化）；或离线测量。

### M-7 `pickColumnSessionId` null + `setSession` 未到 → 列被 skip

- `plugin/src/client/projector.ts:298` 附近
- 列未带 `data-dsh-column-session-id` 且 `projector.setSession` 未到 → `continue`，导致该列永远不被 apply。
- 修复：要么把「未识别列」按「未挂载」处理走 fallback，要么补 diagnostic 标记让宿主能发现。

### M-8 `setSession` 依赖进 effect deps → 多列互相覆盖

- `plugin/src/client/summary-view.tsx:97`
- 同一帧内两个 summary 节点 mount 都会调 `projector.setSession`，后写者覆盖前者。
- 修复：与 H-1 一起处理——把 `setSession` 放进 rAF 合并或仅在 column 已定位时调用。

---

## 🔵 LOW

| # | 位置 | 问题 |
|---|------|------|
| L-1 | `plugin/src/client/turn-activity.ts:57` | anchor clamp `- 0.1` 跨 turn 时可能落进上一 turn 窗口 |
| L-2 | `plugin/src/client/projector.ts:380` 附近 | debug 分支重复调 `computeRowTargets`（同一帧两次） |
| L-3 | `plugin/test/projector.test.ts` | 多列隔离逻辑无测试覆盖（与 C-1 同源） |
| L-4 | `plugin/docs/architecture.md:14` | 「publication: 仅 turn/end 为 immediate」与实际代码（`tool/call`/`tool/result` 也走 immediate）不一致 |

---

## T 测试缺口

- T-1 `applyAll` / `applyTurnCollapse` 多列场景（happy path + fallback）
- T-2 `collectSummaries` sessionId 解析的负向路径（多列同 turn、缺属性）
- T-3 `pickColumnSessionId` null 时的列处理
- T-4 折叠状态 store 改变 → projector reconcile 的端到端（mock MutationObserver 触发）
- T-5 `useSyncExternalStore` + rAF 时序（点击 vs 自动折叠竞态，H-1 配套）

---

## 建议修复顺序

1. **T-1 补测试**（5 个用例）→ 锁定多列预期，否则 C-1 修完仍可能回归
2. **C-1** 改 fallback 路径 + 补正子代理夸大部分
3. **H-1 + M-8** 一起修（同一 useEffect 内的两处闭包问题）
4. **M-1 + M-2** 修属性 filter / publication 真值表
5. **L-4** 同步 `docs/architecture.md`（M-2 改完顺手更新）
6. **M-3 ~ M-7** 按性能收益排期
7. **L-1 ~ L-3** 顺手

每个步骤都跑 `npm run typecheck && npm test` 验证。

---

## 复核注汇总

| 编号 | 复核原因 | 建议动作 |
|------|----------|----------|
| C-1 | 子代理对 `closest` 作用域似乎未读全，结论被夸大 | 读 `applyTurnCollapse` 全文后重判 |
| M-1 | 需核对 6 个 membership 属性的实际白名单 | grep `DATA_TURN / FINAL_STEP / ...` 全集再补 filter |
| M-2 | 改动会改变 publication 行为 | 翻 `docs/architecture.md` 与 `deep-research-report.md` 的历史决策 |
