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
     * @returns The line with comments removed
     */
    private removeComments(line: string): string {
        // Remove line comments (// ...)
        let result = line.replace(/\/\/.*$/, '');

        // Remove block comments (/* ... */)
        result = result.replace(/\/\*.*?\*\//g, '');

        return result.trimEnd();
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

        lines.forEach((line, index) => {
            // Calculate length based on configuration
            const lineToCheck = this.includeComments ? line : this.removeComments(line);
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
     * Update configuration settings
     * @param maxLineLength The new maximum line length
     * @param includeComments Whether to include comments in line length calculation
     */
    public updateSettings(maxLineLength: number, includeComments: boolean): void {
        this.maxLineLength = maxLineLength + 1;
        this.includeComments = includeComments;
    }

    /**
     * Dispose the diagnostic collection
     */
    public dispose(): void {
        this.diagnosticCollection.dispose();
    }
}
