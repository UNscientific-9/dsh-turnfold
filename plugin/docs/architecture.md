# 架构：状态机与 DOM contract

## 数据流总览

```
Session 事件日志 (dsh-session)
      │  turn/start · step/start · assistant/chunk · tool/call · tool/result
      │  assistant/message · llm/retry · turn/end
      ▼
ConversationEventRegistry ── register(turnActivityDefinition) ──┐
      │  (engine 逐事件调用 match/start/update)                   │
      ▼                                                          │
TurnActivityState（每个 turn 一个 context）                        │
      │  publication: turn/end · assistant/message · tool/call · tool/result
      │  · llm/retry 为 immediate（tool/retry 事件在 turn/end 后晚到时需重物化
      │  刷新工具/重试快照），其余 none  │
      ▼                                                          │
buildLocationData → turn 级 'turn-activity' 数据                    │
buildViewNode    → chat 节点行（turn/end 后物化，anchor=firstActivitySeq-0.5）│
      │                                                          │
      ▼                                                          │
React: summary-view.tsx（Disclosure button + divider + data-dsh-ta-*）│
      │  useEffect：auto-collapse 判定 / 恢复记录 / setSession      │
      ▼                                                          │
CollapseStore（localStorage 持久化，subscribe）                      │
      │  变更通知                                                   │
      ▼                                                          │
DOMProjector（rAF 合并 + MutationObserver 仅做脏通知）◄──────────────┘
      │  行归属（computeRowTargets，纯函数）→ data-dsh-ta-collapsed 标记
      │  用户 toggle：height/opacity 过渡动画（dsh-ta-animating）+ 定位轮次顶部
      ▼
ScrollAnchor（用户 toggle：展开定位到该轮第一个活动行、折叠定位到 summary 行；
             自动折叠/背景 reconcile：展开时保持锚点行视口位置、折叠时不补偿、
             仅当视口内无可视行时回正；at-bottom 交给 DSH follow）
```

## 状态机

```
                 turn/start                  turn/end (completed)     用户点击 / 恢复
  (无节点) ──────────────────► RUNNING ─────────────────────► SETTLED ──────────► COLLAPSED
                              (活动流式可见)    (summary 物化)         ◄──────────────┘
                                                                      用户点击
  turn/end (aborted/blocked/error/max-tokens/interrupted) ──────────► SETTLED（保持展开）
  无 assistant/message ─────────────────────────────────────────────► （无节点，不干预）
```

- `RUNNING`：context 存在但 `buildViewNode` 返回 null——DOM 无任何痕迹。
- `SETTLED`：summary 行物化；`shouldAutoCollapse` 唯一规则为 `reason.kind === 'completed'`。
- `COLLAPSED`/`EXPANDED`：store 三态（`collapsed` / `expanded` / 无记录）持久化于
  `localStorage['dsh.turn-collapse.v1']`，刷新恢复。

## DOM contract

### 读入（依赖的宿主 DOM，均已在 DSH 0.1.1-rc.2 源码核实）

| 选择器 | 语义 | 来源 |
|---|---|---|
| `[data-chat-flow]` | 会话流列表容器 | ChatView column（ui-conversation `ChatView`） |
| `[data-conversation-scroll]` | 滚动容器 | 同上 `scrollerOf` |
| `[data-chat-anchor-key]` | 每个节点的行 | `ChatNodeSeat`，值 = `conversationContextKey(kind, id)` |
| `[data-chat-flow-kind]` | 行节点 kind | 同上 |

行 key 格式（`@deepseek-ai/dsh-client-runtime` `conversationContextKey`）：
`<kind.length>:<kind><id>`。本插件解析 `assistant-step`（id=`<turn>:<step>`）与
`tool-call`（id=callId）两种 kind；其余 kind 一律不触碰。

### 写出（插件自有，互不冲突）

| 位置 | 属性/类 | 含义 |
|---|---|---|
| summary 行根 | `data-dsh-ta-turn` / `data-dsh-ta-final-step` / `data-dsh-ta-tools`（逗号分隔 callId）/ `data-dsh-ta-thinking` / `data-dsh-ta-duration` | 成员事实（projector 读取，避免二次语义推断） |
| activity 行 | `data-dsh-ta-collapsed="true"` + `style.display:none` | 折叠标记；React 重渲染/行重建后由 reconcile 幂等重应用 |
| final 行（折叠轮） | `data-dsh-ta-final-collapsed="true"` | 该轮折叠时标记其最终回答行，CSS 隐藏行内 Think 块（`data-variant="think"`，见 `maintenance.md`）；展开清除 |
| `<head>` | `<style data-plugin-css="@dsh-plan/turn-collapse/styles">` | 插件样式（幂等注入） |

## 关键设计决策

1. **触发信号用 `turn/end.reason` 而非 final-start 猜测**：DSH 是 step 级 assistant，
   一个 turn 可有多步；只有 `turn/end` 才能确定"最后一步"。“final 开始即收起”的
   Codex 式体验在 V1 以“final 完成即收起”实现（turn/end 与最后 `assistant/message`
   在同一帧前后到达，视觉差异可忽略），换来 final 误折叠率 0。
2. **summary 锚点 = `firstActivitySeq - 0.5`，在 `turn/end` 时冻结一次**：
   **折叠框固定在轮次顶部**——用户/上下文消息之后、第一个活动行之前。
   `firstActivitySeq` 只统计**产生可见行**的活动事件（`assistant/chunk` /
   `assistant/message` / `tool/call` / `tool/result` / `llm/retry`），
   **排除 `step/start`**——它不渲染任何行，且 DSH 的真实事件序是
   `turn/start → step/start(step=0, pre-step) → user/message`（排队输入的
   `user/message` 在"进入 step"时才落日志，dsh-session 类型文档与真机
   DOM 双重证实：被窗口切开的轮 5 首个可见行是 `assistant-step5:1`）。
   把 `step/start` 计入会把锚点拉到用户消息**之前**，折叠框渲染到上一轮
   末尾（v0.1.1 真机 bug）。锚点只冻结一次（turn/end）；之后的迟到事件
   重新物化 summary 时只刷新成员事实，不移动锚点。
3. **行归属只信任引擎数据**：finalStep/callId/retryId 全部来自节点数据（经
   `data-dsh-ta-*` 转交），projector 不猜。`finalStep` 同样在 turn/end 冻结：
   最后消息之后还有工具活动时，该消息只是中间步骤而非最终答案，
   `data-dsh-ta-final-step` 为空，折叠时所有活动行（含该消息行）都可隐藏。
4. **MutationObserver 只做脏通知**：`rAF` 合并 reconcile，`applyAll` 幂等
   （重复调用无副作用、无重复 summary/分割线）。**背景 reconcile（store 通知 /
   DOM 变更）从不做滚动补偿**——补偿只发生在用户 toggle 与 summary 挂载的
   `applyTurnCollapse`，且只作用于自己那一列；对视野外 turn 的补偿正是旧版
   “页面跳到最上方”的根源。
5. **滚动稳定（自动折叠/背景路径）**：展开（纯 unhide）时保持锚点行（视口
   顶部首个非变更行）的视口位置，同步测量+补偿（无 rAF 竞态）；折叠/混合时
   不改 `scrollTop`（视口自然呈现折叠后的状态），仅当折叠把视口内可见行全部
   移除时，才把第一个剩余可见行拉到视口顶部（clamp 到 `[0, maxScroll]`，
   杜绝大负补偿导致的跳顶）；底部（≤25px 阈值）时交给 DSH 自带 follow 逻辑
   （避免与它打架造成跳底/留白）。
6. **用户 toggle = 纯动画、零滚动**（V1.2）：点击展开/折叠按钮时
   （`applyTurnCollapse(..., { userDriven: true })`），活动行做
   height+opacity 过渡（`dsh-ta-animating` 类；行在过渡期间被
   `applyRowTargets` 跳过，动画结束才落 `data-dsh-ta-collapsed` 最终标记）。
   因为折叠框锚定在轮次顶部（决策 2），它不会因下方内容展开/收起而移动，
   **完全不需要任何 scrollTop 调整**——V1.1 的“动画后滚动定位”会引发视口
   猛跳（用户反馈的“抽动”）。动画高度用**渲染高度 `offsetHeight`**（非
   `scrollHeight`：tool 卡片内部有 `max-height` 容器，scrollHeight 是完整内容
   高度，用它做起始/目标高度会让行瞬间拉高再收缩——“抽动”的另一根因）。
   行间 gap（宿主列 `gap:16px`）由过渡期间的 `margin-bottom:-16px` 同步抵消
   （行与行、最后一行与 final 之间；summary 与第一活动行之间的 gap 恒定保留，
   无跳变）。`prefers-reduced-motion` 时跳过动画瞬时切换。自动折叠 /
   rehydrate / 背景 reconcile 不走动画（保持决策 4/5）。
7. **`model-retry` 行纳入折叠**（“少折叠一段”修复）：`llm/retry` 产生的重试
   提示行的 key 只带随机 `retryId`，无法从 key 判断归属；状态机在
   `llm/retry` 时记录 `retryIds`（去重，不推进 `lastActivitySeq`），summary
   经 `data-dsh-ta-retries` 发布，projector 按 retryId 匹配并随轮次折叠。
   无 `data-dsh-ta-retries` 的旧行（旧 build 渲染）视为空列表，安全降级。
8. **membership 快照缓存（分页/长上下文兼容）**：DSH 的会话是**事件窗口**——
   打开会话只安装最近 50 条消息（`session.history` + `replaceWindow`），滚动
   到顶部点击“加载更早”才 `prepend` 更早一页（**切页不保证轮次边界**，
   `dsh-client-runtime` `loadOlder` 是裸的 `beforeSeq + maxMessages: 50`）。
   窗口机制下 summary 行可能不在文档中（加载时序、未来虚拟化），折叠会因此
   失效；React 视图每次渲染 summary 时把成员事实写入模块级缓存
   （`rememberMembership`，按 sessionId+turn），projector 的
   `collectSummaries` 合并 DOM + 缓存（`mergeCached`，DOM 优先），使活动行在
   summary 行缺席时仍能折叠。缓存按会话上限 512 条防异常增长。
   v0.2.0 起该缓存**持久化到 localStorage**
   （`membership-persist.ts`，每会话 256 轮上限，500ms debounce 写），
   刷新后 `hydrateMembership` 读回——窗口外但曾见过的轮次用准确事实折叠。
9. **合成折叠条（v0.2.0，`synth.ts`）**：`turn/start` 被窗口切掉的轮次永远
   不会组装引擎 context、永远没有真实折叠条。projector 在每次 reconcile 时
   从**行 key** 重建归属：`assistant-step` 的 id `<turn>:<step>` 提供轮次号，
   `tool-call` 按流序归属（tail 后、首 step 前的 tool 行进 pending 队列），
   `turn-tail` 的 id 判定轮次**已结束**（运行中的轮次绝不合成——默认折叠
   不会波及正在流式的轮次）。合成条插到该轮第一个活动行之前，样式复用
   `dsh-ta-*`，文案“执行步骤 N · 工具 M”；**默认折叠**（用户确认），真实条
   物化后自动移除（`data-dsh-ta-synth-turn` ≠ `data-dsh-ta-turn`，
   `collectSummaries` 永不误收）。
10. **滚动近顶自动加载（v0.2.0，`auto-load.ts`）**：借鉴社区 dsh-fold 的
    官方通道方案——`sessions.scope(sessionId).get('conversation')
    .loadOlder()`，不碰按钮、不猜选择器；每 200ms 检查一次
    `scrollTop ≤ 4px`，连续加载按 0→400ms→1s 退避（防长会话灌页卡顿），
    滚离顶部重置节奏；`localStorage['dsh.turn-collapse.autoLoad']='0'`
    关闭。与决策 9 组合：往上滚 = 历史自动加载且自动收成结论流。
11. **折叠时隐藏最终回答行内的思考块（v0.2.7）**：最终回答行永不隐藏
    （决策 1/4），但 DSH 把思考渲染在该行**内部**（ReasoningRow，root 带
    稳定 `data-variant="think"`），折叠后其摘要仍可见。projector 对折叠轮
    的 final 行打 `data-dsh-ta-final-collapsed` 标记，CSS 隐藏行内
    `[data-variant="think"]`，展开清除——与折叠标记同机制（幂等 reconcile
    重应用），不动 applyRowTargets 签名（动画分支经 beginAnimatedTransition
    返回，标记在 applyPlan 分支前独立应用）。
12. **点击响应性能（v0.2.7）**：行归属索引化（tool-call/model-retry 按
    id→turn 反向索引，O(行数×轮数) → O(行数)）；折叠动画批量测量
    （先统一读 offsetHeight 一次 layout，再统一写样式，N 次 → 2 次）。
    任何后续批量 DOM 读写都必须先全部读完再开始写——读后立即写会强制
    每次 layout pass，正好复现"点击折叠后延迟"。
