---
applyTo: 'syntaxes/**/*.json'
description: 'Editing the DeviceTree TextMate grammar and language configuration.'
---

# Grammar and Language Configuration

- `dts.tmLanguage.json` — TextMate grammar, scope `source.dts`.
- `devicetree-language.json` — brackets, auto-closing pairs, comment tokens.

## Rules

- Keep scope names conventional so themes colour them correctly:
  `comment.block.dts`, `comment.line.double-slash.dts`, `string.quoted.double.dts`,
  `constant.numeric.hex.dts`, `entity.name.tag.dts`, `keyword.other.dts`,
  `meta.preprocessor.include.dts`, `variable.other.phandle.dts`.
- Comments must be matched **inside every nested context**, including cell arrays (`< ... >`),
  byte strings (`[ ... ]`), and property value lists. A missing `#include "comments"` in a
  repository pattern silently breaks highlighting inside that construct.
- Prefer `include`-ing a shared repository rule over duplicating a regex.
- Order patterns so comments and strings are matched before generic identifier/number rules,
  otherwise comment-like text inside strings gets mis-scoped.
- Escape backslashes for JSON (`\\b`, `\\s`) and keep regexes Oniguruma-compatible — no lookbehind
  of variable length, no `\d` inside character classes where POSIX classes are clearer.
- Verify changes by reloading the Extension Development Host (`F5`) and inspecting tokens with
  **Developer: Inspect Editor Tokens and Scopes** on a file in `src/test/`.
- Grammar changes are not covered by unit tests; state explicitly in the PR what was checked
  manually and add a representative snippet to a fixture file in `src/test/`.
