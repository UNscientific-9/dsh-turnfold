# @dsh-plan/turn-collapse

DSH Web「Codex / ZCode 式轮次收纳」插件 V1。

agent 工作时，thinking / tool / 中间叙述保持完整流式可见；**当一轮（turn）以 `completed` 正常结束时**，该轮执行过程自动收纳为一行永久可见的 summary（`本轮用时 X · N 次工具 · M 段思考`），并保留一条低对比度分割线，最终回答成为视觉主体。点击 summary 可展开/收起；刷新后恢复人工选择。

- 纯前端插件：不改 DSH 后端/会话存储
- 兼容版本：**DSH 0.1.1-rc.2**（`@deepseek-ai/dsh-client-runtime` / `dsh-client-ui-conversation` / `dsh-session` 同版本）
- 依赖：`react` / `react/jsx-runtime` 由宿主提供（external）

## 效果

```
（上一轮内容）

› 本轮用时 2分38秒 · 7 次工具 · 3 段思考   ← 可点击（Disclosure）
──────────────────────────────────  ← 唯一分割线
最终答案……
（turn-tail 产物行等）
```

## 目录

```
src/
  index.ts              host 半部（空插件壳，浏览器功能全部在 ./client）
  client/
    index.ts            apply 入口：注册节点定义、渲染器、字典、projector 生命周期
    activity-state.ts   状态机纯逻辑（match/update/summarize/auto-collapse 规则）
    turn-activity.ts    ConversationNodeDefinition（turn-activity 节点）
    summary-view.tsx    summary 行视图（Disclosure button + 分割线）
    projector.ts        DOM projector：行归属计算（纯函数）+ 隐藏/恢复 + 滚动锚点补偿
    row-keys.ts         行 key 解析与分类（纯逻辑）
    store.ts            折叠状态 store（subscribe 供 React/投影器）
    persist.ts          localStorage 持久化（可注入）
    format.ts           时长格式化（zh/en）
    locales.ts          字典（zh/en）
    styles.ts           CSS（--dsw-alias-* 设计令牌）
lib/
  client.js             浏览器半部（__ModuleLoader__.load 单文件 bundle，23.9KB）
  index.js              host 半部
  types/                TypeScript 声明
test/                   node:test 单元测试（26 个用例）
docs/
  architecture.md       状态机 / DOM contract
  ui-spec.md            CSS / UI 规范
  maintenance.md        DSH 版本演进时的适配检查清单
```

## 开发命令

```bash
npm install --ignore-scripts          # 构建依赖（typescript/esbuild），沙箱环境需跳过 postinstall
npm run typecheck                     # tsc --noEmit
npm test                              # node --test（--test-isolation=none 避开沙箱 spawn 限制）
npm run build                         # 产物 → lib/
```

## 安装（交付后由用户执行，插件本身不自动安装）

### 方式 A：作为 dsh 组合行（与官方 ui-deliverables 同机制）

1. 将本包放入 DSH 的 node_modules（`npm install <path-to-plugin>` 或复制目录）。
2. 在 web profile 的组合文件（如 `dsh-web-app/cordis.patch.yml` 的浏览器名册区）追加一行：

   ```yaml
   - id: ui-turn-collapse
     name: '@dsh-plan/turn-collapse'
   ```

3. 重启 `dsh --profile web`，浏览器强制刷新一次。

### 方式 B：临时验证（动态 cordis 插件）

在 DSH 对话中通过 cordis 动态插件机制，用 `code.client` 引用本包的 `lib/client.js` 导出的 `apply` 逻辑亦可（不推荐：失去单文件 bundle 的依赖声明）。

### 回滚

- 方式 A：删除组合行 + 移除包，重启。
- 已产生的影响全部在浏览器侧（localStorage key `dsh.turn-collapse.v1`、`<style data-plugin-css="@dsh-plan/turn-collapse/styles">`、行内 `data-dsh-ta-collapsed` 标记）；移除插件后刷新页面即完全消失，不残留任何服务端状态。

## 行为规则（V1 硬性约定）

| 场景 | 行为 |
|---|---|
| turn 进行中 | activity 完整流式可见，不做任何干预 |
| `turn/end` + `reason.kind === 'completed'` + 有最终消息 | 自动折叠 + 记录决策 |
| `aborted` / `blocked` / `error` / `max-tokens` / `interrupted` | 不自动折叠；summary 行仍渲染（可手动折叠） |
| 无最终消息的 turn（纯工具/空回复） | 不物化 summary 行，完全不动 |
| 最终回答行 | 永不折叠（即使 turn 处于折叠态） |
| 刷新 / 重新打开会话 | 恢复 localStorage 记录的选择 |
| 等待授权 / 中断中 | 无 `turn/end`，天然不折叠 |
