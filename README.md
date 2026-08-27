[English](README.md) | [中文](README.zh-CN.md)

# dsh-turnfold

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![DSH](https://img.shields.io/badge/DSH-0.1.1--rc.2-blue)](https://github.com/deepseek-ai/dsh-client-runtime)
[![Release](https://img.shields.io/badge/Release-v0.2.8-green)](https://github.com/UNscientific-9/dsh-turnfold/releases/tag/v0.2.8)

> A Codex/ZCode-style turn activity collapse plugin for [DSH Web](https://github.com/deepseek-ai/dsh-client-runtime). While the agent works, thinking / tool calls / narration stay fully visible. **When a turn completes, the activity collapses into a one-line summary** so the final answer becomes the visual focus.

![Collapsed turn](docs/screenshot.png)

## What it is

Long agentic turns produce a lot of intermediate output: planning text, tool calls, tool results, retries, and chunks of thinking. Reading the final answer afterwards means scrolling past all of it.

This plugin watches the DSH session event stream. When a turn ends with `reason.kind === 'completed'` and a final message exists, it folds the activity block into a single persistent summary line — `This turn took 2m 38s · 7 tool calls · 3 reasoning segments` — with a subtle divider. Click the summary to expand and re-collapse at will. Your choice persists across reloads.

The plugin is **purely client-side**. It does not modify the DSH backend, the session store, or any user data. Unloading it leaves zero residue on the server and on disk.

## Effect

```
(Previous turn content)

User message...
› This turn took 2m 38s · 7 tool calls · 3 reasoning segments   ← clickable
──────────────────────────────────  ← divider
Final answer...
```

## Core features

- **Auto-collapse** — turns that end normally collapse to a one-line summary. Aborted / blocked / error turns stay expanded; you can still fold them by hand.
- **Synthetic summaries** — for very long sessions where DSH has only loaded a slice of history, turns that fall outside the loaded window also get a synthetic summary line (showing step count and tool count).
- **Auto-load earlier** — scrolling near the top of the conversation automatically calls DSH's "load earlier", and old turns get folded as they arrive.
- **State persistence** — collapse / expand choices are stored in localStorage and survive page refreshes and session reopens. Even the state of older turns is remembered (via a membership snapshot).
- **Position correctness** — the summary line is fixed between the user message and the final answer of that turn (0.2.6 anchor fix).

## Install

1. Make sure DSH web (`dsh` CLI) is installed, version 0.1.1-rc.2 series.
2. Edit `%USERPROFILE%\.dsh\profiles\web\package.json` and add the dependency:
   ```json
   {
     "dependencies": {
       "@UNscientific-9/dsh-turnfold": "file:D:/path/to/dsh-turnfold-0.2.8.tgz"
     }
   }
   ```
3. In the profile directory, run `pnpm install`, then restart DSH web and hard-refresh the browser (`Ctrl+Shift+R` / `Cmd+Shift+R`).
4. The browser console should show `[dsh.turnfold] v0.2.8 loaded` on load.

## Compatibility & uninstall

| Topic | Detail |
|---|---|
| DSH version | `@deepseek-ai/dsh-client-runtime` / `dsh-client-ui-conversation` / `dsh-session` 0.1.1-rc.2 |
| Uninstall | Remove the line from `%USERPROFILE%\.dsh\profiles\web\package.json`, run `pnpm install`, restart, hard-refresh |
| Reset collapse state | DevTools console: `localStorage.removeItem('dsh.turn-collapse.v1')`, then refresh |

## Configuration (localStorage)

| Key | Default | Effect |
|---|---|---|
| `dsh.turn-collapse.autoLoad` | `'1'` | Set to `'0'` to disable auto-load of older turns on scroll-near-top |
| `dsh.turn-collapse.debug` | unset | Set to `'1'` to enable reconcile diagnostic logs in the console |

## Documentation

- Full user guide and FAQ: [plugin/README.md](plugin/README.md)
- Architecture (state machine + DOM contract): [plugin/docs/architecture.md](plugin/docs/architecture.md)
- UI / CSS spec: [plugin/docs/ui-spec.md](plugin/docs/ui-spec.md)
- DSH version upgrade checklist: [plugin/docs/maintenance.md](plugin/docs/maintenance.md)

## License

[MIT](LICENSE)
