---
name: dts-formatter
description: 'Change the DeviceTree formatter in vscode-devicetree. Use when asked to fix indentation, alignment, comment preservation, line wrapping, cell-array or comma splitting, fsl,pins alignment, tabs vs spaces, or any formatting output that looks wrong. Explains the tokenize to parse to print pipeline in src/features/formatter/index.ts and the regression-test-first workflow.'
argument-hint: 'Describe the formatting defect with a before/after snippet'
---

# Change the DeviceTree Formatter

`src/features/formatter/index.ts` is the largest and most regression-prone module (~1100 lines) and
is covered by the biggest suite in `src/test/formatter.test.ts`. Work test-first.

## Pipeline

```
source string
  → tokenize()                     src/parser/lexer.ts
  → TokenStreamParser.parseProgram()  → Item[]  (NodeItem | PropertyItem | CommentItem | RawItem | BlankItem)
  → DtsFormatter.printItems()      → string[] lines
  → join + ResultFormat metadata
```

`DtsFormatter` is pure (string in, string out) and constructed with
`(useTabs, tabSize, maxLineLength, outputChannel)`. `DtsFormatterProvider` is the only part that
touches the VS Code API; it reads `editor.options` for tabs/indent and returns a single full-document
`TextEdit`.

## Where things live

| Concern | Entry point |
|---------|-------------|
| Node/property/comment recognition | `TokenStreamParser.parseItems`, `parseStatement` |
| Indentation and nesting | `printItems`, `calculateAlignmentForColumn` |
| Block/line comment output | `printComment`, `extractTrailingComment`, `consumeSameLineComment` |
| Value splitting on commas | `parseCommaSeparatedValues`, `consumeCommaEntry` |
| `< … >` cell arrays | `splitOuterAngleGroup`, `formatValueGroup` |
| One-line vs multi-line decision | `tryFormatAsSingleLine`, `formatAsMultiLine`, `formatMultiLineProperty` |
| `fsl,pins` key/value column alignment | `parseValueStructure`, `formatKeyValuePairs`, `calculateTabSpaceAlignment` |
| Tabs → spaces conversion | `replaceTabsWithSpaces` |

## Procedure

1. **Reproduce as a test first.** Add a `test()` to the matching suite in `formatter.test.ts`
   (`Comment Preservation`, `Comma Splitting`, `Indentation Options`, `fsl,pins Alignment`, …) with
   the exact input and expected output. Run it and confirm it fails for the reason you expect.
2. **Find the stage that is wrong.** Print the `Item[]` or the token stream before blaming the
   printer — parser bugs (swallowed trailing comments, mis-detected statement end) look like printer
   bugs. The `outputChannel` passed to `DtsFormatter` is available for tracing.
3. **Fix the narrowest stage.** Do not add a post-processing regex pass over the finished output;
   every such patch has caused a regression in another suite.
4. **Never drop source text.** Content after a mid-value comment, valueless boolean properties,
   preprocessor directives, and `RawItem` passthrough must survive verbatim.
5. **Respect both indent modes.** Any alignment change must be checked with tabs *and* spaces —
   there are dedicated `(spaces mode)` suites.
6. **Honour `maxLineLength`** when deciding to split, but never split inside a macro call,
   parenthesised argument list, string literal, or phandle reference.

## Verify

```bash
npm test 2>&1 | tail -80
```

The whole formatter suite must stay green — a targeted fix that breaks another formatter test is not
a fix. Then run `npm run lint` (`max-lines-per-function` 100 and `complexity` 15 are enforced;
extract a private helper instead of disabling).

Finally, format a real fixture (`src/test/imx8mp-evk.dts`) in the Extension Development Host and
diff against `imx8mp-evk-correct.dts` to catch whole-file regressions.
