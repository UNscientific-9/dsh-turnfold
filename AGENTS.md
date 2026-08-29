# AGENTS.md

本仓库是 DSH Web 插件 **`@UNscientific-9/dsh-turnfold`**（`plugin/`，当前 v0.3）——DSH 0.1.2-alpha.1 官方轮次折叠条（`turn-process`）的**增强层**，不是独立折叠条。回复、注释、文档、提交一律用中文。

## 目录地图

- `plugin/` — 唯一源码主体。`src/client/`（10 文件：入口 index、activity-state 状态机、activity-augment 增强决策、turn-activity definition、fold-bar-view shadow renderer、persist、auto-load、format、locales、styles）；`test/`（node:test 纯逻辑 34 用例）；`docs/architecture.md`（三通道架构 + **官方挂接面契约表**）、`docs/manual-verification.md`（真实宿主手验清单）。
- 根目录其余（`参考项目/`、`review-v1.5.50-*`、`review-dsh-cost-meter-install.ps1`）是另一插件 dsh-cost-meter 的参考材料，**与本项目无关**；`deep-research-report.md`、`fix-plan-*`、`code-review-fixes-*` 为历史文档。
- `CLAUDE.md` 与本文件内容同步；`README.zh-CN.md` 尚停留在 v0.2.8（未同步 v0.3，以 `plugin/README.md` 为准）。

## 常用命令（在 `plugin/` 下执行）

```bash
npm install --ignore-scripts   # 沙箱必须跳过 postinstall
npm run typecheck              # tsc --noEmit
npm test                       # node --test --test-isolation=none "test/*.test.ts"
npm run build                  # scripts/build.ps1 直调 esbuild.exe/tsc，产物 → lib/
```

- `--test-isolation=none` 必须保留（沙箱禁止 spawn）；`build.ps1` 不走 child_process。
- 测试只测纯逻辑（storage/renderer/reader 全部参数注入），**不写依赖真实 DOM 的测试**；shadow 渲染等浏览器行为只能按 `docs/manual-verification.md` 在真实宿主手验。

## 架构边界（改代码前先读 `plugin/docs/architecture.md`）

三条通道：① `turn-activity` definition 仅在 turn/end 发布 Turn data `{durationMs, thinkingSteps, reasonKind}`（无 buildViewNode）；② `FoldBarView` 以 `slots.register({key:'turn-process', priority:-1})` shadow 官方渲染器，`useTurnData('turn-activity')` 读增强 face、`turnProcess.open/setOpen` 走官方 store 回流；③ auto-load 走 `sessions.binding(id).session.loadOlder()`。

硬规则：

1. **官方优先**：`foldable=false` 一律 `return null`；增强数据未就绪时退化为纯官方行为；**禁止引入自有 DOM 折叠条**（v0.2 与官方双条硬冲突的教训）。
2. **shadow 注册必须 `priority: -1`**：同 key 同 priority 注册会 throw（keyed slot：lowest renders）。
3. **白名单轮必须「强制展开 + 不渲染条」成对出现**，只做其一会出现内容被官方隐藏却没有折叠条的坏状态。
4. `loadOlder` 必须以方法调用形式执行（`binding.session.loadOlder()`），解构调用会丢 `this` 护栏。

## 类型面与路径（易踩坑）

- `plugin/tsconfig.json` 的 paths 指向 `D:/deepseek-harness/packages/**/lib/types/**`（0.1.2 官方包不发 npm，运行仓库在本机）——**本机特有路径**，换机器需调整；官方版本更新后先重跑 typecheck。
- 官方 augment 必须由使用文件**显式** `import type {} from '@deepseek-ai/dsh-client-ui-chat/client'`（SlotMap/owner props）、`'.../dsh-client-ui-session/client'`（sessionId）、`'.../dsh-client-ui-conversation/client'`（events）等加载；`import type {}` 在 d.ts emit 时被抹掉，不影响运行时。
- **禁止本地类型 stub**：曾因 `src/types/dsh-client-ui-slots.d.ts` 手写影子文件 ambient merge 污染官方 `PropsRuntime`（丢 turnProcess/sessionId）。

## 当前状态与运行时

- 分支 `fix/dsh-0.1.2-alpha`：v0.3 重构已完成并通过独立 review（review 修复了 definition `target`/`buildViewNode` 不成对触发的官方注册断言），typecheck/test/build 全绿。**真实宿主手验未做**，发版前按 `plugin/docs/manual-verification.md` 过一遍。
- 运行时装载：profile 依赖 file: tgz + `cordis.patch.yml` 的单条 loader insert（name 须匹配 bundle id）；`@deepseek-ai/*` 全部 external 由宿主解析；`peerDependencies` 保持为空。
- localStorage 契约：`dsh.turn-collapse.v1`（展开决策，向后兼容 v0.2 数据）、`dsh.turn-collapse.autoLoad`（默认开）、`dsh.turn-collapse.completedOnly`（默认关）。
