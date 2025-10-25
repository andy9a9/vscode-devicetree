import * as vscode from 'vscode';
export { DtsFormatter };

/**
 * Interface for formatting operation results
 */
interface ResultFormat {
    success: boolean;
    message?: string;
}

/**
 * Provider for DeviceTree diagnostic warnings
 * Manages diagnostic warnings for DeviceTree files, such as line length issues
 */
export class DtsDiagnosticsProvider {
    private diagnosticCollection: vscode.DiagnosticCollection;

    constructor() {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('devicetree');
    }

    /**
     * Updates diagnostics for a document with warning markers
     * @param document - The VS Code text document to update diagnostics for
     * @param warningLines - Array of line numbers (0-based) where warnings should be shown
     */
    public updateDiagnostics(document: vscode.TextDocument, warningLines: number[]): void {
        const diagnostics: vscode.Diagnostic[] = [];

        for (const line of warningLines) {
            const range = new vscode.Range(line, 0, line, 0);
            const diagnostic = new vscode.Diagnostic(
                range,
                'DeviceTree warning',
                vscode.DiagnosticSeverity.Warning
            );
            diagnostics.push(diagnostic);
        }

        this.diagnosticCollection.set(document.uri, diagnostics);
    }

    /**
     * Clear all diagnostics
     */
    public clear(): void {
        this.diagnosticCollection.clear();
    }

    /**
     * Dispose the diagnostic collection
     */
    public dispose(): void {
        this.diagnosticCollection.dispose();
    }
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
     */
    private normalizeInput(data: string): string {
        // Normalize labels and node references
        data = data
            .replace(/([\w,-]+)\s*:[\t ]*/g, '$1: ')
            .replace(/(&[\w,-]+)\s*{[\t ]*/g, '$1 {')
            .replace(/([\w,-]+)@0*([\da-fA-F]+)\s*{[\t ]*/g, '$1@$2 {')
            .replace(/([\w,-]+)\s+{/g, '$1 {');

        // Format assignments and values
        data = data
            .replace(/(\w+)\s*=\s*(".*?"|<.*?>|\[.*?\])\s*;/g, '$1 = $2;')
            .replace(/<\s*(.*?)\s*>/g, '<$1>');

        // Remove trailing whitespace and normalize line endings
        data = data
            .replace(/([;{])[ \t]+\r?\n/g, '$1\n')
            .replace(/[ \t]+\r?\n/g, '\n');

        // Convert to consistent indentation style
        return this.normalizeIndentation(data);
    }

    /**
     * Convert tabs to spaces for length calculations
     */
    private replaceTabsWithSpaces(data: string): string {
        return data.replace(/\t/g, ' '.repeat(this.tabSize));
    }

    /**
     * Calculate indentation for continuation lines (comma-separated values)
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
     */
    private formatBlockStructure(data: string): string {
        const indentStep = this.useTabs ? '\t' : ' '.repeat(this.tabSize);
        let indent = '';
        let commaIndent = '';

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
     */
    private parseCommaSeparatedValues(val: string): string[] {
        const regex = /((?:".*?"|<.*?>|\[.*?\]|[^,])+?,?)([ \t]*(?:\/\/.*|\/\*.*?\*\/)?)?/gm;
        const values: string[] = [];
        let entry: RegExpExecArray | null;

        while ((entry = regex.exec(val)) !== null) {
            const valuePart = entry[1].trimEnd();
            const commentPart = entry[2]?.trimEnd() ?? '';
            if (valuePart || commentPart) {
                values.push(valuePart + (commentPart ? ' ' + commentPart : ''));
            }
        }

        return values;
    }

    /**
     * Parse value structure to identify key-value pairs
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
     */
    private calculateValueAlignment(indentation: string, prop: string): string {
        const start = `${indentation}${prop} = `;
        const eqPos = this.replaceTabsWithSpaces(start).length;
        const tabCount = Math.floor(eqPos / this.tabSize);
        const spaceCount = eqPos % this.tabSize;

        return this.useTabs
            ? '\t'.repeat(tabCount) + ' '.repeat(spaceCount)
            : ' '.repeat(eqPos);
    }

    /**
     * Format property as multi-line with proper alignment
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
     */
    private formatMultiLineProperty(indentation: string, prop: string, val: string): string {
        const start = `${indentation}${prop} = `;
        const values = this.parseCommaSeparatedValues(val);

        if (values.length === 0) {
            return start + val + ';';
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
                    if (this.replaceTabsWithSpaces(fullLine).length <= this.maxLineLength) {
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
    private outputChannel: vscode.OutputChannel;
    private diagnosticsProvider: DtsDiagnosticsProvider;

    constructor() {
        this.outputChannel = vscode.window.createOutputChannel('DeviceTree Formatter');
        this.diagnosticsProvider = new DtsDiagnosticsProvider();
    }

    /**
     * Check the formatted document for warnings and apply them
     * This will schedule diagnostics to be applied after the document is updated
     */
    private checkFormattedDocumentWarnings(formattedText: string, maxLineLength: number, tabSize: number): void {
        const warningLines: number[] = [];
        const lines = formattedText.split('\n');

        // Check each line in the FORMATTED document
        lines.forEach((line, index) => {
            const visualLength = line.replace(/\t/g, ' '.repeat(tabSize)).length;
            if (visualLength > maxLineLength + 1) {
                warningLines.push(index);
            }
        });

        // Apply warnings to the document AFTER formatting is complete
        if (warningLines.length > 0) {
            // Use setTimeout to apply diagnostics after the document has been updated
            setTimeout(() => {
                const activeDocument = vscode.window.activeTextEditor?.document;
                if (activeDocument && activeDocument.languageId === 'dts') {
                    this.diagnosticsProvider.updateDiagnostics(activeDocument, warningLines);
                }
            }, 100); // Small delay to ensure document is updated
        }
    }

    /**
     * Provide formatting edits for a document
     * @param document The document to format
     * @param options VS Code formatting options
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
        const maxLineLength = vscode.workspace.getConfiguration('devicetree').get<number>('maxLineLength', 80) + 1;
        const enableWarnings = vscode.workspace.getConfiguration('devicetree').get<boolean>('enableWarnings', true);

        // Create formatter with current settings
        const formatter = new DtsFormatter(useTabs, tabSize, maxLineLength, this.outputChannel);
        const [result, formatResult] = formatter.format(document.getText());

        // Clear previous diagnostics
        this.diagnosticsProvider.clear();

        // Handle formatting errors
        if (!formatResult.success || !result) {
            const errorMessage = formatResult.message ?? 'Formatting failed';
            this.outputChannel.appendLine(`Error: ${errorMessage}`);
            vscode.window.showErrorMessage(`DeviceTree Formatter: ${errorMessage}`);
            return [];
        }

        // Check warnings on the FORMATTED document and apply them after formatting
        if (enableWarnings) {
            this.checkFormattedDocumentWarnings(result, maxLineLength, tabSize);
        }

        // Return a single edit that replaces the entire document
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
        this.diagnosticsProvider.dispose();
    }
}
