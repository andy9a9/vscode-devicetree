---
applyTo: 'src/test/**/*.ts'
description: 'Conventions for Mocha tests that run inside the VS Code extension host (vscode-test).'
---

# Test Conventions

Tests are Mocha suites executed inside a real VS Code instance by `@vscode/test-cli`
(`.vscode-test.mjs` → `out/test/**/*.test.js`). They are compiled by `npm run compile-tests`.

## Structure

- File name: `<feature>.test.ts`, one suite per behaviour group.
- Activate the extension once per file:

```typescript
suiteSetup(async () => {
    const extension = vscode.extensions.getExtension('andy9a9.vscode-devicetree');
    if (extension && !extension.isActive) {
        await extension.activate();
    }
});
```

- Use `suite()` / `test()` (TDD interface), `assert` from `node:assert`, arrange–act–assert bodies.
- Fixture `.dts` files live next to the tests in `src/test/`. Prefer inline string input for small
  cases so the expectation is visible in the test.

## Hard requirements

- **No workspace folder exists during tests.** `vscode.workspace.workspaceFolders` is `undefined`.
  Never rely on a workspace root, and always update settings with
  `vscode.ConfigurationTarget.Global`.
- **Restore every setting you change** in `suiteTeardown`, saving the original with `config.get()`
  first.
- **Assert on filtered diagnostics, never on `.length` of everything.** Other providers contribute
  diagnostics for the same document and the set differs per platform. Filter by `source`,
  `severity`, and a message fragment first.
- **Include context in failure messages**, e.g. a formatted dump of all diagnostics, so CI failures
  on Windows/macOS are diagnosable from the log alone.
- **Keep tests platform-independent.** No hard-coded `/tmp`, path separators, or shell built-ins.
  Use `os.tmpdir()`, `path.join()`, and `fs.mkdtempSync()`; clean up in `suiteTeardown`.
- **Do not depend on real external tools.** For `dtc`/`cpp`, generate a Node script plus a platform
  launcher in a temp dir and point the settings at it — see `dtc-validator.test.ts`.
- Diagnostics are debounced (~500 ms). Await a slightly longer delay before reading them.

## Allowances

- `max-lines-per-function` is disabled for `*.test.ts`; long suites are fine.
- All other lint rules still apply and `npm run lint` fails on warnings.
