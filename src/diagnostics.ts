import * as vscode from 'vscode';

/**
 * Provider for DeviceTree diagnostic warnings
 * Manages diagnostic warnings for DeviceTree files, such as line length issues
 */
export class DtsDiagnosticsProvider {
    private diagnosticCollection: vscode.DiagnosticCollection;
    private maxLineLength: number;
    private includeComments: boolean;
    private tabSize: number;

    constructor(maxLineLength: number, includeComments: boolean) {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('devicetree');
        this.maxLineLength = maxLineLength + 1;
        this.includeComments = includeComments;

        // Read tabSize from editor configuration
        const editorConfig = vscode.workspace.getConfiguration('editor');
        this.tabSize = editorConfig.get<number>('tabSize', 8);
    }

    /**
     * Calculate visual length of a line considering tab stops
     * @param line The line to calculate the visual length for
     * @returns The visual length of the line
     */
    private calculateVisualLength(line: string): number {
        let visualLength = 0;
        for (const char of line) {
            if (char === '\t') {
                // Move to next tab stop
                visualLength += this.tabSize - (visualLength % this.tabSize);
            } else {
                visualLength += 1;
            }
        }
        return visualLength + 1;
    }

    /**
     * Remove comments from a line for length calculation
     * @param line The line to process
     * @param inBlockComment Whether we're currently inside a multi-line block comment
     * @returns Object with the line with comments removed and whether we're still in a block comment
     */
    private removeComments(line: string, inBlockComment: boolean): { line: string; inBlockComment: boolean } {
        // Handle multi-line block comment continuation
        if (inBlockComment) {
            const endComment = line.indexOf('*/');
            if (endComment !== -1) {
                line = line.substring(endComment + 2);
                inBlockComment = false;
            } else {
                return { line: '', inBlockComment: true };
            }
        }

        // Match strings (double/single quoted) or comments
        // Process in order: strings are kept, comments are removed
        const regex = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\/\*[\s\S]*?\*\/|\/\*[\s\S]*|\/\/.*/g;

        const result = line.replace(regex, (match) => {
            // Keep strings (start with " or ')
            if (match[0] === '"' || match[0] === "'") {
                return match;
            }
            // Block comment that doesn't close - set flag and remove rest of line
            if (match.startsWith('/*') && !match.endsWith('*/')) {
                inBlockComment = true;
            }
            return '';
        });

        return { line: result.trimEnd(), inBlockComment };
    }

    /**
     * Check for lines exceeding maximum length
     * @param document The document to check
     * @returns Array of diagnostics for lines exceeding maximum length
     */
    private checkLineLength(document: vscode.TextDocument): vscode.Diagnostic[] {
        const diagnostics: vscode.Diagnostic[] = [];
        const text = document.getText();
        const lines = text.split('\n');
        let inBlockComment = false;

        lines.forEach((line, index) => {
            // Calculate length based on configuration
            let lineToCheck: string;

            if (this.includeComments) {
                lineToCheck = line;
            } else {
                const result = this.removeComments(line, inBlockComment);
                lineToCheck = result.line;
                inBlockComment = result.inBlockComment;
            }

            const visualLength = this.calculateVisualLength(lineToCheck);

            if (visualLength > this.maxLineLength) {
                const range = new vscode.Range(index, 0, index, Number.MAX_VALUE);
                const diagnostic = new vscode.Diagnostic(
                    range,
                    `Line exceeds maximum length of ${this.maxLineLength} characters (current: ${visualLength})`,
                    vscode.DiagnosticSeverity.Warning
                );
                diagnostic.source = 'DeviceTree';
                diagnostics.push(diagnostic);
            }
        });

        return diagnostics;
    }

    /**
     * Analyze a document and update diagnostics
     * @param document The document to analyze
     */
    public analyzeDocument(document: vscode.TextDocument): void {
        if (document.languageId !== 'dts') {
            return;
        }

        // Update tabSize in case it has changed
        const editor = vscode.window.visibleTextEditors.find(
            e => e.document.uri.toString() === document.uri.toString()
        );

        if (editor) {
            this.tabSize = editor.options.tabSize as number;
        }

        const diagnostics: vscode.Diagnostic[] = [];

        // Run all diagnostic checks, currently only line length
        diagnostics.push(...this.checkLineLength(document));

        this.diagnosticCollection.set(document.uri, diagnostics);
    }

    /**
     * Clear diagnostics for a specific document
     * @param document The document to clear diagnostics for
     */
    public clearDocument(document: vscode.TextDocument): void {
        this.diagnosticCollection.delete(document.uri);
    }

    /**
     * Dispose the diagnostic collection
     */
    public dispose(): void {
        this.diagnosticCollection.dispose();
    }
}
