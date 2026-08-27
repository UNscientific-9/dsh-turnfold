# DSH 版本演进适配指南

本插件只依赖一小撮**已文档化的结构化接口**，并把 DOM 依赖面压到最小。升级 DSH
（或改 Web 组合）时按此清单核查；全部通过即可继续工作，任一失败按“保守降级”
处理（见文末）。

## 依赖的接口（全部在 DSH 0.1.1-rc.2 源码核实）

### 1. 会话事件（`@deepseek-ai/dsh-session`）

- `turn/start`、`turn/end`（`data.reason.kind`）、`step/start`、`step/end`
- `assistant/chunk`（`data.chunk.type`，`reasoning-delta` 用于思考段计数）、`assistant/message`（`data.step`、`interrupted`）
- `tool/call`、`tool/result`（`data.turn`、`data.callId`）
- `llm/retry`（`data.turn`）

适配检查：grep `TurnEndReasonMap`，确认 `completed` 仍是正常完成语义；若新增
reason kind，需决定是否纳入“不折叠”集合（默认：除 `completed` 外全部不折叠，天然安全）。

### 2. Conversation 节点系统（`@deepseek-ai/dsh-client-runtime` / `dsh-client-ui-conversation`）

- `ctx.conversationEvents.register(definition)`：`match/start/update/publication/buildLocationData/buildViewNode`
- `ConversationMatch` 携带 `event.seq`、`event.time`、`location`
- `conversationContextKey(kind, id)` = `<kind.length>:<kind><id>`（行 key 解析依赖此格式）

适配检查：`contract/conversation.d.ts` 的 `ConversationNodeDefinition` 若改签名，
更新 `src/client/turn-activity.ts`；`conversationContextKey` 格式若变，更新
`src/client/row-keys.ts` 的解析器（有单测覆盖）。

### 3. Chat 行 DOM

- 行根 `[data-chat-anchor-key]`（值 = 上述 key）、`[data-chat-flow-kind]`
- 容器 `[data-chat-flow]`；滚动容器 `[data-conversation-scroll]`
- 行内思考块 root `[data-variant="think"]`（ReasoningRow，assistant-step 行
  内部；折叠轮次的 final 行靠它隐藏思考摘要，见 `architecture.md` 决策 11）

适配检查：若 `ChatNodeSeat` 移除这些属性（改用其他定位方式），先给行打上
`data-dsh-ta-*` 标记不可行（那是 React 域），应改为在节点 data 中发布成员事实并
通过 `useSession` 读取——`projector.ts` 的 `collectSummaries` 是唯一读取点，集中修改。
若 `data-variant="think"` 改名/移除（ReasoningRow 重构），折叠态 final 行会重新
露出思考摘要——检查 `styles.ts` 的
`[data-dsh-ta-final-collapsed="true"] [data-variant="think"]` 规则是否仍生效。

### 4. 样式令牌

- `--dsw-alias-label-tertiary`、`--dsw-alias-label-secondary`、`--dsw-alias-border-l1/l3`

适配检查：token 改名时更新 `styles.ts` 一处即可。

## 运行时降级策略

“不确定就不自动折叠”是本插件的保守基线：

- 新 reason kind → 不折叠（白名单制）
- 行 key 解析失败 → 该行视为 `other`（不触碰）
- `collectSummaries` 读不到 `data-dsh-ta-*` → 该 turn 不折叠
- 任何异常都只是“少折叠”，绝不误隐藏 final / 用户消息 / 异常行

## 回归建议

- `npm test`（57 用例：状态机、行归属、持久化、格式化、final-think 标记）
- 手测矩阵（见 `../README.md` 行为规则表）：正常成功、tool error、用户 Stop、
  approval waiting、空 final、刷新恢复、窄窗口、light/dark、键盘操作、
  50+/100+ 行长 turn。
