---
name: dts-testing
description: 'Run, write, and debug the vscode-devicetree test suite and fix cross-platform CI failures. Use when tests fail, hang, or pass locally but fail on Windows/macOS CI, when adding a Mocha suite for a provider, when diagnostics assertions are flaky, or when the vscode-test harness cannot launch (headless Linux, xvfb, missing display).'
argument-hint: 'Describe the failing test or the behaviour you want covered'
---

# Test and Debug vscode-devicetree

Tests are Mocha suites executed inside a downloaded VS Code instance via `@vscode/test-cli`.

## Commands

```bash
npm test                 # pretest: compile-tests + compile + lint, then vscode-test
npm run compile-tests    # tsc -p . --outDir out   (tests run from out/)
npm run watch-tests
npx tsc --noEmit         # fastest way to catch type errors
xvfb-run -a npm test     # headless Linux (what CI does)
```

`npm test 2>&1 | tail -120` keeps the output readable; the harness prints unrelated VS Code
telemetry lines that are not failures.

## Writing a suite

1. Create `src/test/<feature>.test.ts`.
2. Activate the extension in `suiteSetup` via
   `vscode.extensions.getExtension('andy9a9.vscode-devicetree')`.
3. Open documents in-memory: `vscode.workspace.openTextDocument({ language: 'dts', content })`.
4. Wait out the ~500 ms diagnostic debounce before reading diagnostics.
5. Assert on a **filtered** subset, never on the raw diagnostic count.

```typescript
function getLineLengthDiagnostics(diagnostics: vscode.Diagnostic[]): vscode.Diagnostic[] {
    return diagnostics.filter(d =>
        d.source === 'DeviceTree' &&
        d.severity === vscode.DiagnosticSeverity.Warning &&
        d.message.includes('exceeds maximum length')
    );
}
```

6. Pass a formatted dump of *all* diagnostics as the assertion message so a CI failure is
   self-explanatory.

## Settings in tests

There is no workspace folder during tests. Always:

```typescript
const config = vscode.workspace.getConfiguration('devicetree');
const original = config.get('maxLineLength');
await config.update('maxLineLength', 100, vscode.ConfigurationTarget.Global);
// … suiteTeardown restores `original`
```

`ConfigurationTarget.Workspace` throws because no workspace is open.

## Faking external tools (dtc/cpp)

Do not require a real toolchain. Write a Node script into `fs.mkdtempSync(path.join(os.tmpdir(), …))`
and create a launcher next to it — a `.cmd` shim on Windows, a `chmod +x` shell wrapper elsewhere —
then point `devicetree.DTCCompilerPath` / `devicetree.CPreprocessorPath` at it. `dtc-validator.test.ts`
is the working reference.

## Cross-platform failure playbook

| Symptom | Cause | Fix |
|---|---|---|
| `spawn EINVAL` on Windows | spawning a `.cmd`/`.bat` without a shell | `shell: process.platform === 'win32' && /\.(cmd\|bat)$/i.test(bin)` |
| Argument quoting broken on Linux/macOS | `shell: true` applied unconditionally | narrow the condition as above |
| `expected 1 to equal 0` only on macOS | assertion counts diagnostics from other providers | filter by `source` + message |
| Test passes alone, fails in suite | leaked global setting from a previous suite | restore in `suiteTeardown` |
| Harness never starts on Linux CI | no display | `xvfb-run -a npm test` |
| Path assertion fails on Windows | hard-coded `/` separators | `path.join()` / compare `vscode.Uri.fsPath` normalised |

## Before declaring done

```bash
npx tsc --noEmit && npm run lint && npm test
```

Lint runs with `--max-warnings 0`. Fixture `.dts` files belong in `src/test/`.
