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

### 开合动画（fold-animate.ts，WAAPI 驱动）

时序论证与防闪帧策略见该文件头注释。要点：展开方向微任务首测在 paint 前压 0 + 隐身；
收起方向首帧同步测量。成员行不是唯一动画目标——open 翻转的官方提交还会瞬时改一批
**伴生行**的几何（真机逐帧实证的抽动源，成员行动画本身平滑）：

- 折叠条 closed 态 `margin-bottom: 8px`（本插件 `.dsh-tf-bar:not([data-open])` 规则）会把
  bar 与 answer 之间的行（如 system-prompt）**净推下 8px**——官方补偿几何只对冲 answer
  行自身的 margin-top（16→8），夹层行无人补偿；
- answer 行内容随 open 重渲染，自身高度瞬间 ±40px（compactAnswer 形态差来自 React 内容
  而非 CSS 属性——真机验证挂 `data-turn-process-answer` 属性高度不变，动画前测不到终值）。

对策（`FoldRowPlan` 伴生机制，全部实测值、无硬编码）：

1. **bar 伴生**：收起时随主动画 WAAPI 渐变到 closed 值（终值由同同步块临时摘
   `data-open` 实测），夹层行被平滑推下，提交帧官方值与动画终值一致；展开反向同理。
2. **answer 伴生（主段）**：margin-top 渐变到 compact 值（同同步块临时挂
   `data-turn-process-answer` 实测）；高度差动画前未知，主段不动 height。
3. **flip**：collapse 主动画剩 ~70ms 时触发 `onFlip`（视图 `setOpen(false)`）——官方
   提交（hidden 挂载 / 补偿几何 / answer 形态）全部落在动画窗口内，hidden 挂上时成员
   行 opacity 已近 0。flip 未触发则 settle 兜底补发（幂等）。
4. **answer 追赶**：compact 形态由官方组件在 flip 提交**之后**的自有更新里落地（真机
   实测滞后 ~80ms，flip 的 layout effect 时高度差尚未显现），故用 `ResizeObserver`
   在变化帧的渲染步骤（paint 前）回调里启动追赶 WAAPI（`animateCompanionCatchUp`），
   从 flip 前实测值平滑覆盖到提交后实测值，不露出突变帧。
5. **settle 分流**：flip 已落地（成员行已 hidden）则直接清全部样式；仅 hidden 未落地
   的极端慢提交才钉住 0 高，由视图 `clearPinnedRows` 宏任务兜底清理。

answer 行内的内容异步物化（如长文渲染完成的 24px 二段增高）属官方原生加载节奏，不在此
拦截范围。快速连点：`Animation.reverse()` 原地反转（含伴生行）；flip 已触发后反转回
expand 由视图在完成回调补 `setOpen(true)`。展开 settle 清样式回归自然布局。宿主行间距
是 `.column` 的兄弟选择器 `margin-top: var(--dsh-chat-flow-gap)`（非 flex gap），行自身
无 margin-bottom，动画只需覆盖成员行自身的 margin-top。

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
