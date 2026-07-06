import * as vscode from 'vscode';
import { Token, TokenType, tokenize } from '../../parser/lexer';

/**
 * Interface for formatting operation results
 */
interface ResultFormat {
    success: boolean;
    message?: string;
}

/**
 * Returns +1/-1/0 for tokens that open/close a `<>`, `[]`, or `()` pair.
 * @param t The token to inspect.
 * @returns `1` for openers, `-1` for closers, and `0` otherwise.
 */
function bracketDelta(t: Token): number {
    if (t.type === TokenType.LAngle || t.type === TokenType.LBracket || t.type === TokenType.LParen) {
        return 1;
    }
    if (t.type === TokenType.RAngle || t.type === TokenType.RBracket || t.type === TokenType.RParen) {
        return -1;
    }
    return 0;
}

/**
 * Structural items produced by the token-based parser
 */

/**
 * A DTS node block: `label: name@addr { ...children... };`.
 */
interface NodeItem {
    kind: 'node';
    /* Normalized header text, without the trailing ` {`. */
    header: string;
    children: Item[];
    /* Same-line comment following the closing `};`, if any. */
    trailingComment: string;
}

/**
 * A property assignment: `name = value;`.
 */
interface PropertyItem {
    kind: 'property';
    name: string;
    /* Raw source text between `=` and `;`, with any same-line trailing comment appended. */
    value: string;
}

/**
 * A standalone comment (line or block) that isn't attached to the end of a statement.
 */
interface CommentItem {
    kind: 'comment';
    text: string;
}

/**
 * Anything else that ends in `;` - preprocessor/DTS directives, `#include`, `/delete-node/ &x;`, etc.
 */
interface RawItem {
    kind: 'raw';
    text: string;
}

/**
 * A blank line separating items, preserved (and collapsed) from the original source.
 */
interface BlankItem {
    kind: 'blank';
}

type Item = NodeItem | PropertyItem | CommentItem | RawItem | BlankItem;

/**
 * Walks the token stream produced by the DTS `Lexer` and builds a lightweight
 * structural tree of nodes/properties/comments/directives.
 *
 * Using tokens (rather than whole-document regexes) makes statement
 * boundaries unambiguous even in the presence of strings, comments, or
 * brackets that a naive line/regex scan could miscount - the lexer has
 * already resolved those. The tree only records *where* each statement
 * starts/ends (via source offsets) and what kind of statement it is; the
 * fine-grained rendering of a property's value (alignment, wrapping,
 * comma vs. whitespace-separated arrays, etc.) is still done by the existing
 * string-based layout helpers on `DtsFormatter`, since that logic never
 * depended on the fragile whole-document regexes in the first place.
 */
class TokenStreamParser {
    private readonly tokens: Token[];
    private readonly source: string;
    private pos = 0;

    /**
     * Create a parser over a token array and its original source text.
     * @param tokens The token array to parse.
     * @param source The original source text.
     */
    constructor(tokens: Token[], source: string) {
        this.tokens = tokens;
        this.source = source;
    }

    /**
     * Parse the full token stream into a top-level item list.
     * @returns Top-level parsed items.
     */
    parseProgram(): Item[] {
        return this.parseItems(false);
    }

    /**
     * Count newline characters in a string.
     * @param s The string to measure.
     * @returns Number of newline characters.
     */
    private countNewlines(s: string): number {
        return (s.match(/\n/g) ?? []).length;
    }

    /**
     * Skip whitespace tokens that don't contain a newline (same-line gaps).
     */
    private skipInlineWhitespace(): void {
        while (
            this.tokens[this.pos]?.type === TokenType.Whitespace &&
            this.countNewlines(this.tokens[this.pos].value) === 0
        ) {
            this.pos++;
        }
    }

    /**
     * If a comment immediately follows (same line), consume and return its text.
     * @returns The trailing comment text, or an empty string.
     */
    private consumeSameLineComment(): string {
        this.skipInlineWhitespace();
        const t = this.tokens[this.pos];
        if (t && (t.type === TokenType.LineComment || t.type === TokenType.BlockComment)) {
            this.pos++;
            return t.value;
        }
        return '';
    }

    /**
     * Parse a sequence of items. When `insideBraces` is true, stops (without
     * consuming) at the matching `}` so the caller can consume it.
     */
    private parseItems(insideBraces: boolean): Item[] {
        const items: Item[] = [];
        let pendingBlank = false;

        while (this.pos < this.tokens.length) {
            const t = this.tokens[this.pos];
            if (t.type === TokenType.EOF) {
                break;
            }
            if (insideBraces && t.type === TokenType.RBrace) {
                break;
            }

            if (t.type === TokenType.Whitespace) {
                if (this.countNewlines(t.value) >= 2) {
                    pendingBlank = true;
                }
                this.pos++;
                continue;
            }

            if (t.type === TokenType.LineComment || t.type === TokenType.BlockComment) {
                if (pendingBlank) { items.push({ kind: 'blank' }); pendingBlank = false; }
                items.push({ kind: 'comment', text: t.value });
                this.pos++;
                continue;
            }

            if (t.type === TokenType.Include) {
                // #include directives are a single self-contained token with no
                // trailing ';' - handle them before the generic statement scan.
                if (pendingBlank) { items.push({ kind: 'blank' }); pendingBlank = false; }
                this.pos++;
                const trailingComment = this.consumeSameLineComment();
                items.push({
                    kind: 'raw',
                    text: trailingComment ? `${t.value} ${trailingComment}` : t.value,
                });
                continue;
            }

            if (pendingBlank) { items.push({ kind: 'blank' }); pendingBlank = false; }
            items.push(this.parseStatement());
        }

        return items;
    }

    /**
     * Finish parsing a node block once its opening `{` has been found.
     * @param headerRaw The raw node header.
     * @returns The parsed node item.
     */
    private finishNodeStatement(headerRaw: string): NodeItem {
        this.pos++; // consume '{'
        const children = this.parseItems(true);
        if (this.tokens[this.pos]?.type === TokenType.RBrace) {
            this.pos++; // consume '}'
        }
        this.skipInlineWhitespace();
        if (this.tokens[this.pos]?.type === TokenType.Semicolon ||
            this.tokens[this.pos]?.type === TokenType.Comma) {
            this.pos++;
        }
        const trailingComment = this.consumeSameLineComment();
        return { kind: 'node', header: this.normalizeHeader(headerRaw), children, trailingComment };
    }

    /**
     * Finish parsing a property or raw directive once its terminating `;` has been found.
     * @param headerStart Start offset of the statement.
     * @param stmtEnd End offset of the statement.
     * @param equalsIdx Index of the top-level `=` token, or `-1`.
     * @returns The parsed property or raw item.
     */
    private finishSimpleStatement(headerStart: number, stmtEnd: number, equalsIdx: number): PropertyItem | RawItem {
        this.pos++; // consume ';'
        const trailingComment = this.consumeSameLineComment();

        if (equalsIdx !== -1) {
            const eqTok = this.tokens[equalsIdx];
            const name = this.source.slice(headerStart, eqTok.offset).trim();
            const rawValue = this.source.slice(eqTok.offset + 1, stmtEnd);
            return {
                kind: 'property',
                name,
                value: trailingComment ? `${rawValue} ${trailingComment}` : rawValue,
            };
        }

        const rawText = this.source.slice(headerStart, stmtEnd).replace(/\s+/g, ' ').trim();
        return {
            kind: 'raw',
            text: trailingComment ? `${rawText}; ${trailingComment}` : `${rawText};`,
        };
    }

    /**
     * Parse one statement starting at the current position: a node block
     * (terminated by a top-level `{`), or a property/raw directive
     * (terminated by a top-level `;`).
     */
    private parseStatement(): Item {
        const headerStart = this.tokens[this.pos].offset;
        let depth = 0;
        let equalsIdx = -1;

        while (this.pos < this.tokens.length) {
            const t = this.tokens[this.pos];
            if (t.type === TokenType.EOF) {
                break;
            }

            depth = Math.max(0, depth + bracketDelta(t));

            if (depth === 0 && t.type === TokenType.Equals && equalsIdx === -1) {
                equalsIdx = this.pos;
            }

            if (depth === 0 && t.type === TokenType.LBrace) {
                return this.finishNodeStatement(this.source.slice(headerStart, t.offset));
            }

            if (depth === 0 && t.type === TokenType.Semicolon) {
                return this.finishSimpleStatement(headerStart, t.offset, equalsIdx);
            }

            this.pos++;
        }

        // Reached EOF without a terminator (malformed input) - surface what's left as-is.
        return { kind: 'raw', text: this.source.slice(headerStart).trim() };
    }

    /**
     * Normalize a node header's spacing:
     *  - `label:` -> `label: `
     *  - `&ref`   -> `&ref` (no space introduced between `&` and the name)
     *  - `name@0*addr` -> `name@addr` (strip leading zeros from the unit address)
     */
    private normalizeHeader(raw: string): string {
        let h = raw.replace(/\s+/g, ' ').trim();
        h = h.replace(/([\w,-]+)\s*:\s*/g, '$1: ');
        h = h.replace(/&\s+/g, '&');
        h = h.replace(/([\w,-]+)\s*@\s*0*([\da-fA-F]+)\s*$/, '$1@$2');
        return h;
    }
}

/**
 * Parsed value shape used by parseValueStructure / formatKeyValuePairs
 */
interface ParsedValue {
    key: string;
    valueInside: string;
    trailingPunct: string;
    comment: string;
    isLast: boolean;
    hasKeyValue: boolean;
    originalValue: string;
}

/**
 * DeviceTree Source (.dts) formatter class
 * Handles formatting of DeviceTree source files with proper indentation,
 * line wrapping, and comment alignment.
 *
 * The document is tokenized once (see `../../parser/lexer`), parsed into a
 * structural tree by `TokenStreamParser`, and then rendered by walking that
 * tree - indentation comes directly from tree depth rather than from
 * counting braces line-by-line.
 */
export class DtsFormatter {
    private readonly useTabs: boolean;
    private readonly tabSize: number;
    private readonly maxLineLength: number;
    private readonly outputChannel: vscode.OutputChannel;

    /**
     * Create a formatter with the current indentation and line-length settings.
     * @param useTabs Whether tabs should be used for indentation.
     * @param tabSize Tab width used for alignment.
     * @param maxLineLength Maximum allowed line length.
     * @param outputChannel Output channel used for formatter messages.
     */
    constructor(useTabs: boolean, tabSize: number, maxLineLength: number, outputChannel: vscode.OutputChannel) {
        this.useTabs = useTabs;
        this.tabSize = tabSize;
        this.maxLineLength = maxLineLength;
        this.outputChannel = outputChannel;
    }

    /**
     * Main formatting method that processes the entire DTS content.
     * @param data The DTS content to format.
     * @returns Tuple of formatted content and format result status.
     */
    format(data: string): [string, ResultFormat] {
        try {
            const normalized = data.replace(/\r\n/g, '\n');
            const tokens = tokenize(normalized);
            const items = new TokenStreamParser(tokens, normalized).parseProgram();
            const indentStep = this.useTabs ? '\t' : ' '.repeat(this.tabSize);
            const lines = this.printItems(items, 0, indentStep);

            this.outputChannel.appendLine('Formatting successful');
            return [lines.join('\n'), { success: true }];
        } catch (ex) {
            const errorMessage = ex instanceof Error ? ex.message : String(ex);
            return ['', { success: false, message: `Formatting failed: ${errorMessage}` }];
        }
    }

    /**
     * Render a sequence of sibling items at a given indentation depth.
     * Leading/trailing blank items within a block are dropped, and runs of
     * consecutive blank items collapse to a single blank line.
     * @param items The items to render.
     * @param depth The indentation depth.
     * @param indentStep The string used for one indentation step.
     * @returns Rendered lines.
     */
    private printItems(items: Item[], depth: number, indentStep: string): string[] {
        const lines: string[] = [];
        let lastWasBlank = false;

        items.forEach((item, idx) => {
            if (item.kind === 'blank') {
                if (lines.length === 0 || idx === items.length - 1 || lastWasBlank) {
                    return;
                }
                lines.push('');
                lastWasBlank = true;
                return;
            }

            lastWasBlank = false;
            const indent = indentStep.repeat(depth);

            switch (item.kind) {
                case 'comment':
                    lines.push(...this.printComment(item.text, indent));
                    break;
                case 'node':
                    lines.push(`${indent}${item.header} {`);
                    lines.push(...this.printItems(item.children, depth + 1, indentStep));
                    lines.push(item.trailingComment ? `${indent}}; ${item.trailingComment}` : `${indent}};`);
                    break;
                case 'raw':
                    lines.push(`${indent}${item.text}`);
                    break;
                case 'property':
                    lines.push(this.formatProperty(indent, item.name, item.value));
                    break;
                default:
                    break;
            }
        });

        return lines;
    }

    /**
     * Render a standalone comment. Block-comment continuation lines are
     * re-indented to `indent + " *"` so alignment stays correct regardless
     * of the comment's original indentation in the source.
     * @param text The comment text.
     * @param indent The indentation prefix.
     * @returns Rendered comment lines.
     */
    private printComment(text: string, indent: string): string[] {
        const rawLines = text.split('\n');
        if (rawLines.length === 1) {
            return [indent + rawLines[0].trim()];
        }
        return rawLines.map((line, i) => {
            if (i === 0) {
                return indent + line.trim();
            }
            const m = line.match(/^[ \t]*(\*.*)$/);
            if (m) {
                return indent + ' ' + m[1];
            }
            return indent + line.trim();
        });
    }

    /**
     * Split `valueAndComment` into the value text and a genuine *trailing*
     * comment, if the last meaningful token is a comment.
     *
     * This is token-based (rather than a lazy regex match) specifically so a
     * comment that sits *inside* the value - e.g. `<0x1000 /* base *\/ 0x100>`
     * - is left untouched as part of the value instead of being mistaken for
     * the trailing comment and having everything after it discarded.
     */
    private extractTrailingComment(valueAndComment: string): { cleanVal: string; comment: string } {
        const tokens = tokenize(valueAndComment);
        let lastMeaningful: Token | undefined;

        for (let i = tokens.length - 1; i >= 0; i--) {
            const t = tokens[i];
            if (t.type === TokenType.EOF || t.type === TokenType.Whitespace) {
                continue;
            }
            lastMeaningful = t;
            break;
        }

        if (!lastMeaningful ||
            (lastMeaningful.type !== TokenType.LineComment && lastMeaningful.type !== TokenType.BlockComment)) {
            return { cleanVal: valueAndComment.trim(), comment: '' };
        }

        return {
            cleanVal: valueAndComment.slice(0, lastMeaningful.offset).trim(),
            comment: lastMeaningful.value,
        };
    }

    /**
     * Format a single property assignment, trying a single-line rendering
     * first and falling back to multi-line wrapping/alignment.
     * @param indentation Current indentation level
     * @param prop Property name
     * @param valueAndComment Raw value text (between `=` and `;`), with any
     *   same-line trailing comment already appended
     */
    private formatProperty(indentation: string, prop: string, valueAndComment: string): string {
        if (!valueAndComment.includes('\n')) {
            const { cleanVal, comment } = this.extractTrailingComment(valueAndComment);
            const fullLine = `${indentation}${prop} = ${cleanVal}${comment ? `; ${comment}` : ';'}`;
            if (this.replaceTabsWithSpaces(fullLine).length <= this.maxLineLength &&
                (this.useTabs || !cleanVal.includes('\t'))) {
                return fullLine;
            }
        }

        return this.formatMultiLineProperty(indentation, prop, valueAndComment);
    }

    /**
     * Convert tabs to spaces for length calculations
     * @param data The content with tabs
     * @returns Content with tabs replaced by spaces
     */
    private replaceTabsWithSpaces(data: string): string {
        return data.replace(/\t/g, ' '.repeat(this.tabSize));
    }

    /**
     * Parse comma-separated values while preserving comments.
     * Handles both comma-separated (`<val1>, <val2>`) and
     * whitespace-separated (`<val1 val2>`) forms.
     *
     * A single tokenization pass identifies top-level comma positions
     * (outside any `<>`, `[]`, or `()` nesting), then splits the source
     * text accordingly.
     */
    private parseCommaSeparatedValues(val: string): string[] {
        const trimmed = val.trim();
        if (!trimmed) { return []; }

        // Single pass: tokenize once, collect top-level comma offsets,
        // then reuse the same token array for splitting.
        const tokens = tokenize(trimmed);
        const commaOffsets: number[] = [];
        let depth = 0;
        for (const t of tokens) {
            if (t.type === TokenType.EOF) { break; }
            depth = Math.max(0, depth + bracketDelta(t));
            if (depth === 0 && t.type === TokenType.Comma) {
                commaOffsets.push(t.offset);
            }
        }

        if (commaOffsets.length === 0) { return [trimmed]; }

        const values: string[] = [];
        let entryStart = 0;
        let commaIdx = 0;

        for (let i = 0; i < tokens.length && commaIdx < commaOffsets.length; i++) {
            const t = tokens[i];
            if (t.type !== TokenType.Comma || t.offset !== commaOffsets[commaIdx]) {
                continue;
            }

            const { entry, nextStart, nextIndex } = this.consumeCommaEntry(tokens, trimmed, entryStart, i);
            if (entry) { values.push(entry); }
            entryStart = nextStart;
            i = nextIndex - 1;
            commaIdx++;
        }

        const lastPart = trimmed.slice(entryStart).trim();
        if (lastPart) { values.push(lastPart); }
        return values;
    }

    /**
     * Build one comma-terminated entry (`"value," [+ trailing same-line comment]`)
     * starting at `entryStart` and ending at the comma token found at `commaTokenIdx`.
     * Returns the formatted entry text plus where the next entry should start.
     */
    private consumeCommaEntry(
        tokens: Token[],
        source: string,
        entryStart: number,
        commaTokenIdx: number,
    ): { entry: string; nextStart: number; nextIndex: number } {
        const commaToken = tokens[commaTokenIdx];
        const valuePart = source.slice(entryStart, commaToken.offset).trim();

        // A same-line comment right after the comma is attached to this entry
        // (e.g. `<0x1>, // note\n<0x2>;`).
        let j = commaTokenIdx + 1;
        while (tokens[j]?.type === TokenType.Whitespace && !tokens[j].value.includes('\n')) {
            j++;
        }
        let commentPart = '';
        if (tokens[j] && (tokens[j].type === TokenType.LineComment || tokens[j].type === TokenType.BlockComment)) {
            commentPart = tokens[j].value;
            j++;
        }

        const entry = (valuePart || commentPart)
            ? valuePart + ',' + (commentPart ? ' ' + commentPart : '')
            : '';

        while (tokens[j]?.type === TokenType.Whitespace) {
            j++;
        }

        return { entry, nextStart: tokens[j] ? tokens[j].offset : source.length, nextIndex: j };
    }

    /**
     * If `value` starts with a top-level `<...>` group, return its inside text
     * (trimmed) and whatever text follows the matching `>` (trailing punctuation
     * and/or comment). Depth-aware, so it correctly finds the *matching* `>`
     * even if the content contains further nested `<`/`>` tokens.
     */
    private splitOuterAngleGroup(value: string): { inside: string; rest: string } | null {
        const tokens = tokenize(value);
        if (tokens[0]?.type !== TokenType.LAngle) {
            return null;
        }

        let depth = 0;
        for (const t of tokens) {
            if (t.type === TokenType.EOF) {
                break;
            }
            depth += bracketDelta(t);
            if (t.type === TokenType.RAngle && depth === 0) {
                return {
                    inside: value.slice(1, t.offset).trim(),
                    rest: value.slice(t.offset + 1),
                };
            }
        }

        return null;
    }

    /**
     * Parse value structure to identify key-value pairs
     * @param values Array of value strings to parse
     * @returns Array of parsed value objects with metadata
     */
    private parseValueStructure(values: string[]): ParsedValue[] {
        return values.map((value, index) => {
            const split = this.splitOuterAngleGroup(value);
            if (split) {
                const restMatch = split.rest.match(/^([,;]?)(.*?)$/);
                const trailingPunct = restMatch?.[1] ?? '';
                const comment = restMatch?.[2].trim() ?? '';
                const parts = split.inside.split(/\s+/);

                if (parts.length > 1) {
                    return {
                        key: parts[0],
                        valueInside: parts.slice(1).join(' '),
                        trailingPunct,
                        comment,
                        isLast: index === values.length - 1,
                        hasKeyValue: true,
                        originalValue: value
                    };
                }
            }

            return {
                key: '',
                valueInside: '',
                trailingPunct: '',
                comment: '',
                isLast: index === values.length - 1,
                hasKeyValue: false,
                originalValue: value
            };
        });
    }

    /**
     * Format simple values (no key-value pairs)
     * @param values Array of values to format
     * @param align Alignment string (indentation)
     * @returns Formatted values as a single string
     */
    private formatSimpleValues(values: string[], align: string): string {
        return values.map((value, index) => {
            const isLast = index === values.length - 1;
            let line = align + value.trim();
            if (isLast && !line.endsWith(';')) {
                line += ';';
            }
            return line;
        }).join('\n');
    }

    /**
     * Calculate tab/space alignment between two positions
     * @param fromPosition Starting position
     * @param toPosition Target position
     * @returns Alignment string (tabs and/or spaces)
     */
    private calculateTabSpaceAlignment(fromPosition: number, toPosition: number): string {
        if (this.useTabs) {
            let alignment = '';
            let current = fromPosition;

            while (current < toPosition) {
                const spacesUntilNextTabStop = this.tabSize - (current % this.tabSize);
                current += spacesUntilNextTabStop;
                alignment += '\t';
            }

            return alignment;
        } else {
            return ' '.repeat(toPosition - fromPosition);
        }
    }

    /**
     * Format key-value pairs with column alignment
     * Can handle both single pairs and arrays of pairs
     * @param parsedValues Array of parsed value objects
     * @param align Alignment string (indentation)
     * @param maxVisualKeyLength Optional maximum key length for alignment
     * @returns Formatted key-value pairs as a single string
     */
    private formatKeyValuePairs(parsedValues: ParsedValue[], align: string, maxVisualKeyLength?: number): string {
        // Calculate max key length if not provided
        const calculatedMaxKeyLength = maxVisualKeyLength ?? Math.max(...parsedValues
            .filter(p => p.hasKeyValue)
            .map(p => this.replaceTabsWithSpaces(p.key).length)
        );

        const openBracketPosition = this.replaceTabsWithSpaces(align).length + 1;
        const longestKeyEndPosition = openBracketPosition + calculatedMaxKeyLength;
        const targetPosition = longestKeyEndPosition + 1;

        return parsedValues.map(parsed => {
            if (!parsed.hasKeyValue) {
                let line = align + parsed.originalValue.trim();
                if (parsed.isLast && !line.endsWith(';')) {
                    line += ';';
                }
                return line;
            }

            const visualKeyLength = this.replaceTabsWithSpaces(parsed.key).length;
            const currentKeyEndPosition = openBracketPosition + visualKeyLength;
            const alignment = this.calculateTabSpaceAlignment(currentKeyEndPosition, targetPosition);

            let line = align + '<' + parsed.key + alignment + parsed.valueInside + '>';
            if (parsed.trailingPunct) {
                line += parsed.trailingPunct;
            } else if (parsed.isLast) {
                line += ';';
            } else {
                line += ',';
            }

            if (parsed.comment) {
                line += ' ' + parsed.comment;
            }

            return line;
        }).join('\n');
    }

    /**
     * Format a group of values with proper alignment
     * @param values Array of values to format
     * @param align Alignment string (indentation)
     * @returns Formatted value group as a single string
     */
    private formatValueGroup(values: string[], align: string): string {
        if (values.length === 0) {
            return '';
        }

        const parsedValues = this.parseValueStructure(values);
        const hasKeyValueEntries = parsedValues.some(p => p.hasKeyValue);

        if (!hasKeyValueEntries) {
            return this.formatSimpleValues(values, align);
        }

        return this.formatKeyValuePairs(parsedValues, align);
    }

    /**
     * Try to format property as single line
     * @param start Property start string (name and equals)
     * @param val Original value string
     * @param values Parsed values array
     * @returns Formatted single line or null if it doesn't fit
     */
    private tryFormatAsSingleLine(start: string, val: string, values: string[]): string | null {
        const originalLine = `${start}${val};`;
        const originalLineWithoutComments = originalLine.replace(/\/\*.*?\*\/\s*$/, '').trim();
        const hasComment = originalLine !== originalLineWithoutComments;

        if (!hasComment || this.replaceTabsWithSpaces(originalLineWithoutComments).length <= this.maxLineLength) {
            const formattedValues = this.formatValueGroup(values, '');
            return `${start}${formattedValues.replace(/\n/g, ' ')}`;
        }

        return null;
    }

    /**
     * Calculate alignment for property values
     * @param indentation Current indentation level
     * @param prop Property name
     * @returns Alignment string for property values
     */
    private calculateValueAlignment(indentation: string, prop: string): string {
        const start = `${indentation}${prop} = `;
        return this.calculateAlignmentForColumn(this.replaceTabsWithSpaces(start).length);
    }

    /**
     * Align text to a specific column based on current indentation and tab settings
     * @param col Target column for alignment
     * @returns String of tabs and/or spaces to reach the target column
     */
    private calculateAlignmentForColumn(col: number): string {
        return this.useTabs
            ? '\t'.repeat(Math.floor(col / this.tabSize)) + ' '.repeat(col % this.tabSize)
            : ' '.repeat(col);
    }

    /**
     * Format whitespace-separated content lines with column alignment
     * @param lines Content lines to format
     * @param baseIndent Base indentation for each line
     * @returns Formatted lines with column alignment
     */
    private formatWhitespaceSeparatedLines(lines: string[], baseIndent: string): string[] {
        if (lines.length === 0) {
            return [];
        }

        type CommentLine = { isComment: true; raw: string };
        type EntryLine = { isComment: false; key: string; value: string; suffix: string };
        type ParsedLine = CommentLine | EntryLine;

        // Parse each line: comment-only lines are preserved as-is; entry lines are split
        // into key, value, and optional trailing suffix (e.g. inline /* comment */).
        const parsedLines: ParsedLine[] = lines.map(line => {
            const trimmed = line.trim();
            // Lines that are purely comment content (block or line comments)
            if (/^(\/\*|\*|\/\/)/.test(trimmed)) {
                return { isComment: true, raw: trimmed } as CommentLine;
            }
            // Split into key / value / optional trailing suffix
            const firstSpace = trimmed.search(/\s+/);
            if (firstSpace < 0) {
                return { isComment: true, raw: trimmed } as CommentLine;
            }
            const key = trimmed.slice(0, firstSpace);
            const afterKey = trimmed.slice(firstSpace).trimStart();
            const secondSpace = afterKey.search(/\s/);
            if (secondSpace < 0) {
                return { isComment: false, key, value: afterKey, suffix: '' } as EntryLine;
            }
            return {
                isComment: false,
                key,
                value: afterKey.slice(0, secondSpace),
                suffix: afterKey.slice(secondSpace),   // leading whitespace preserved
            } as EntryLine;
        });

        const entryLines = parsedLines.filter((p): p is EntryLine => !p.isComment);

        // All non-comment lines must have a value for column alignment to make sense.
        // Also skip if any key looks like a function call or value contains a comma -
        // that indicates content like PDO_FIXED(5000, 3000, ...) rather than PIN HEX pairs.
        const shouldAlign = entryLines.length > 0 && entryLines.every(
            p => p.value !== '' && !p.key.includes('(') && !p.value.includes(',')
        );
        if (!shouldAlign) {
            return lines.map(line => baseIndent + line.trim());
        }

        // Skip alignment for purely numeric arrays (e.g. brightness-levels)
        const allNumeric = entryLines.every(p =>
            (/^[0-9]+$/.test(p.key) || p.key.length <= 3) &&
            (/^[0-9]+$/.test(p.value) || p.value.length <= 3)
        );
        if (allNumeric) {
            return lines.map(line => baseIndent + line.trim());
        }

        const baseIndentWidth = this.replaceTabsWithSpaces(baseIndent).length;
        const maxFirstColWidth = Math.max(...entryLines.map(p =>
            this.replaceTabsWithSpaces(p.key).length
        ));
        // Tabs: round up to the next tab stop after the longest key.
        // Spaces: exactly 1 space after the longest key, no rounding.
        const targetColumn = this.useTabs
            ? Math.ceil((baseIndentWidth + maxFirstColWidth + 1) / this.tabSize) * this.tabSize
            : baseIndentWidth + maxFirstColWidth + 1;

        return parsedLines.map(p => {
            if (p.isComment) {
                return baseIndent + p.raw;
            }
            const firstPartWidth = this.replaceTabsWithSpaces(p.key).length;
            let spacing: string;
            if (this.useTabs) {
                spacing = this.calculateTabSpaceAlignment(baseIndentWidth + firstPartWidth, targetColumn);
            } else {
                spacing = ' '.repeat(Math.max(1, targetColumn - baseIndentWidth - firstPartWidth));
            }
            return baseIndent + p.key + spacing + p.value + p.suffix;
        });
    }

    /**
     * Format property as multi-line with proper alignment
     * @param indentation Current indentation level
     * @param prop Property name
     * @param values Parsed values array
     * @returns Formatted multi-line property
     */
    private formatAsMultiLine(indentation: string, prop: string, values: string[]): string {
        const start = `${indentation}${prop} = `;
        const align = this.calculateValueAlignment(indentation, prop);

        // Calculate the max key length across ALL values for consistent alignment
        const allParsedValues = this.parseValueStructure(values);
        const maxVisualKeyLength = Math.max(...allParsedValues
            .filter(p => p.hasKeyValue)
            .map(p => this.replaceTabsWithSpaces(p.key).length)
        );

        // Format first value with the correct alignment context
        const firstParsedValue = allParsedValues[0];
        const firstFormattedValue = this.formatKeyValuePairs([firstParsedValue], align, maxVisualKeyLength);
        const firstValueOnly = firstFormattedValue.replace(/^[ \t]*/, ''); // Remove align prefix
        const firstLine = `${start}${firstValueOnly}`;
        const firstLineWithoutComment = firstLine.replace(/\/\*.*?\*\/\s*$/, '').trim();
        const firstLineLength = this.replaceTabsWithSpaces(firstLineWithoutComment).length;

        if (firstLineLength <= this.maxLineLength && values.length > 1) {
            // First value fits - align remaining values
            const rest = this.formatValueGroup(values.slice(1), align);
            return `${firstLine}\n${rest}`;
        } else {
            // Wrap all values
            const startWithoutSpace = `${indentation}${prop} =`;
            const all = this.formatValueGroup(values, align);
            return `${startWithoutSpace}\n${all}`;
        }
    }

    /**
     * Format a single property assignment with multi-line wrapping
     * @param indentation Current indentation level
     * @param prop Property name
     * @param val Property value string
     * @returns Formatted property assignment
     */
    private formatMultiLineProperty(indentation: string, prop: string, val: string): string {
        const start = `${indentation}${prop} = `;
        const values = this.parseCommaSeparatedValues(val);

        if (values.length === 0) {
            return start + val + ';';
        }

        // If there's only one value (whitespace-separated array), format with proper alignment
        if (values.length === 1 && val.includes('\n')) {
            const lines = val.split('\n').map(l => l.trim()).filter(l => l.length > 0);

            if (lines.length === 0) {
                return start + ';';
            }
            if (lines.length === 1) {
                // Only one non-empty content line - there's nothing to align across
                // lines, but it still needs the normal key/value whitespace
                // normalization and correct comment-vs-semicolon placement, so run
                // it through the same single-line/multi-line formatting used when
                // the value never had an artificial line break in the first place.
                const singleLineVal = lines[0];
                const singleLineValues = this.parseCommaSeparatedValues(singleLineVal);
                if (singleLineValues.length === 0) {
                    return start + singleLineVal + (singleLineVal.endsWith(';') ? '' : ';');
                }
                const singleLineResult = this.tryFormatAsSingleLine(start, singleLineVal, singleLineValues);
                if (singleLineResult) {
                    return singleLineResult;
                }
                return this.formatAsMultiLine(indentation, prop, singleLineValues);
            }

            // Extract content entries from all lines, stripping '<' prefix and '>;'/'>' suffix
            const contentLines: string[] = [];
            for (let i = 0; i < lines.length; i++) {
                let line = i === 0 ? lines[i].replace(/^<\s*/, '') : lines[i];
                if (i === lines.length - 1) {
                    line = line.replace(/>;?$/, '').trim();
                }
                if (line) {
                    contentLines.push(line);
                }
            }

            if (contentLines.length === 0) {
                return start + '<>;';
            }

            const bracketAlign = this.calculateAlignmentForColumn(this.replaceTabsWithSpaces(start + '<').length);
            const allFormatted = this.formatWhitespaceSeparatedLines(contentLines, bracketAlign);
            const firstEntry = allFormatted[0].slice(bracketAlign.length);
            return [start + '<' + firstEntry, ...allFormatted.slice(1), indentation + '>;'].join('\n');
        }

        // Check if we can format as single line (ignoring comments for length check)
        const singleLineResult = this.tryFormatAsSingleLine(start, val, values);
        if (singleLineResult) {
            return singleLineResult;
        }

        // Format as multi-line
        return this.formatAsMultiLine(indentation, prop, values);
    }
}

/**
 * VS Code Document Formatting Provider for DeviceTree files
 * Integrates the DtsFormatter with VS Code's formatting system
 */
export class DtsFormatterProvider implements vscode.DocumentFormattingEditProvider {
    private maxLineLength: number;
    private outputChannel: vscode.OutputChannel;

    /**
     * Create a formatting provider with the current maximum line length.
     * @param maxLineLength The maximum allowed line length.
     */
    constructor(maxLineLength: number) {
        this.maxLineLength = maxLineLength;
        this.outputChannel = vscode.window.createOutputChannel('DeviceTree');
    }

    /**
     * Update configuration settings
     * @param maxLineLength The new maximum line length
     */
    updateSettings(maxLineLength: number): void {
        this.maxLineLength = maxLineLength;
    }

    /**
     * Provide formatting edits for a document
     * @param document The document to format
     * @param options Formatting options from VS Code
     * @returns Array of text edits to apply
     */
    provideDocumentFormattingEdits(
        document: vscode.TextDocument,
        options: vscode.FormattingOptions,
    ): vscode.ProviderResult<vscode.TextEdit[]> {
        // Skip empty documents
        if (document.lineCount === 0) {
            return [];
        }

        // Get formatting preferences from VS Code
        const useTabs = !options.insertSpaces;
        const tabSize = options.tabSize;

        // Create formatter with current settings
        const formatter = new DtsFormatter(useTabs, tabSize, this.maxLineLength + 1, this.outputChannel);
        const [result, formatResult] = formatter.format(document.getText());

        // Handle formatting errors
        if (!formatResult.success || !result) {
            const errorMessage = formatResult.message ?? 'Formatting failed';
            this.outputChannel.appendLine(`Error: ${errorMessage}`);
            vscode.window.showErrorMessage(`DeviceTree: ${errorMessage}`);
            return [];
        }

        // Return a single edit that replaces the entire document
        // Note: We format with LF line endings, and VS Code will convert them
        // to the document's EOL setting. To ensure LF, we'd need to use
        // a WorkspaceEdit with document.eol, but that's not possible from
        // a formatting provider. The formatted content uses LF internally.
        return [
            vscode.TextEdit.replace(
                new vscode.Range(
                    document.positionAt(0),
                    document.positionAt(document.getText().length)
                ),
                result
            )
        ];
    }

    /**
     * Dispose resources when the extension is deactivated
     */
    dispose(): void {
        this.outputChannel.dispose();
    }
}
