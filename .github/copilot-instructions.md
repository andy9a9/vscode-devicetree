# vscode-devicetree — Project Guidelines

VS Code extension providing DeviceTree (`.dts`, `.dtsi`, `.dtso`) language support: syntax
highlighting, formatting, diagnostics, include links, structural syntax validation, and
validation through the external `dtc` compiler.

## Architecture

Single-process extension, no language server. Everything runs in the extension host.

| Path | Role |
|------|------|
| `src/extension.ts` | Activation, provider construction, command + listener registration, settings plumbing |
| `src/parser/lexer.ts` | Shared tokenizer (`tokenize()`, `Token`). Source of truth for lexing; do not re-implement |
| `src/features/formatter/` | `DtsFormatter` (pure string → string) + `DtsFormatterProvider` (VS Code glue) |
| `src/features/diagnostics/` | Line-length warnings, missing include-file diagnostics |
| `src/features/syntax-validator/` | Structural validation (brackets, semicolons) |
| `src/features/links/` | `DocumentLinkProvider` for `#include` resolution |
| `src/features/dtc-validator/` | Runs `cpp` then `dtc`, maps compiler output to diagnostics. Command-driven only |
| `src/utils/output-channel.ts` | Shared singleton `DeviceTree` output channel |
| `syntaxes/` | TextMate grammar + language configuration |
| `src/test/` | Mocha suites run inside a real VS Code instance |

### Rules that are easy to get wrong

- **Settings are read once, captured in closures.** `getSettings()` is called in `activate()` and in
  the `onDidChangeConfiguration` handler only. Never call it inside a document event handler.
  Listeners live in `documentListenerDisposables` and are disposed + re-registered when
  `devicetree.*` configuration changes.
- **Every provider owns a `DiagnosticCollection`** and must implement `clearDocument(document)` plus
  `dispose()`. The `onDidCloseTextDocument` listener is registered unconditionally so DTC
  diagnostics are always cleared, even when warnings are disabled.
- **Only one output channel.** Use `getOutputChannel()`; never call
  `vscode.window.createOutputChannel` in feature code.
- **VS Code does not expand `${workspaceFolder}`** in configuration values. Path settings must go
  through the manual substitution in the dtc validator (`resolveVscodeVars()`).
- **Spawning external tools must be cross-platform.** Pass `shell: true` only for `.cmd`/`.bat` on
  Windows; anything broader breaks argument quoting and anything narrower causes `EINVAL`.
- **New user-facing settings and commands must be added to `contributes` in `package.json`** and
  documented in `README.md`.

## Build and Test

```bash
npm install
npm run compile        # webpack bundle to dist/
npm run watch          # dev build, watch mode
npm run lint           # eslint src --max-warnings 0  (warnings fail)
npm test               # pretest compiles + lints, then runs vscode-test
npx tsc --noEmit       # fast type check
```

`npm test` downloads and launches VS Code. On headless Linux, CI wraps it with `xvfb-run -a`.
CI (`.github/workflows/test.yml`) runs lint on Ubuntu and tests on Ubuntu, Windows, and macOS —
keep behaviour and assertions platform-independent.

## Code Style

- TypeScript, 4-space indentation, single quotes, semicolons, trailing commas in multi-line literals.
- Explicit return types on functions; `const` by default; no `var`; no `any`.
- No floating promises — use `void somePromise()` when intentionally not awaiting.
- `no-console` except `console.warn` / `console.error`; prefer the shared output channel.
- Complexity budget is enforced: `max-depth` 4, `complexity` 15, `max-lines-per-function` 100
  (relaxed for `*.test.ts`). Extract helpers instead of suppressing.
- Add `eslint-disable` comments only when unavoidable and scoped to a single line.

## Conventions

- Commit messages follow Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`).
- Keep formatting/parsing logic pure and string-based so it can be tested without VS Code APIs.
- Add or extend a test for every behaviour change; see `CONTRIBUTING.md` for the full workflow.
