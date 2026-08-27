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
  projector ??= createProjector(document, getStore());
  return projector;
}

export function startProjector(): void {
  getProjector().start();
}

export function stopProjector(): void {
  projector?.stop();
}
