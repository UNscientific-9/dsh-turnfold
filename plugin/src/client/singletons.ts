/**
 * Module-level singletons shared by the React view and the DOM projector.
 * Lazily created so the module can be imported before `apply()` runs; the
 * projector is started/stopped by the plugin lifecycle.
 */
import { createCollapseStore, type CollapseStore } from './store.ts';
import {
  createStoragePersistence,
} from './persist.ts';
import { createProjector, type TurnActivityProjector } from './projector.ts';

let store: CollapseStore | undefined;
let projector: TurnActivityProjector | undefined;

function storage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function getStore(): CollapseStore {
  store ??= createCollapseStore(createStoragePersistence(storage()));
  return store;
}

export function getProjector(): TurnActivityProjector {
  // readSessionId 由本模块注入：projector-core 不 import singletons（依赖
  // 方向单向 singletons → projector-core，无模块环）。注入发生在闭包
  // 创建时，后续 setCurrentSessionReader 的更新通过函数引用即时生效。
  projector ??= createProjector(document, getStore(), undefined, undefined, readCurrentSessionId);
  return projector;
}

/**
 * Reader for the host's CURRENT session id. The chat view normally reports
 * it via `projector.setSession` (the summary view's effect), but a
 * window-cut column can render zero real summary rows — then the
 * projector's session fallback stays null and the whole column would be
 * skipped. The host sessions service exposes the current selection as a
 * snapshot store (`sessions.selection.getSnapshot().sessionId`); index.ts
 * injects a reader over it at mount. Returns null when unavailable.
 */
let currentSessionReader: () => string | null = () => null;

export function setCurrentSessionReader(reader: () => string | null): void {
  currentSessionReader = reader;
}

export function readCurrentSessionId(): string | null {
  try {
    return currentSessionReader();
  } catch {
    return null;
  }
}

export function startProjector(): void {
  getProjector().start();
}

export function stopProjector(): void {
  projector?.stop();
}
