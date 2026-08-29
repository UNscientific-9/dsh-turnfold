/**
 * 浏览器集成测试的 fixture 入口。
 *
 * 由 build.ps1 构建出的 `lib/fixture.js` 加载进 `browser-integration/fixtures/`
 * 下的静态 DSH 模拟页。以与 `src/client/index.ts` 相同的方式启动 projector，
 * 但不带 React / cordis——这些运行时不是 projector 契约的一部分，静态模拟页
 * 只需要 projector + store + membership 缓存，全是 DOM / localStorage 操作。
 *
 * fixture 页里的 summary 行是裸 DOM（非 React 渲染），但携带 projector 读取
 * 的完整 `data-dsh-ta-*` 属性。本入口模拟 React 视图的两个 effect：
 *   1. 已完成 turn 首次挂载时调用 store.setCollapsed + projector.applyTurnCollapse
 *      使自动折叠规则生效。
 *   2. 点击折叠条或按 Enter/Space 时翻转决策并重新应用（userDriven）。
 *
 * 自动折叠决策由 summary 行上的 `data-dsh-ta-auto-collapse` 属性驱动
 * （fixture 读不到引擎的 TurnActivitySummary 节点数据，因此每个测试
 * 逐 turn 设置该属性来表达自己的 `shouldAutoCollapse` 判定）。
 */
import { hydrateMembership, rememberMembership } from './row-membership.ts';
import { getProjector, getStore, setCurrentSessionReader } from './singletons.ts';
import type { SummaryRef } from './types.ts';

const projector = getProjector();
const store = getStore();

interface WindowWithFixture extends Window {
  __dshTurnfold?: {
    getProjector: typeof getProjector;
    getStore: typeof getStore;
    setSession: (sessionId: string | null) => void;
    applyCollapse: (sessionId: string, turn: number, collapsed: boolean) => void;
    setCollapsed: (sessionId: string, turn: number, state: 'collapsed' | 'expanded') => void;
    getCollapsed: (sessionId: string, turn: number) => 'collapsed' | 'expanded' | undefined;
    /** 与生产 summary-view.tsx 渲染时同一入口：记录一条成员事实快照。 */
    rememberMembership: (sessionId: string, ref: SummaryRef) => void;
    /** 与生产 index.ts 挂载时同一入口：从 localStorage 回灌快照缓存。 */
    hydrateMembership: () => void;
  };
}

declare const window: WindowWithFixture;

function readSessionIdFromElement(el: Element): string {
  return el.getAttribute('data-dsh-ta-session') ?? 'fixture-session';
}

function readTurnFromElement(el: Element): number | null {
  const text = el.getAttribute('data-dsh-ta-turn');
  if (text === null) return null;
  const turn = Number(text);
  return Number.isFinite(turn) ? turn : null;
}

/** 复现 summary-view 首次挂载时的自动折叠 effect。 */
function replayAutoCollapse(): void {
  // 只有 summary 根节点带 `data-dsh-ta-turn`（与 summary-view.tsx 一致）；
  // 内部的折叠按钮刻意不带，所以此处绝不能只凭 `[data-dsh-ta-turn]`
  // 查询——否则会把按钮也收集进来。
  for (const el of document.querySelectorAll<HTMLElement>('.dsh-ta-root[data-dsh-ta-turn]')) {
    const sessionId = readSessionIdFromElement(el);
    const turn = readTurnFromElement(el);
    if (turn === null) continue;
    if (store.getCollapsed(sessionId, turn) === undefined) {
      const autoCollapse = el.getAttribute('data-dsh-ta-auto-collapse') === 'true';
      if (autoCollapse) {
        store.setCollapsed(sessionId, turn, 'collapsed');
      }
    }
  }
}

function applyFromButton(btn: HTMLButtonElement, collapsed: boolean): void {
  // 按钮自身不带任何 data-dsh-ta-* 属性（与真实 DSH 视图一致）；
  // 成员事实挂在 summary 根节点上。
  const root = btn.closest<HTMLElement>('.dsh-ta-root');
  if (root === null) return;
  const sessionId = readSessionIdFromElement(root);
  const turn = readTurnFromElement(root);
  if (turn === null) return;
  const state = collapsed ? 'collapsed' : 'expanded';
  store.setCollapsed(sessionId, turn, state);
  // 真实视图的 React 渲染持有 `aria-expanded`；本 fixture 没有 React，
  // 所以在这里同步按钮属性以维持同一契约。
  btn.setAttribute('aria-expanded', String(!collapsed));
  projector.applyTurnCollapse(sessionId, turn, collapsed, { userDriven: true });
}

function wireToggle(btn: HTMLButtonElement): void {
  btn.addEventListener('click', () => {
    const currentlyCollapsed = btn.getAttribute('aria-expanded') === 'false';
    applyFromButton(btn, !currentlyCollapsed);
  });
  btn.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const currentlyCollapsed = btn.getAttribute('aria-expanded') === 'false';
      applyFromButton(btn, !currentlyCollapsed);
    }
  });
}

// 默认把 projector 的会话读取器指向稳定的 fixture 会话 id，
// 单列 fixture 页无需额外的 DOM 探测即可解析。
setCurrentSessionReader(() => 'fixture-session');

// 镜像生产 index.ts 的挂载顺序：先把 localStorage 里的成员事实快照回灌进
// 内存缓存，再启动 projector——刷新后旧 turn 才能带着准确 facts 折叠。
hydrateMembership(typeof localStorage !== 'undefined' ? localStorage : undefined);

replayAutoCollapse();
projector.start();

for (const btn of Array.from(document.querySelectorAll<HTMLButtonElement>('.dsh-ta-toggle'))) {
  wireToggle(btn);
}

window.__dshTurnfold = {
  getProjector,
  getStore,
  setSession: (sessionId) => projector.setSession(sessionId),
  applyCollapse: (sessionId, turn, collapsed) => {
    store.setCollapsed(sessionId, turn, collapsed ? 'collapsed' : 'expanded');
    projector.applyTurnCollapse(sessionId, turn, collapsed, { userDriven: true });
  },
  setCollapsed: (sessionId, turn, state) => {
    store.setCollapsed(sessionId, turn, state);
    // 真实视图的 `useSyncExternalStore` 订阅会在 store 变化时重渲染
    // `aria-expanded`；本 fixture 没有 React，所以在这里同步每个匹配的
    // 折叠按钮，保持点击方向语义（`aria-expanded === 'false'` 表示已
    // 折叠）与 store 一致。
    for (const root of document.querySelectorAll<HTMLElement>('.dsh-ta-root[data-dsh-ta-turn]')) {
      if (
        root.getAttribute('data-dsh-ta-session') === sessionId &&
        Number(root.getAttribute('data-dsh-ta-turn')) === turn
      ) {
        const button = root.querySelector<HTMLButtonElement>('.dsh-ta-toggle');
        button?.setAttribute('aria-expanded', String(state !== 'collapsed'));
      }
    }
  },
  getCollapsed: (sessionId, turn) => store.getCollapsed(sessionId, turn),
  rememberMembership,
  hydrateMembership: () =>
    hydrateMembership(typeof localStorage !== 'undefined' ? localStorage : undefined),
};
