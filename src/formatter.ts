import * as vscode from 'vscode';

/**
 * Interface for formatting operation results
 */
interface ResultFormat {
    success: boolean;
    message?: string;
}

/**
 * DeviceTree Source (.dts) formatter class
 * Handles formatting of DeviceTree source files with proper indentation,
 * line wrapping, and comment alignment
 */
class DtsFormatter {
    private useTabs: boolean;
    private tabSize: number;
    private maxLineLength: number;
    private outputChannel: vscode.OutputChannel;

    constructor(useTabs: boolean, tabSize: number, maxLineLength: number, outputChannel: vscode.OutputChannel) {
        this.useTabs = useTabs;
        this.tabSize = tabSize;
        this.maxLineLength = maxLineLength;
        this.outputChannel = outputChannel;
    }

    /**
     * Main formatting method that processes the entire DTS content
     * @param data The DTS content to format
     * @returns Tuple of formatted content and format result status
     */
    format(data: string): [string, ResultFormat] {
        const result: string[] = [];

        try {
            // Basic cleanup and normalization
            data = this.normalizeInput(data);

            // Handle block structure and indentation
            data = this.formatBlockStructure(data);

            // Handle property assignments and line wrapping
            data = this.formatPropertyAssignments(data);

            // Fix comment formatting
            data = this.formatComments(data);

            result.push(data);
            this.outputChannel.appendLine('Formatting successful');
        } catch (ex) {
            const errorMessage = ex instanceof Error ? ex.message : String(ex);
            return ['', { success: false, message: `Formatting failed: ${errorMessage}` }];
        }

        return [result.join('\n'), { success: true }];
    }

    /**
     * Convert between tabs and spaces based on user preference
     * @param data The content to normalize
     * @returns Content with normalized indentation
     */
    private normalizeIndentation(data: string): string {
        const indentStep = this.useTabs ? '\t' : ' '.repeat(this.tabSize);

        return this.useTabs
            ? data.replace(new RegExp(`^( {${this.tabSize}})+`, 'gm'),
                spaces => '\t'.repeat(spaces.length / this.tabSize))
            : data.replace(/^\t+/gm,
                tabs => indentStep.repeat(tabs.length));
    }

    /**
     * Normalize input data - cleanup and convert to consistent format
     * @param data The content to normalize
     * @returns Normalized content
     */
    private normalizeInput(data: string): string {
        // Normalize line endings first
        data = data.replace(/\r\n/g, '\n');

        // Normalize labels (but not inside quoted strings)
        // Split by strings, process parts outside strings, then rejoin
        data = data.split('\n').map(line => {
            // Split line into string and non-string parts
            const parts: string[] = [];
            const stringParts: boolean[] = [];
            let lastIndex = 0;

            // Find all quoted strings
            const stringRegex = /"(?:[^"\\]|\\.)*"/g;
            let match;

            while ((match = stringRegex.exec(line)) !== null) {
                // Add part before string
                if (match.index > lastIndex) {
                    parts.push(line.substring(lastIndex, match.index));
                    stringParts.push(false);
                }
                // Add the string itself
                parts.push(match[0]);
                stringParts.push(true);
                lastIndex = match.index + match[0].length;
            }

            // Add remaining part after last string
            if (lastIndex < line.length) {
                parts.push(line.substring(lastIndex));
                stringParts.push(false);
            }

            // Process non-string parts to normalize colons in labels
            const processed = parts.map((part, index) => {
                if (stringParts[index]) {
                    // Inside string - don't modify
                    return part;
                }
                // Outside string - normalize label colons
                // Match word (label) followed by colon and optional whitespace
                return part.replace(/([\w,-]+):\s*/g, '$1: ');
            });

            return processed.join('');
        }).join('\n');

        // Normalize node references and addresses
        data = data
            .replace(/(&[\w,-]+)\s*{[\t ]*/g, '$1 {')
            .replace(/([\w,-]+)\s*@\s*0*([\da-fA-F]+)\s*{[\t ]*/g, '$1@$2 {')
            .replace(/([\w,-]+)\s+{/g, '$1 {');

        // Format assignments and values
        data = data
            .replace(/(\w+)\s*=\s*(".*?"|<.*?>|\[.*?\])\s*;/g, '$1 = $2;')
            .replace(/<\s*(.*?)\s*>/g, '<$1>');

        // Remove trailing whitespace from all lines
        data = data.replace(/[ \t]+$/gm, '');

        // Collapse multiple blank lines (3 or more) to maximum 2
        data = data.replace(/\n{3,}/g, '\n\n');

        // Convert to consistent indentation style
        return this.normalizeIndentation(data);
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
     * Calculate indentation for continuation lines (comma-separated values)
     * @param line The line to calculate continuation indent for
     * @param indent Current indentation level
     * @returns The continuation indentation string
     */
    private calculateContinuationIndent(line: string, indent: string): string {
        const expandedLine = this.replaceTabsWithSpaces(line);
        const expandedIndent = this.replaceTabsWithSpaces(indent);

        const spacesNeeded = expandedLine.indexOf('=') + 2 - expandedIndent.length;
        let result = ' '.repeat(Math.max(spacesNeeded, 0));

        if (this.useTabs) {
            result = result.replace(new RegExp(' '.repeat(this.tabSize), 'g'), '\t');
        }

        return result;
    }

    /**
     * Format block structure with proper indentation based on braces
     * @param data The content to format
     * @returns Content with formatted block structure
     */
    private formatBlockStructure(data: string): string {
        const indentStep = this.useTabs ? '\t' : ' '.repeat(this.tabSize);
        let indent = '';
        let commaIndent = '';

        // Expand single-line braces like "/ { };" to multi-line format
        data = data.replace(/(\S+)\s*{\s*};?/g, '$1 {\n};');

        // Split opening braces to new lines for proper indentation
        data = data.replace(/{\s*(\S)/g, '{\n$1');

        const lines = data.split(/\r?\n/);
        return lines.map(line => {
            if (line.length === 0) {
                return line;
            }

            // Handle brace-based indentation
            const delta = (line.match(/{/g) ?? []).length - (line.match(/}/g) ?? []).length;
            if (delta < 0) {
                indent = indent.slice(indentStep.length * -delta);
            }

            // Handle comma continuation indentation
            let currentCommaIndent = commaIndent;
            if (line.trimEnd().endsWith(';')) {
                currentCommaIndent = '';
                commaIndent = '';
            }

            const indentedLine = indent + currentCommaIndent + line.trimStart();

            if (delta > 0) {
                indent += indentStep.repeat(delta);
            }
            if (commaIndent.length === 0 && line.trimEnd().endsWith(',')) {
                commaIndent = this.calculateContinuationIndent(line, indent);
            }

            return indentedLine;
        }).join('\n');
    }

    /**
     * Parse comma-separated values while preserving comments
     * Handles both comma-separated (< val1 >, < val2 >) and whitespace-separated (< val1 val2 >)
     * @param val The value string to parse
     * @returns Array of parsed values with comments preserved
     */
    private parseCommaSeparatedValues(val: string): string[] {
        const trimmed = val.trim();

        // Check if this is whitespace-separated (no commas outside of parentheses/brackets)
        // Pattern: < val1 val2 val3 > or values with function calls like PDO_FIXED(...)
        const hasCommas = this.hasSignificantCommas(trimmed);
        if (!hasCommas) {
            return trimmed.trim() ? [trimmed] : [];
        }

        // Comma-separated values - use the original logic
        const regex = /((?:".*?"|<[^>]*>|\[[^\]]*\]|[^,])+)(,?)([ \t]*(?:\/\/.*|\/\*.*?\*\/)?)?/g;
        const values: string[] = [];
        let entry: RegExpExecArray | null;

        while ((entry = regex.exec(trimmed)) !== null) {
            const valuePart = entry[1].trim();
            const comma = entry[2];
            const commentPart = entry[3]?.trim() ?? '';

            if (valuePart || commentPart) {
                const fullValue = valuePart + comma + (commentPart ? ' ' + commentPart : '');
                values.push(fullValue);
            }
        }

        return values;
    }

    /**
     * Check if a value string has commas that act as value separators (i.e. are not
     * nested inside parentheses or angle-bracket groups).
     *
     * Significant (separating) commas:
     *   `<&clk1>, <&clk2>`          — comma between two `<...>` entries
     *   `"a", "b"`                  — comma between two string literals
     *
     * Non-significant (nested) commas:
     *   `<PDO_FIXED(5000, 3000, PDO_FIXED_USB_COMM)>` — commas inside `(...)` at depth > 1
     *   `< 0 1 2 3 >`               — no commas at all; whitespace-separated array
     *
     * @param val The value string to check (typically the right-hand side of a `=`)
     * @returns True if at least one comma separates top-level values
     */
    private hasSignificantCommas(val: string): boolean {
        let depth = 0;
        let inString = false;

        for (let i = 0; i < val.length; i++) {
            const char = val[i];

            if (char === '"' && (i === 0 || val[i - 1] !== '\\')) {
                inString = !inString;
            } else if (!inString) {
                if (char === '(' || char === '[' || char === '<') {
                    depth++;
                } else if (char === ')' || char === ']' || char === '>') {
                    depth--;
                } else if (char === ',' && depth <= 1) {
                    // Found a comma at top level or just inside the outer brackets
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Parse value structure to identify key-value pairs
     * @param values Array of value strings to parse
     * @returns Array of parsed value objects with metadata
     */
    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    private parseValueStructure(values: string[]) {
        return values.map((value, index) => {
            const match = value.match(/^<([^>]+)>([,;]?)(.*?)$/);
            if (match) {
                const insideBrackets = match[1].trim();
                const trailingPunct = match[2];
                const comment = match[3].trim();
                const parts = insideBrackets.split(/\s+/);

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private formatKeyValuePairs(parsedValues: any[], align: string, maxVisualKeyLength?: number): string {
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
        // Also skip if any key looks like a function call or value contains a comma —
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
                return start + lines[0] + (lines[0].endsWith(';') ? '' : ';');
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

    /**
     * Format property assignments with line wrapping and alignment
     * @param data The content to format
     * @returns Content with formatted property assignments
     */
    private formatPropertyAssignments(data: string): string {
        return data.replace(
            /^([ \t]*)([\w,.-]+)\s*=\s*([\s\S]*?);([ \t]*(?:\/\/.*|\/\*.*?\*\/)?)?$/gm,
            (_: string, indentation: string, prop: string, val: string, comment?: string) => {
                const commentText = comment ?? '';
                // For single-line properties, handle comment extraction
                if (!val.includes('\n')) {
                    const valueCommentMatch = val.match(/^(.*?)([ \t]+(?:\/\/.*|\/\*.*?\*\/))(.*)$/);
                    let cleanVal: string;
                    let extractedComment: string;

                    if (valueCommentMatch) {
                        cleanVal = valueCommentMatch[1].trim();
                        extractedComment = valueCommentMatch[2].trim();
                    } else {
                        cleanVal = val.trim();
                        extractedComment = commentText ? commentText.trim() : '';
                    }

                    const fullLine = `${indentation}${prop} = ${cleanVal}${extractedComment ? `; ${extractedComment}` : ';'}`;
                    // In spaces mode, skip the early return if the value still contains tabs
                    // so it falls through to formatMultiLineProperty which converts them properly.
                    if (this.replaceTabsWithSpaces(fullLine).length <= this.maxLineLength &&
                        (this.useTabs || !cleanVal.includes('\t'))) {
                        return fullLine;
                    }
                }

                // For multi-line properties, pass original value with all comments intact
                const originalValue = val + (commentText ? commentText : '');
                return this.formatMultiLineProperty(indentation, prop, originalValue);
            }
        );
    }

    /**
     * Format multiline comments
     * @param data The content to format
     * @returns Content with formatted comments
     */
    private formatComments(data: string): string {
        return data.replace(/\/\*[\s\S]*?\*\//g, content => {
            return content.replace(/^([ \t]*)\*/gm, '$1 *');
        });
    }
}

/**
 * VS Code Document Formatting Provider for DeviceTree files
 * Integrates the DtsFormatter with VS Code's formatting system
 */
export class DtsFormatterProvider implements vscode.DocumentFormattingEditProvider {
    private maxLineLength: number;
    private outputChannel: vscode.OutputChannel;

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
