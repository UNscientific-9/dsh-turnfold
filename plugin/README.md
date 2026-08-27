# @dsh-plan/turn-collapse

DSH Web 轮次折叠插件：agent 工作时，thinking / 工具调用 / 中间过程保持完整流式可见；**一轮（turn）结束后自动收纳成一行摘要**（`本轮用时 X · N 次工具 · M 段思考`），最终回答成为视觉主体。点击摘要可随时展开/收起。

- 纯前端插件，不改 DSH 后端与会话存储，卸载无残留
- 兼容：**DSH 0.1.1-rc.2 系列**（`@deepseek-ai/dsh-client-runtime` / `dsh-client-ui-conversation` / `dsh-session` 同版本）
- 当前版本：**0.2.7**

## 效果

```
（上一轮内容）

用户消息……（折叠条固定在用户消息下方、回复正文上方）

› 本轮用时 2分38秒 · 7 次工具 · 3 段思考   ← 可点击（展开/收起）
──────────────────────────────────  ← 分割线
最终回答……（turn-tail 产物行）
```

## 功能

| 功能 | 说明 |
|---|---|
| 自动折叠 | 正常完成（completed）的轮次自动收起为一行摘要；中断/报错的轮次保持展开，可手动折叠 |
| 合成折叠条 | 会话上下文很长、DSH 只加载了部分历史时，对"窗口被切掉的轮次"也会生成折叠条（显示执行步骤数/工具数），不依赖是否加载到最早数据 |
| 自动加载更早 | 滚动到会话顶部附近时自动调用 DSH 的"加载更早"，历史轮次边加载边折叠，无需手动点击"加载更早" |
| 状态持久化 | 折叠/展开选择存 localStorage，刷新、重开会话后恢复；早期轮次的折叠状态也会被记住（成员快照） |
| 位置正确 | 折叠条固定渲染在**用户消息下方、该轮回复正文上方**（0.2.6 锚点修复） |

## 安装（拿到 `dsh-plan-turn-collapse-0.2.7.tgz` 后）

### 前提

- 已安装 DSH web（`dsh` CLI 可用），版本 0.1.1-rc.2 系列
- 已安装 pnpm（DSH 通常自带；如无：`npm i -g pnpm`）

### 步骤

1. 把 `dsh-plan-turn-collapse-0.2.7.tgz` 放到一个**固定目录**（路径不要带空格，例如 `D:\deps\` 或项目目录下），记下它的完整路径。

2. 编辑 DSH web profile 的依赖文件：
   `%USERPROFILE%\.dsh\profiles\web\package.json`
   在 `dependencies` 里加一行（路径改成你的实际位置）：

   ```json
   {
     "dependencies": {
       "@dsh-plan/turn-collapse": "file:D:/deps/dsh-plan-turn-collapse-0.2.7.tgz"
     }
   }
   ```

3. 在 profile 目录安装依赖：

   ```powershell
   cd $env:USERPROFILE\.dsh\profiles\web
   pnpm install
   ```

   > 出现 `unmet peer` 黄色警告（DSH 各 rc 小版本差异）可忽略，不影响使用。

4. 重启 DSH web：关闭 DSH 进程后重新运行 `dsh web`（或直接重启 DSH 应用）。

5. 浏览器打开 `http://127.0.0.1:3080/`，**强制刷新一次**（Windows/Linux：`Ctrl+Shift+R`，macOS：`Cmd+Shift+R`）。

### 确认装上了

- 浏览器控制台（F12 → Console）出现：`[dsh.turn-collapse] v0.2.7 loaded`
- 打开任意一个已完成会话：用户消息下方出现 `本轮用时 …` 折叠条；正常完成的轮次默认为折叠态

## 使用

- **展开/收起单轮**：点击折叠条（`›` 箭头方向表示当前状态；收起态有浅色底）
- **查看被折叠的历史**：往上滚动，自动加载更早内容；已完成的旧轮次会自动折叠成摘要，滚动到最新回复下方即可看到结论流
- **刷新页面**：之前的折叠/展开选择自动恢复

## 回滚 / 卸载

1. 从 `%USERPROFILE%\.dsh\profiles\web\package.json` 删除 `@dsh-plan/turn-collapse` 依赖行。
2. 在 profile 目录执行 `pnpm install`。
3. 重启 DSH web，浏览器强制刷新一次。

插件全部影响都在浏览器侧（localStorage `dsh.turn-collapse.v1` / `dsh.turn-collapse.membership.v1`、一个 `<style>` 标签、行内 `data-dsh-ta-*` 标记）；移除后刷新即完全消失，服务端无残留。如需清空折叠记录：浏览器控制台执行 `localStorage.removeItem('dsh.turn-collapse.v1')` 后刷新。

## 常见问题

| 现象 | 处理 |
|---|---|
| 折叠条在用户消息**上方** | 装的是旧版 bundle；确认步骤 4/5（重启 + 硬刷新），Console 里应是 v0.2.7 |
| 点击折叠条没反应 | 先硬刷新；确认没有其他脚本遮挡；仍不行就把 Console 报错发给维护者 |
| 早期轮次没有折叠条 | 往上滚动触发自动加载，稍等片刻（连续加载会逐步加速，最多约 1 秒间隔），旧轮次会补上折叠条 |
| 不想自动加载历史 | 浏览器控制台执行 `localStorage.setItem('dsh.turn-collapse.autoLoad', '0')` 后刷新 |

## 开发

```bash
npm install --ignore-scripts    # 构建依赖（typescript/esbuild）
npm run typecheck               # tsc --noEmit
npm test                        # node --test（57 个用例）
npm run build                   # 产物 → lib/
npm pack                        # 打包 → dsh-plan-turn-collapse-<version>.tgz
```

## 目录

```
src/
  index.ts               host 半部（空壳，浏览器功能全部在 ./client）
  client/
    index.ts             apply 入口：注册节点、渲染器、projector/auto-load 生命周期
    activity-state.ts    状态机纯逻辑（match/update/summarize/auto-collapse）
    synth.ts             合成折叠条：从 DOM 行 key 推断被窗口切掉的轮次
    auto-load.ts         滚动近顶自动加载更早（官方 loadOlder 通道 + 泵间隔退避）
    membership-persist.ts 成员快照持久化（跨刷新记住早期轮次的折叠状态）
    projector.ts         DOM projector：行归属 + 隐藏/恢复 + 滚动锚点补偿 + 合成条同步
    store.ts             折叠状态 store（subscribe）
    persist.ts           localStorage 持久化（内存缓存层兜底）
    summary-view.tsx     summary 行视图（Disclosure button + 分割线）
lib/
  client.js              浏览器半部（单文件 bundle）
  index.js               host 半部
test/                    node:test 单元测试（57 个用例）
```

## 版本历史

- **0.2.7**：点击折叠条响应提速（行归属索引化 + 折叠动画批量测量，消除点击后延迟）；移除右下角「全部折叠/全部展开」浮动按钮（与侧边栏插件冲突）；折叠后最终回答行内的思考摘要（最后一条 thinking）一并隐藏，展开恢复
- **0.2.6**：合成折叠条点击时先写 store 再折叠（修复点击被旧决策回滚的问题）；样式标签带版本号；折叠决策持久化加内存缓存层（写入失败不丢状态）
- **0.2.0~0.2.5**：折叠条锚点修复（固定在用户消息下方）；长会话被窗口切掉的轮次生成合成折叠条；滚动近顶自动加载更早；成员快照持久化；全局一键折叠/展开；纯窗口裁剪列不再被整列跳过
