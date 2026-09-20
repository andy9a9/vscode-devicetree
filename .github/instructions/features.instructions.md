---
applyTo: 'src/features/**/*.ts,src/extension.ts'
description: 'Provider lifecycle, diagnostics, settings, and external process rules for feature code.'
---

# Feature Provider Rules

## Provider contract

Every feature class in `src/features/*/index.ts` must:

1. Own its `vscode.DiagnosticCollection`, created in the constructor with a stable name.
2. Expose `clearDocument(document: vscode.TextDocument): void`.
3. Expose `updateSettings(...)` if it depends on configuration, instead of re-reading config itself.
4. Implement `dispose(): void` that disposes the collection, and be disposed in `deactivate()`.
5. Set `diagnostic.source` on every diagnostic it produces so tests and other providers can filter.

Providers must not call `vscode.workspace.getConfiguration()` — `src/extension.ts` reads settings
once and injects them.

## Listener lifecycle in `extension.ts`

- Register document listeners only through `registerDocumentListeners(context, settings)`; push each
  subscription into `documentListenerDisposables`.
- On `onDidChangeConfiguration` for `devicetree`: recompute settings, call `refreshOpenDocuments()`,
  then `clearDocumentListeners()` followed by `registerDocumentListeners()`.
- Never call `getSettings()` inside a document event handler — the settings are captured in the
  listener closure by design.
- The close listener is registered unconditionally so DTC diagnostics are cleared even when
  warnings and syntax validation are disabled.

## Pure logic vs VS Code glue

Keep analysis and formatting logic string/token based and free of `vscode` imports where possible
(`DtsFormatter` vs `DtsFormatterProvider` is the reference pattern). Tokenize with `tokenize()` from
`src/parser/lexer.ts`; do not write ad-hoc regex lexers.

## External processes

- Resolve configured paths through the `${workspaceFolder}` substitution helper — VS Code does not
  expand variables in settings values.
- `shell: true` only when `process.platform === 'win32'` and the binary ends in `.cmd`/`.bat`.
- Always write temp files under `os.tmpdir()` with `fs.mkdtempSync()` and remove them in a `finally`.
- Log tool invocations and raw output to `getOutputChannel()`; only surface a modal/notification in
  interactive (command-triggered) mode.
- Guard against concurrent runs per document.

## Configuration

Adding a setting requires: `contributes.configuration` entry in `package.json`, a field in
`DevicetreeSettings`, a read in `getSettings()`, propagation through `refreshOpenDocuments()`,
a README entry, and a test.
