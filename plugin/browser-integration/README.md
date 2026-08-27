# Browser integration

Playwright + Chromium smoke suite for the `dsh-turnfold` projector.

This is **not** a DSH end-to-end suite. The `fixtures/` directory holds
**hand-written DSH-mock pages** that carry the same `data-chat-*` /
`data-dsh-ta-*` attributes the real DSH chat view renders. The plugin's
projector + store + membership cache are loaded by `lib/fixture.js` (a
purpose-built IIFE bundle) and driven by Playwright through the
`window.__dshTurnfold` handle the fixture exposes.

The intent is a regression net for projector behaviour: auto-collapse on
`reason.kind === 'completed'`, no auto-fold for interrupted turns, scroll
stability on toggle, animation height sanity, persistence across reload,
synthesised fold bars, keyboard accessibility, and light/dark + reduced-
motion variants.

## Running

From `plugin/`:

```bash
npm install --ignore-scripts              # DSH sandbox disables postinstall
npx playwright install chromium --with-deps   # one-time
npm run build                              # produces lib/fixture.js
npm run test:browser                       # 13 smoke specs
```

`playwright.config.ts` starts a static file server on `127.0.0.1:3100`
(`server.mjs`) that serves both the fixture HTML pages and the
`lib/fixture.js` bundle. The server runs in the foreground as Playwright's
`webServer`; pass `reuseExistingServer: true` to skip restart when one
is already up.

The suite is **not** wired into CI by design. DSH sandboxes do not have
the chromium binary available; this is a developer-local regression net.

## Layout

```
browser-integration/
├── playwright.config.ts     # testDir, workers=1 (shared module-level state)
├── server.mjs               # static server on 127.0.0.1:3100
├── fixtures/
│   ├── chat.html            # 4 completed + 1 interrupted turn
│   ├── long-conversation.html  # 1 turn, 100 tool calls
│   ├── no-summary.html      # 1 turn with no summary row (synth path)
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

## What the fixture exposes

`lib/fixture.js` (built from `src/client/fixture-entry.ts`) attaches
`window.__dshTurnfold` with:

- `getProjector()`, `getStore()` — the same singletons the React view uses
- `setSession(sessionId)` — drives the projector's column-owner probe
- `applyCollapse(sessionId, turn, collapsed)` — synchronous fold/unfold
  (with `userDriven: true`; for the animation-path spec the
  `setCollapsed(...)` route is used to bypass userDriven and watch the
  MutationObserver-driven reconcile)
- `setCollapsed(sessionId, turn, state)`, `getCollapsed(...)` —
  passthrough to the persistence-backed `CollapseStore`

Summary rows in the fixture pages carry `data-dsh-ta-auto-collapse="true"`
or `"false"` to express each turn's `shouldAutoCollapse` verdict (the
fixture cannot read the engine's `TurnActivitySummary` node data, so the
test page declares the verdict per row).

Toggle buttons (`<button class="dsh-ta-toggle">`) are wired by the
fixture entry: `click` and `keydown` (Enter / Space) both route to the
same `applyTurnCollapse` call the React view would make.

## Why a separate bundle instead of `lib/client.js`?

`lib/client.js` is a CJS bundle wrapped in `window.__ModuleLoader__.load`
with `react`, `react/jsx-runtime`, and `@deepseek-ai/*` marked as
external — it requires a real DSH host. The projector itself (the file
we are actually testing) is a pure DOM + `localStorage` module and has
no runtime React / cordis dependency; the IIFE `lib/fixture.js` is a
purpose-built bundle that contains only the projector + store +
membership modules, so the static fixture pages can run it without a
DSH host.

## Debugging a single spec

```bash
npx playwright test --config=browser-integration/playwright.config.ts specs/03-toggle-no-jump.spec.ts
```

Set `headless: false` in `playwright.config.ts` to watch the animation
in a real browser. The fixture page is also reachable directly:
`http://127.0.0.1:3100/chat.html` after running the server standalone:

```bash
node plugin/browser-integration/server.mjs
```

## When the projector refactor lands

The 13 specs are the **regression net for the `refactor/projector-split`
work** (see `plugin/docs/architecture.md` + the plan in
`github-groovy-frost.md`). Every refactor commit must keep the suite at
13/13; a flake is treated as a behaviour change and the commit is
reverted.
