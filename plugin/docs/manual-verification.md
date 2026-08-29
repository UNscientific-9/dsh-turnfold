# 手工验证清单（真实宿主 0.1.2-alpha.1）

旧 browser-integration（13 个 Playwright spec）绑定自有折叠条与手写 fixture 页，随 v0.3 重构废弃——shadow 官方 renderer 的行为只能在真实 ui-chat 环境验证。发版前按下表逐项手验；官方折叠条本体行为（折叠时机、`hidden="until-found"`、页内查找自动展开等）由官方保证，不在本清单内。

环境：DSH 0.1.2-alpha.1 宿主 + 本插件 `npm pack` 产物装入 profile。控制台确认 `[dsh.turnfold] v0.3.0 loaded`。

## 1. 增强文案

- [ ] 完成一轮带工具调用的对话：折叠条文案 = 官方计数段 + 灰色 `· 用时 X · M 段思考`
- [ ] 无思考段的轮（纯工具）：只显示 `· 用时 X`，无思考段
- [ ] 全零计数的轮：显示「已思考 · 用时 X …」
- [ ] button 上 `data-dsh-tf-duration` / `data-dsh-tf-thinking` 与文案一致；官方 `data-turn-process-*` 属性保留

## 2. 开合与持久化

- [ ] 点击折叠条正常展开/收起，箭头旋转与官方一致
- [ ] 展开某轮 → 刷新页面 → 该轮自动恢复展开；收起 → 刷新 → 保持收起
- [ ] 展开决策写入 `localStorage['dsh.turn-collapse.v1']`（`"expanded"`）
- [ ] 重新生成答案（generation 变化）后仍恢复用户上次的选择

## 3. completed 白名单

- [ ] 默认关：中断一轮（Esc 停止），行为与纯官方一致（照常折叠）
- [ ] `localStorage.setItem('dsh.turn-collapse.completedOnly', '1')` 后刷新：中断/报错/超限的轮保持展开且**无折叠条**；正常完成的轮照常折叠
- [ ] 白名单轮删除该键恢复默认后行为回归官方

## 4. 模式跟随

- [ ] 设置 → transcriptView 切到 normal：全部内联显示，无折叠条（跟随官方，插件不渲染）
- [ ] 切回 compact：折叠恢复

## 5. 自动加载更早历史

- [ ] 打开一个超过一页历史的会话，滚到顶部：自动触发「加载更早」，连续加载有节奏（0→400ms→1s 退避），无手动点击
- [ ] 加载完成后早期轮次出现折叠条（官方 `historyIncomplete` 解除后）
- [ ] `localStorage['dsh.turn-collapse.autoLoad'] = '0'` 后刷新：不再自动加载
- [ ] 切换会话后自动加载跟随新会话（selection 快照）

## 6. 外观与边界

- [ ] 深色/浅色主题下折叠条颜色与官方原生条无肉眼差异（`--dsw-alias-*` 令牌）
- [ ] 页内查找（Ctrl+F）命中被折叠轮次的内容：官方自动展开行为正常（`hidden="until-found"` 链路未被 shadow 破坏）
- [ ] 中断轮（foldable=false 场景：无定稿回答）内容平铺直显，无空占位（`.flowItem:empty` 生效）
- [ ] 控制台无新增报错；卸载插件（移除依赖 + pnpm install + 重启）后回到纯官方折叠条
