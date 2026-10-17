# Contributing to ApiMan

Thanks for helping! This guide gets you from a fresh clone to a tested change.

## Set up

Requirements: **Node.js 20+** (CI uses 24), **git**, and on macOS/Linux **openssl** (some network
tests generate TLS certificates with it; they're skipped if it's missing).

```bash
git clone https://github.com/gkravi/apiman.git
cd apiman
npm ci
```

## Everyday commands

| Command | What it does |
|---|---|
| `npm run dev` | Run the app with hot reload for the UI. Changes to `src/main`, `src/preload` or Node-only `src/core` files need a restart (Ctrl+C, then `npm run dev`) |
| `npm test` | Run all tests (Vitest) |
| `npx vitest src/core/run` | Run tests matching a path, in watch mode |
| `npm run typecheck` | Type-check the Node side and the web side separately |
| `npm run build` | Build the app (`out/`) and the CLI (`out/cli/apiman.cjs`) |
| `npm start` | Run the production build |
| `npm run dist:dir` | Build an unpacked app in `dist/` — the quickest way to test packaging |
| `npm run dist` | Build installers for your OS |

To try changes without touching your real workspace:

```bash
APIMAN_USER_DATA=/tmp/apiman-test npm run dev
```

## Project layout

```
src/
  core/        shared engine (pure + Node-only parts) — most logic and most tests live here
  main/        Electron main process
  preload/     the window.api bridge (api.d.ts is the contract)
  renderer/    React UI
  cli/         apiman command
docs/          user and developer documentation
build/         icon and macOS entitlements
```

Read [Architecture](docs/development/architecture.md) before larger changes.

## Making a change

1. **Branch** from `master`.
2. **Put logic in `src/core`** where possible, with tests next to it (`*.test.ts`). UI components
   should stay thin.
3. **Respect the pure/Node split.** If a core file imports `node:*` or a Node-only package, add it to
   the `exclude` list in `tsconfig.web.json` and only import it from `src/main` or `src/cli`.
4. **New IPC?** Add the handler in `src/main`, the method in `src/preload/index.ts` and its type in
   `src/preload/api.d.ts`.
5. **Tests:** features touching the network get an integration test against a local server (see
   `network.test.ts`, `realtime.test.ts`); no test should call the public internet.
6. **Docs:** update the relevant page in `docs/` and add a line to `CHANGELOG.md` under *Unreleased*.
7. Run `npm run typecheck && npm test && npm run build` before pushing.

## Code style

- TypeScript strict mode; avoid `any` outside parsers of untrusted JSON.
- Match the surrounding code: small functions, comments that explain *why*, no dead code.
- React components export only components (helpers go in separate modules) so Fast Refresh works.
- Effects must return a cleanup function or nothing — watch out for arrow functions that implicitly
  return a value.

## Pull requests

- CI runs typecheck, tests and build on Ubuntu and macOS, and typecheck + build on Windows. It must
  be green.
- Describe what changed and how you tested it. Screenshots help for UI changes.

## Releasing

See [Releasing](docs/development/releasing.md).
