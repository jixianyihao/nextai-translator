# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

See also `AGENTS.md` for commit style, testing expectations, and directory-level conventions — the notes below focus on architecture that isn't obvious from the file tree.

## Commands

Package manager is pinned to `pnpm@9.1.3`. Install with `pnpm install`.

-   **Desktop dev**: `pnpm dev-tauri` (boots Tauri shell + Vite renderer on port 3333 — port is strict, fails if taken)
-   **Browser-extension dev**: `pnpm dev-chromium` (Chromium HMR) / `pnpm dev-firefox` (watch build)
-   **Builds**: `pnpm build-tauri`, `pnpm build-browser-extension`, `pnpm build-userscript`. `pnpm clean` wipes `dist/`.
-   **Unit tests**: `pnpm test` (Vitest, jsdom, root is `src/`). Run a single file with `pnpm test src/common/engines/moonshot.spec.ts`, or a name pattern with `-t "<name>"`.
-   **E2E**: `pnpm test:e2e` (Playwright, retries=2, tests under `e2e/`).
-   **Lint/format**: `pnpm lint` (cached), `pnpm lint:fix`, `pnpm format`. Pre-commit runs lint-staged.
-   **Versioning**: `make change-version VERSION=x.y.z` rewrites `src-tauri/tauri.conf.json`; `make change-package-version` rewrites `package.json`. Keep both and `src-tauri/Cargo.toml` in sync on releases.

Windows/bash note: use forward slashes; `pnpm` scripts assume Unix-shell semantics (e.g. `dev-firefox` uses `NODE_ENV=development` inline).

## Architecture

### Three build targets, one source tree

The same TypeScript/React code is packaged into three distinct runtime hosts, each driven by its own Vite config:

| Target             | Entry config                | Host                                                                                       |
| ------------------ | --------------------------- | ------------------------------------------------------------------------------------------ |
| Chromium extension | `vite.config.chromium.ts`   | `@samrum/vite-plugin-web-extension` with manifest from `src/browser-extension/manifest.ts` |
| Firefox extension  | `vite.config.firefox.ts`    | same plugin, MV2 manifest                                                                  |
| Userscript         | `vite.config.userscript.ts` | `vite-plugin-monkey` (Tampermonkey)                                                        |
| Tauri desktop      | `vite.config.tauri.ts`      | Rust backend in `src-tauri/`                                                               |

Shared app code is in `src/common/`; target-specific glue lives in `src/browser-extension/` and `src/tauri/`. The `@/*` path alias resolves to `src/*` via `tsconfig.json` + `vite-tsconfig-paths` in every config.

### Runtime detection is load-bearing

Because one codebase runs in four hosts, code in `src/common/` branches via `isTauri()`, `isDesktopApp()` (= Electron or Tauri), `isUserscript()`, `isBrowserExtensionOptions()`, `isBrowserExtensionContentScript()` from `src/common/utils.ts`. When adding features that touch networking, storage, clipboard, or OS APIs, check which hosts you're supporting and branch accordingly — don't assume DOM/browser-extension APIs exist.

### Universal fetch

`getUniversalFetch()` in `src/common/universal-fetch.ts` returns the right adapter:

-   Tauri → `tauriFetch` (goes through `fetch_stream` Rust command for SSE streaming)
-   Userscript → `userscriptFetch` (GM_xmlhttpRequest)
-   Browser extension → `backgroundFetch` (routed via the background script to bypass CORS)

Never call `window.fetch` directly for LLM/provider requests — you'll break at least two targets. Use `getUniversalFetch()` or `fetchSSE` from `utils.ts`.

### LLM engine plugin system

`src/common/engines/` is a provider registry. Each provider is a class implementing `IEngine` (`interfaces.ts`): `getModel`, `listModels`, `sendMessage`, plus capability flags (`isLocal`, `supportCustomModel`). OpenAI-compatible providers extend `AbstractOpenAI` (handles both Chat Completions and Responses API, SSE parsing, and path selection). Non-OpenAI providers (Claude, Gemini, Cohere, etc.) extend `AbstractEngine` directly.

To add a provider:

1. Create `src/common/engines/<name>.ts` implementing `IEngine`.
2. Add the name to the `Provider` union, `providerToEngine` map, and `engineIcons` map in `engines/index.ts`.
3. Add any new settings keys to `ISettings` in `src/common/types.ts` **and** to `settingKeys` in `src/common/utils.ts` (the keys record exists so TypeScript flags missing entries when reading from storage — don't skip it).
4. Add UI in `src/common/components/Settings.tsx`.
5. Document env/setup in `docs/` per AGENTS.md.

### Tauri ↔ TS bindings

`src/tauri/bindings.ts` is **auto-generated** by `tauri-specta` at Rust build time — do not edit it manually. Rust commands marked with `#[tauri::command]` + `specta::specta` in `src-tauri/src/*.rs` (entry `main.rs`, handlers split across `fetch.rs`, `writing.rs`, `ocr.rs`, `windows.rs`, `insertion.rs`, `config.rs`) are exposed as typed async functions on the `commands` object. When adding a command: add it in Rust, rebuild (`pnpm dev-tauri` regenerates), then import from `@/tauri/bindings`.

The Rust side holds several global `Mutex`/`OnceCell` statics (see top of `main.rs`) for selected text, active window, update state, etc. Platform-specific behavior (tray, window placement, shortcuts, clip/OCR, keystroke insertion) lives in the corresponding module.

### Translation pipeline

`src/common/translate.ts` owns the top-level `translate()` entry used by all UIs. It selects an engine via `getEngine(provider)`, builds a prompt based on `TranslateMode` (`translate`/`polishing`/`summarize`/`analyze`/`explain-code`/`big-bang`) and the `Action` record from the internal DB, then streams chunks through `onMessage` callbacks. Custom actions and history are persisted via Dexie (`src/common/internal-services/db.ts`).

### State & persistence

-   Settings read/write through `getSettings`/`setSettings` in `utils.ts` — browser storage in the extension, Tauri filesystem in desktop. The `settingKeys` map is the single source of truth for which keys round-trip through storage.
-   Zustand + Jotai are both present (`src/common/store/`) — prefer the existing store for a given surface rather than introducing a third pattern.
-   IndexedDB via Dexie for actions/history/vocabulary; schema is in `internal-services/db.ts`.

### Testing shape

Vitest runs with `root: 'src'` and globals enabled — unit tests sit beside source as `*.spec.ts` / `*.test.ts`. Tests that would hit a real network should mock `getUniversalFetch` / `fetchSSE` rather than `window.fetch`. Playwright specs in `e2e/` target the browser-extension build and share setup via `e2e/fixtures.ts`.
