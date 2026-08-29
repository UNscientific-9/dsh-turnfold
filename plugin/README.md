# @UNscientific-9/dsh-turnfold

DSH Web **官方折叠条的增强插件**：DSH 0.1.2 起内置了轮次过程折叠（`turn-process` 折叠条，`N 次工具调用 · N 条消息 · N 个 subagent`），本插件接管它的渲染并叠加四项官方没有的增强——

| 增强 | 说明 |
|---|---|
| **用时 + 思考段数** | 折叠条追加 `· 用时 X · M 段思考`（tertiary 色弱化显示），数据来自插件自有的轮次状态机 |
| **展开决策持久化** | 官方折叠条的展开状态是内存态（刷新即失）；插件把你的展开选择写 localStorage，刷新/重开后恢复 |
| **completed 白名单（可选，默认关）** | 官方对轮次终结一律折叠（不区分原因）；开启后中断/报错/超限的轮保持展开且不渲染折叠条 |
| **自动加载更早历史** | 滚动到会话顶部附近时自动调用官方 `loadOlder()`，长会话历史边加载边折叠 |

- 纯前端插件，不改 DSH 后端与会话存储，卸载无残留
- 锁定：**DSH 0.1.2-alpha.1**（官方 `turn-process` 折叠、keyed slot `conversation.chat.node`、`useTurnData` 注入面）
- 当前版本：**0.3.0**

## 工作方式

```
官方 ui-chat 折叠条（turn-process）
        │  ctx.slots.register({ key:'turn-process', priority:-1 })   ← shadow 接管渲染
        ▼
FoldBarView（本插件 shadow renderer）
        │  官方计数段（node.data）+ 增强段（useTurnData('turn-activity')）
        ▼
turn-activity definition（本插件）── 每轮状态机 ── turn/end 发布 {durationMs, thinkingSteps, reasonKind}
```

- `foldable=false`（normal 模式 / 历史未齐 / 无定稿回答）时跟随官方不渲染
- 官方 `data-turn-process(-messages|-tool-calls|-subagents)` 契约全保留，另加 `data-dsh-tf-duration/-thinking`
- 折叠条外观复刻官方 CSS module（`dsh-tf-` 固定类名 + `--dsw-alias-*` 设计令牌，明暗自适应）

## 安装（拿到 `dsh-turnfold-0.3.0.tgz` 后）

### 前提

- DSH web **0.1.2-alpha.1**（含官方折叠条；0.1.1 无此折叠条，本插件不适用）
- 已安装 pnpm（DSH 通常自带）

### 步骤

1. 把 `dsh-turnfold-0.3.0.tgz` 放到一个**固定目录**（路径不要带空格），记下完整路径。

2. 编辑 DSH web profile 的依赖文件 `%USERPROFILE%\.dsh\profiles\web\package.json`，在 `dependencies` 里加一行（路径改成实际位置）：

   ```json
   {
     "dependencies": {
       "@UNscientific-9/dsh-turnfold": "file:D:/deps/dsh-turnfold-0.3.0.tgz"
     }
   }
   ```

3. 在 profile 目录安装依赖：`cd $env:USERPROFILE\.dsh\profiles\web && pnpm install`。

4. 重启 DSH web，浏览器打开后**强制刷新一次**（`Ctrl+Shift+R`）。

### 确认装上了

- 浏览器控制台出现：`[dsh.turnfold] v0.3.0 loaded`
- 已完成的回答前出现官方样式的折叠条，计数后带灰色的 `· 用时 X · M 段思考`

## 使用与配置

- **展开/收起单轮**：点击折叠条（与官方行为一致；展开选择会被插件记住）
- **completed 白名单**：控制台执行 `localStorage.setItem('dsh.turn-collapse.completedOnly', '1')` 后刷新——中断/报错/超限的轮不再折叠；删除该键恢复默认（尊重官方）
- **关闭自动加载**：`localStorage.setItem('dsh.turn-collapse.autoLoad', '0')` 后刷新

## 回滚 / 卸载

1. 从 profile 的 `package.json` 删除 `@UNscientific-9/dsh-turnfold` 依赖行。
2. 在 profile 目录执行 `pnpm install`，重启 DSH web 并强制刷新。

插件全部影响都在浏览器侧（localStorage 的 `dsh.turn-collapse.v1` / `dsh.turn-collapse.autoLoad` / `dsh.turn-collapse.completedOnly` 三个键 + 一个 `<style>` 标签）；移除后刷新即回到纯官方折叠条，服务端无残留。

## 开发

```bash
npm install --ignore-scripts    # 构建依赖（typescript/esbuild）
npm run typecheck               # tsc --noEmit
npm test                        # node --test（34 个用例）
npm run build                   # 产物 → lib/
npm pack                        # 打包 → dsh-turnfold-<version>.tgz
```

真实宿主行为（shadow 渲染、持久化恢复、白名单）按 `docs/manual-verification.md` 的清单在 0.1.2-alpha.1 宿主上手验。

## 目录

```
src/
  index.ts               host 半部（空壳，浏览器功能全部在 ./client）
  client/
    index.ts             apply 入口：注册 definition + shadow renderer + 字典 + auto-load
    activity-state.ts    轮次状态机纯逻辑（match/update/summarize）
    activity-augment.ts  增强契约与纯决策（白名单开关/强制展开/折叠条文案）
    turn-activity.ts     ConversationNodeDefinition：turn/end 时发布增强 Turn data
    fold-bar-view.tsx    官方折叠条的 shadow renderer（增强渲染 + 持久化 + 白名单）
    persist.ts           localStorage 持久化（内存缓存层兜底）
    auto-load.ts         滚动近顶自动加载更早（官方 binding().session.loadOlder 通道）
    format.ts / locales.ts  时长格式化与中文字典
lib/
  client.js              浏览器半部（单文件 bundle）
  index.js               host 半部
test/                    node:test 单元测试（34 个用例）
```

## 版本历史

- **0.3.0**：转型为官方折叠条增强插件——以 `priority:-1` shadow 官方 `turn-process` renderer，砍掉自有折叠条全家桶（projector/synth/summary-view/animate 等约 2500 行）；保留轮次状态机，新增用时/思考段数注入、展开决策持久化（官方 store 为内存态）、completed 白名单（可配默认关）、自动加载更早历史改走 `binding().session.loadOlder()`；测试 57→34（纯逻辑），DOM 集成 spec 废弃改手工验证清单
- **0.2.0~0.2.8**：自有折叠条时代（锚点修复、合成折叠条、自动加载、成员快照、动画与性能优化），0.1.1-rc.2 系列
