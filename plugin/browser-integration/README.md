# 浏览器集成测试

`dsh-turnfold` projector 的 Playwright + Chromium 冒烟测试套件。

这**不是** DSH 端到端测试。`fixtures/` 目录是**手写的 DSH 模拟页**，携带真实
DSH 聊天视图渲染的同一批 `data-chat-*` / `data-dsh-ta-*` 属性。插件的
projector + store + membership 缓存由 `lib/fixture.js`（专用的 IIFE bundle）
加载，Playwright 经 fixture 暴露的 `window.__dshTurnfold` 句柄驱动。

定位是 projector 行为的回归网：`reason.kind === 'completed'` 自动折叠、中断
turn 不自动折叠、toggle 滚动稳定、动画高度合理性、刷新后恢复、合成折叠条、
键盘可达性、明暗主题与减少动态效果变体。

## 运行

在 `plugin/` 下：

```bash
npm install --ignore-scripts              # DSH 沙箱禁用 postinstall
npm run build                              # 产出 lib/fixture.js
npm run test:browser                       # 13 个冒烟 spec
```

套件运行在系统安装的 **Edge** 上（`playwright.config.ts` 的
`channel: 'msedge'`），无需下载浏览器。其他机器若无 Edge，把 `channel` 改成
`'chrome'` 或 `'chromium'`（并执行一次 `npx playwright install chromium`）。

`playwright.config.ts` 会在 `127.0.0.1:3100` 起一个静态文件服务器
（`server.mjs`），同时服务 fixture HTML 页和 `lib/fixture.js` bundle。
服务器以前台方式作为 Playwright 的 `webServer` 运行；`reuseExistingServer:
true` 表示已有实例时跳过重启。

本套件**刻意不接入 CI**。DSH 沙箱没有 chromium 可执行文件；这是开发者
本地的回归网。

## 布局

```
browser-integration/
├── playwright.config.ts     # testDir、workers=1（共享模块级状态）
├── server.mjs               # 127.0.0.1:3100 静态服务器
├── fixtures/
│   ├── chat.html            # 4 个已完成 turn + 1 个中断 turn
│   ├── long-conversation.html  # 1 个 turn、100 个工具调用
│   ├── no-summary.html      # 1 个无 summary 行的 turn（synth 路径）
│   └── helper.ts            # bootstrapChat / clickToggle / waitForAnimationDone
├── specs/
│   ├── 01-completed-fold.spec.ts
│   ├── 02-interrupted-no-fold.spec.ts
│   ├── 03-toggle-no-jump.spec.ts
│   ├── 04-long-tool-no-twitch.spec.ts
│   ├── 05-multi-round-position.spec.ts
│   ├── 06-refresh-restore.spec.ts
│   ├── 07-load-older.spec.ts
│   ├── 08-synth-replace.spec.ts
│   ├── 09-final-thinking.spec.ts
│   ├── 10-hundred-rows.spec.ts
│   ├── 11-light-dark.spec.ts
│   ├── 12-reduced-motion.spec.ts
│   └── 13-keyboard.spec.ts
└── README.md
```

## fixture 暴露的句柄

`lib/fixture.js`（由 `src/client/fixture-entry.ts` 构建）挂载
`window.__dshTurnfold`：

- `getProjector()`、`getStore()` — 与 React 视图同一批单例
- `setSession(sessionId)` — 驱动 projector 的列归属探测
- `applyCollapse(sessionId, turn, collapsed)` — 同步折叠/展开（内部固定
  `userDriven: true`，走 apply-plan.ts 的动画分支；04 spec 靠它采样真实
  220ms 高度渐变）
- `setCollapsed(sessionId, turn, state)`、`getCollapsed(...)` — 直通带持久
  化的 `CollapseStore`（写 store 触发的是无动画的背景 reconcile 路径）
- `rememberMembership(sessionId, ref)` — 与生产 summary-view.tsx 渲染时
  同一入口，记录一条成员事实快照（内存缓存 + localStorage 防抖落盘）
- `hydrateMembership()` — 与生产 index.ts 挂载时同一入口，从 localStorage
  回灌快照缓存

fixture 页的 summary 行带 `data-dsh-ta-auto-collapse="true"` 或 `"false"`，
表达每个 turn 的 `shouldAutoCollapse` 判定（fixture 读不到引擎的
`TurnActivitySummary` 节点数据，因此测试页逐行声明判定结果）。

折叠按钮（`<button class="dsh-ta-toggle">`)由 fixture 入口接线：`click` 与
`keydown`（Enter / Space）都路由到与 React 视图相同的 `applyTurnCollapse`
调用。

## 为什么用独立 bundle 而不是 `lib/client.js`？

`lib/client.js` 是包在 `window.__ModuleLoader__.load` 里的 CJS bundle，
`react`、`react/jsx-runtime` 与 `@deepseek-ai/*` 标记为 external——它需要
真实的 DSH 宿主。而 projector 本身（我们真正要测的文件）是纯 DOM +
`localStorage` 模块，没有 React / cordis 运行时依赖；IIFE 的
`lib/fixture.js` 是只含 projector + store + membership 模块的专用 bundle，
静态 fixture 页无需 DSH 宿主即可运行。

## 调试单个 spec

```bash
npx playwright test --config=browser-integration/playwright.config.ts specs/03-toggle-no-jump.spec.ts
```

把 `playwright.config.ts` 的 `headless` 改成 `false` 可以在真实浏览器里看
动画。服务器单独启动后 fixture 页也可以直接访问：
`http://127.0.0.1:3100/chat.html`：

```bash
node plugin/browser-integration/server.mjs
```

## projector 重构落地时

这 13 个 spec 是 **`refactor/projector-split` 工作的回归网**（见
`plugin/docs/architecture.md`）。每个重构提交都必须保持套件 13/13；
出现 flake 一律按行为变化处理并回退提交。
