/**
 * Auto-load-older while the reader rests at the top of the conversation.
 *
 * The session's OFFICIAL `loadOlder()` action is invoked through the
 * sessions service binding — `sessions.binding(sessionId).session.loadOlder()`
 * (0.1.2 shape). The action itself guards `openState` / `hasMore` /
 * `loadingOlder`, so a missed or exhausted call degrades to a no-op. Note the
 * official behaviour this implies: while older pages are still loading in
 * (`hasMore`), the official fold bar is disabled (`historyIncomplete`) —
 * folding resumes once auto-load has caught up.
 *
 * Session identity is supplied by a reader callback installed at plugin
 * mount (host selection snapshot first, persisted record second) — this
 * module owns no DOM vocabulary of its own.
 *
 * Pacing: consecutive pages back off (0 → 400ms → 1s cap) so a very long
 * session cannot hammer the host with back-to-back page pulls; scrolling
 * away from the top resets the pace. The feature defaults ON and can be
 * turned off with `localStorage['dsh.turn-collapse.autoLoad'] = '0'`.
 */

/** Minimal structural typing over the host sessions service (0.1.2 shape). */
export interface AutoLoadBinding {
  session: { loadOlder?: () => Promise<void> };
}

export interface AutoLoadSessions {
  binding(sessionId: string): AutoLoadBinding | undefined;
}

/** 会话身份来源（index.ts 装配：宿主 selection 快照 → localStorage 回退）。 */
export type SessionIdReader = () => string | null;

const SCROLL_HOST_SELECTOR = '[data-conversation-scroll]';
const TOP_THRESHOLD_PX = 4;
const CHECK_INTERVAL_MS = 200;
const PACE_SECOND_PAGE_MS = 400;
const PACE_CAP_MS = 1000;

let sessions: AutoLoadSessions | undefined;
let readSessionId: SessionIdReader = () => null;

/** Inject the host sessions service (called once at plugin mount). */
export function setAutoLoadSessions(service: AutoLoadSessions | undefined): void {
  sessions = service;
}

/** Install the session-identity reader (called once at plugin mount). */
export function setAutoLoadSessionReader(reader: SessionIdReader | undefined): void {
  readSessionId = reader ?? (() => null);
}

/** Feature switch: default ON, `'0'` disables. An unreadable switch (no
 *  storage — e.g. Node tests, private modes) defaults to ON. */
export function isAutoLoadEnabled(storage: Storage | undefined): boolean {
  if (storage === undefined) return true;
  try {
    return storage.getItem('dsh.turn-collapse.autoLoad') !== '0';
  } catch {
    return true;
  }
}

const inFlight = new Set<string>();

/** True when the call was dispatched (regardless of whether a page landed). */
async function fireLoadOlder(sessionId: string): Promise<boolean> {
  if (inFlight.has(sessionId)) return false;
  const binding = sessions?.binding(sessionId);
  if (binding === undefined || typeof binding.session.loadOlder !== 'function') return false;
  inFlight.add(sessionId);
  try {
    // Method call — `loadOlder` reads its own guards (`openState`/`hasMore`/
    // `loadingOlder`) off `this`, so a destructured free call would break.
    await binding.session.loadOlder();
    return true;
  } catch {
    // A failed older-page pull degrades silently; the manual button remains.
    return false;
  } finally {
    inFlight.delete(sessionId);
  }
}

interface Pace {
  pages: number;
  lastAt: number;
}

/**
 * One pass of the check loop (exported for tests): walk every conversation
 * scroller resting at the top and dispatch the current session's loadOlder,
 * pacing consecutive pulls. Returns the session ids actually dispatched.
 */
export async function checkAutoLoadOnce(doc: Document, now: number = Date.now()): Promise<string[]> {
  const paces = paceMapFor(doc);
  const storage = typeof localStorage !== 'undefined' ? localStorage : undefined;
  if (!isAutoLoadEnabled(storage)) return [];
  const sessionId = readSessionId();
  if (sessionId === null) return [];
  const dispatched: string[] = [];
  for (const host of doc.querySelectorAll<HTMLElement>(SCROLL_HOST_SELECTOR)) {
    if (host.scrollTop > TOP_THRESHOLD_PX) {
      paces.delete(host);
      continue;
    }
    const pace = paces.get(host) ?? { pages: 0, lastAt: 0 };
    const wait = pace.pages === 0 ? 0 : pace.pages === 1 ? PACE_SECOND_PAGE_MS : PACE_CAP_MS;
    if (now - pace.lastAt < wait) continue;
    pace.lastAt = now;
    // inFlight may reject (a previous page pull still pending) — only a
    // real dispatch raises the pace; a rejection resets it so the next
    // tick retries immediately.
    const dispatchedNow = await fireLoadOlder(sessionId);
    if (dispatchedNow) {
      pace.pages += 1;
      paces.set(host, pace);
      dispatched.push(sessionId);
    } else {
      pace.pages = 0;
    }
  }
  return dispatched;
}

/** Per-document pace state (WeakMap keyed by the scroll host). */
const paceByDoc = new WeakMap<Document, WeakMap<HTMLElement, Pace>>();

function paceMapFor(doc: Document): WeakMap<HTMLElement, Pace> {
  let paces = paceByDoc.get(doc);
  if (paces === undefined) {
    paces = new WeakMap();
    paceByDoc.set(doc, paces);
  }
  return paces;
}

/**
 * Start one document-level check loop. Returns the disposer. The loop is a
 * single interval touching `scrollTop` of the (few) conversation scrollers
 * — no per-scroll listener, no layout reads beyond `scrollTop`.
 */
export function startAutoLoad(doc: Document): () => void {
  const timer = setInterval(() => {
    void checkAutoLoadOnce(doc);
  }, CHECK_INTERVAL_MS);
  return () => {
    clearInterval(timer);
  };
}
