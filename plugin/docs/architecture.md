# 架构：官方折叠条增强层（v0.3）

> v0.2 及之前是「自有折叠条」架构（DOMProjector + MutationObserver + display:none +
> 自有 summary 行）。0.1.2 官方内置折叠后两套状态机硬冲突，v0.3 转型为官方
> `turn-process` 折叠条的增强层。旧 DOM contract（`data-dsh-ta-*`、行 key 词汇表、
> 折叠动画）全部废弃。

## 三条通道总览

```
Session 事件日志
      │  turn/start · assistant/chunk · tool/call · llm/retry · turn/end …
      ▼
[通道 1] turn-activity definition（uiConversation.events.register）
      │  每轮一个 context，activity-state.ts 状态机增量累积
      │  publication: 仅 turn/end = immediate（reasonKind/durationMs/thinkingSteps
      │  全部在 turn/end 定型，中途发布无人消费）
      ▼
buildLocationData → Turn data: ConversationTurnDataMap['turn-activity']
      │                          = { durationMs, thinkingSteps, reasonKind }
      ▼
[通道 2] FoldBarView（ctx.slots.register key='turn-process' priority=-1）
      │  shadow 官方 TurnProcessNodeView；props = PropsRuntime<'conversation.chat.node',
      │  'turn-process'> & PropsLocale<'turnActivity'>（官方 node/turnProcess/useTurnData/
      │  sessionId + 本插件 t）
      │  useTurnData('turn-activity') 读增强 face；node.data 读官方计数
      ▼
渲染：官方计数段 + 灰色增强段；点击 → turnProcess.setOpen（官方 store 回流）+ persist
      │
[通道 3] auto-load.ts（文档级 200ms 定时器）
         顶部驻留 → readSessionId() → sessions.binding(id).session.loadOlder()
```

## 挂接面（官方契约，全部在 0.1.2-alpha.1 源码核实；升级 DSH 时按此表逐项核查）

| 契约 | 位置 | 说明 |
|---|---|---|
| keyed slot `conversation.chat.node` | ui-chat contract/slots.ts | key = `ChatNodeKind`；同 key 同 priority 注册 throw，**低 priority 者胜（lowest renders）**——本插件用 `priority: -1` shadow 官方 |
| `TurnProcessOwnerProps` | 同上 | `{ spec, foldable, open, setOpen }`；`open` 是官方 chat store 的 live 状态，`setOpen` 经 `actions.setTurnProcessOpen(turn, generation, open)` 回流 |
| `useTurnData(key)` | ui-chat apply.ts CHAT_NODE_INJECT | 读**当前渲染节点所在 turn** 的 `ConversationTurnDataMap[key]`；本插件 definition 经 declaration-merge 扩展 `'turn-activity'` 键 |
| definition 注册形状 | ui-conversation `assertDefinitionTarget` | **`target` 与 `buildViewNode` 必须成对出现**（官方 register 运行时断言，二者皆缺才是 state-only 形状）——本插件 definition 只有 `buildLocationData`，必须省略 `target`；typecheck 无此约束，单独声明 `target: 'chat'` 会在 apply 时同步 throw 且控制台 load 日志已先打出（假阳性） |
| 官方折叠决策 | ChatNodeSeat | `foldable = processWindowReady && (processMember || ownsDisclosure…)`，其中 processWindowReady = `compactTranscript && answerAnchorSeq !== null && turnClosed && !historyIncomplete`；**不区分 turn/end reason** |
| 成员行隐藏 | ChatNodeSeat + searchable-hidden | `processHidden = foldable && processMember && !processOpen` → wrapper `hidden="until-found"`；`setOpen(true)` 回流即摘除；shadow renderer return null 后空 wrapper 被官方 `.flowItem:empty{display:none}` 吞掉 |
| `loadOlder` | session-controller session.ts | `session.loadOlder()`：幂等（openState/hasMore/loadingOlder 三重护栏）；**hasMore 期间官方折叠条整体禁用**（historyIncomplete）——自动加载完成后折叠才生效，属官方既定行为 |
| 类型加载 | 插件 tsconfig paths + `import type {}` | 官方 augment（SlotMap/SessionStandardProps/ConversationTurnDataMap）必须由插件**显式** `import type {} from '@deepseek-ai/dsh-client-ui-chat/client'` 等加载；paths 禁止指向任何本地 stub |

## renderer 行为表（fold-bar-view.tsx）

| 条件 | 行为 |
|---|---|
| `turnProcess === undefined` | throw（宿主 bug，官方同款） |
| `foldable === false` | `return null`——跟随官方（normal 模式内联 / 历史未齐 / 无定稿回答平铺） |
| 白名单开 && reasonKind 已知 && ≠ completed | effect 内 `setOpen(true)`（强制展开，经官方 store 回流摘 hidden）+ `return null`（不渲染条）。此形态用户无收起入口——正是「中断轮不折叠」语义 |
| 其余（foldable=true） | 渲染增强条；mount/generation 变化时若 persist 记录 `expanded` 且官方 open=false → `setOpen(true)` 恢复 |

增强 face 未就绪（`useTurnData('turn-activity')` 返回 undefined，如历史重放未到该轮
`turn/end`）时退化为纯官方文案，白名单不生效——数据缺席时不做推断。

## 持久化（persist.ts，键 `dsh.turn-collapse.v1`）

布局沿用 v0.2：`{ [sessionId]: { [turn]: 'collapsed'|'expanded' } }`，双向记录、
v0.2 老数据天然兼容。与 v0.2 的语义差异：官方默认收起（store 无条目），因此
**只有 `expanded` 记录会触发恢复动作**；`collapsed` 记录只是用户意愿的留痕。
内存缓存层（quota/隐私模式降级 no-op）原样保留。

## 状态机（activity-state.ts，与 v0.2 一致）

纯逻辑、DOM-free。每 turn 一个 context；`turn/end` 冻结
`anchorSeq/finalStepFrozen`（v0.3 停止发布这两个投影字段，但内部计算保留——改动
成本最低且是既有测试的不变量）。`summarizeActivity` 在 `end && hasFinalMessage`
前返回 null。增强 face 只消费 `durationMs`（`end.time - startTime`）、
`thinkingSteps`（reasoning-delta 步数去重计数）、`reasonKind`。

## 设置面

| localStorage 键 | 默认 | 语义 |
|---|---|---|
| `dsh.turn-collapse.autoLoad` | 开（≠'0'） | 自动加载更早历史 |
| `dsh.turn-collapse.completedOnly` | 关（==='1' 才开） | completed 白名单 |
| `dsh.turn-collapse.v1` | — | 展开决策持久化 |

官方设置 `ui-chat.transcriptView`（normal/compact）只读跟随：normal 下
`foldable` 恒 false，插件与官方都不渲染折叠条。

## 已删除资产（v0.2 → v0.3）

projector.ts / projector-core.ts / singletons.ts / synth.ts / synth-bars.ts /
animate.ts / apply-plan.ts / row-classify.ts / row-apply.ts / row-keys.ts /
row-membership.ts / scroll.ts / constants.ts / summary-view.tsx / 旧 styles.ts /
membership-persist.ts / store.ts / types.ts / fixture-entry.ts / ui-spec.md /
maintenance.md / browser-integration/（13 spec + fixtures）；以及
`src/types/dsh-client-ui-slots.d.ts`——0.1.1 时代的手写 stub，它会以 ambient
declare merge 污染官方类型面（PropsRuntime 丢 turnProcess/sessionId 的根因），
paths 指向官方产物后必须删除。
