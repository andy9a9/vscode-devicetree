---
name: dts-feature
description: 'Add or modify a DeviceTree extension feature (provider, diagnostic, command, or setting) in vscode-devicetree. Use when asked to add a new provider, code action, hover, completion, diagnostic rule, command, or configuration option, or when wiring a feature into extension.ts. Covers the provider contract, listener lifecycle, package.json contributes, and the verification loop.'
argument-hint: 'Describe the feature (e.g. "add a hover provider for phandle references")'
---

# Add or Modify a DeviceTree Feature

## When to use

- A new provider under `src/features/<name>/`
- A new diagnostic rule in an existing provider
- A new command or configuration setting
- Rewiring activation, listeners, or settings in `src/extension.ts`

## Procedure

### 1. Locate the seam

Read `src/extension.ts` first — it is the only place that reads configuration and registers
providers, commands, and listeners. Then read the closest existing feature as a template:

| Goal | Template |
|------|----------|
| Document-scoped diagnostics | `src/features/diagnostics/index.ts` |
| Structural/token analysis | `src/features/syntax-validator/index.ts` |
| Links / navigation | `src/features/links/index.ts` |
| External tool integration | `src/features/dtc-validator/index.ts` |
| Pure text transformation + provider split | `src/features/formatter/index.ts` |

### 2. Implement the feature class

Create `src/features/<name>/index.ts` exporting a class that:

- takes injected settings via constructor parameters (never reads `getConfiguration()`),
- tokenizes with `tokenize()` from `src/parser/lexer.ts` rather than new regex scanning,
- owns a `DiagnosticCollection` if it reports problems, and sets `diagnostic.source`,
- exposes `updateSettings(...)`, `clearDocument(document)`, and `dispose()`.

Keep the analysis pure (string/token in, result out) and put VS Code API calls in a thin provider
wrapper so the core is unit-testable.

### 3. Wire it into `extension.ts`

- Declare a module-level `let <name>Provider: X | undefined;`
- Construct it in `activate()` with values from `getSettings()`
- Register with `context.subscriptions.push(vscode.languages.register…('dts', provider))`
- If it reacts to document events, add the subscription inside `registerDocumentListeners()` and
  push it to `documentListenerDisposables` — settings are captured in the closure
- Propagate configuration changes in `refreshOpenDocuments()`
- Dispose and reset to `undefined` in `deactivate()`

### 4. Declare contributions

Anything user-visible goes into `package.json` `contributes`:

- Settings under the `devicetree.` prefix with `type`, `default`, and `description`
- Commands with `"category": "Devicetree"` and a human title
- Add the setting/command to the matching table in `README.md`

### 5. Test

Add a suite in `src/test/<name>.test.ts`. See the test instructions file for the harness rules
(no workspace folder, `ConfigurationTarget.Global`, filtered diagnostic assertions, debounce delay).

### 6. Verify

```bash
npx tsc --noEmit
npm run lint
npm test
```

All three must be clean; lint fails on warnings. If `max-lines-per-function` (100) or
`complexity` (15) trips, extract a helper rather than disabling the rule.

### 7. Finish

Manually smoke-test with `F5` on a fixture in `src/test/`, then commit using Conventional Commits
(`feat:`, `fix:`, …). `CHANGELOG.md` is written at release time.
