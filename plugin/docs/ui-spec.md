# UI / CSS 规范（V1.2）

以计划文档（`deep-research-report.md`）确认的截图基准为准：**折叠框（summary）
固定在轮次顶部**——用户消息正下方、活动内容之上；分割线位于折叠框与下方内容
（折叠时 = final answer）之间。

## 目标形态

折叠后：

```text
（上一轮内容）
用户消息……
› 本轮用时 2分38秒 · 7 次工具 · 3 段思考
──────────────────────────────────
最终答案……
```

展开后：activity（thinking / tool 行）完整显示在折叠框**之下**（折叠框是轮次的
“头”，位置不动），最终答案在最后。

## 间距与尺寸

| 项 | 值 |
|---|---|
| summary 字号 / 行高 | 13px / 20px |
| summary → 分割线 | 8px |
| 分割线 → final | 由 column 行间距（16px gap）自然形成 |
| 分割线 | 1px × 100%，`--dsw-alias-border-l2`（宿主 hairline 同级，light/dark 均可见） |
| toggle 内边距 | 4px 8px 4px 6px，圆角 8px |
| chevron | 12×12px，旋转 90° 指示展开 |
| 动画 | chevron 220ms `cubic-bezier(.2,0,0,1)`；toggle 背景 120ms；`prefers-reduced-motion: reduce` 时取消 |

## 颜色（全部走 DSH 设计令牌，light/dark 自动适配）

| 用途 | 令牌 |
|---|---|
| summary 文字（常态） | `var(--dsw-alias-label-secondary)`（折叠态按钮自带 `interactive-bg-hover` 淡底，明确"可点击"） |
| summary 文字（hover / focus） | `var(--dsw-alias-label-primary)` + `interactive-bg-hover-solid` 背景 |
| 分割线 | `var(--dsw-alias-border-l2)`（旧版用最低对比度的 `border-l3`，亮色下几乎不可见） |
| focus 环 | `var(--dsw-alias-border-l3)` inset box-shadow |

不加卡片、不加圆角容器；折叠态为淡底胶囊，展开态回到透明，仅 hover 显示背景。

## 交互与可访问性（WAI-ARIA Disclosure）

- summary 是真实 `<button type="button">`。
- `aria-expanded` 反映展开状态（插件不拥有 activity 行本身，故按 WAI-ARIA
  Disclosure 规范有意省略 `aria-controls`）。
- `title` 提供“展开/收起本轮执行过程”的本地化提示。
- 键盘：原生 button（Enter/Space 可用）；`:focus-visible` 有清晰焦点环。
- 分割线 `role="separator"` + 本地化 `aria-label`。
- 中文/英文双语字典（`locales.ts`，zh 为键集源）。

## 行隐藏实现

折叠 = activity 行 `data-dsh-ta-collapsed="true"`（CSS `display:none !important`）；
展开 = 清空标记。**不包裹 DOM**（React 渲染的 flat 行列表，包裹会造成 React 冲突）。

**用户 toggle 的过渡动画**（V1.2）：点 summary 按钮时，活动行做
`height` + `opacity` 过渡（`dsh-ta-animating` 类，220ms `cubic-bezier(.2,0,0,1)`
+ 150ms ease），过渡期间 `margin-bottom: -16px` 与宿主列 `gap:16px` 同步抵消
（行与行、最后一行与 final 之间无跳变；summary 与第一活动行之间的 gap 恒定
保留）。**动画高度用渲染高度 `offsetHeight`**（非 `scrollHeight`：tool 卡片
内部有 `max-height` 容器，用 scrollHeight 会让行瞬间拉高再收缩——抽动根因）。
动画结束后才落 `data-dsh-ta-collapsed` 最终标记。自动折叠 / 恢复 / 背景
reconcile 不动画。`prefers-reduced-motion: reduce` 时过渡取消（CSS + JS 双保险），
退化为瞬时切换。

**滚动**（V1.2）：toggle **不做任何滚动**——折叠框锚定在轮次顶部（用户消息
下方），展开/收起时它的位置不动，视口无需补偿（V1.1 的“动画后滚动定位”会
引发视口猛跳）。自动折叠与背景 reconcile 遵循 `architecture.md` 决策 5
（展开保持锚点行、折叠不动 scrollTop、视口全空才回正）。

## 主题

不覆盖全局 token；仅消费 `--dsw-alias-*`。若未来 DSH 提供正式 divider token，
替换 `--dsw-alias-border-l2` 即可（见 `maintenance.md`）。
