import * as vscode from 'vscode';
import * as path from 'path';
import { Token, TokenType, tokenize, isIncludeToken } from '../../parser/lexer';
import { DtsDocumentLinkProvider } from '../links';

/**
 * Provider for DeviceTree diagnostic warnings.
 * Manages diagnostics for DeviceTree files: line-length warnings and
 * missing-include-file warnings.
 */
export class DtsDiagnosticsProvider {
    private diagnosticCollection: vscode.DiagnosticCollection;
    private maxLineLength: number;
    private tabSize: number;
    private includeComments: boolean;
    private linkProvider: DtsDocumentLinkProvider;

    /**
     * Create a diagnostics provider with the active settings and link provider.
     * @param maxLineLength The maximum line length.
     * @param includeComments Whether comments count toward line length.
     * @param linkProvider Link provider used to resolve includes.
     */
    constructor(maxLineLength: number, includeComments: boolean, linkProvider: DtsDocumentLinkProvider) {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('devicetree');
        this.maxLineLength = maxLineLength + 1;
        this.includeComments = includeComments;
        this.linkProvider = linkProvider;

        const editorConfig = vscode.workspace.getConfiguration('editor');
        this.tabSize = editorConfig.get<number>('tabSize', 8);
    }

    /**
     * Update configuration settings.
     * @param maxLineLength The maximum allowed line length.
     * @param includeComments Whether comments should count toward line length.
     */
    updateSettings(maxLineLength: number, includeComments: boolean): void {
        this.maxLineLength = maxLineLength + 1;
        this.includeComments = includeComments;
    }

    /**
     * Calculate the visual length of a line, expanding tabs to tab stops.
     * @param line The line to measure.
     * @returns Visual line length.
     */
    private calculateVisualLength(line: string): number {
        let visualLength = 0;
        for (const char of line) {
            if (char === '\t') {
                visualLength += this.tabSize - (visualLength % this.tabSize);
            } else {
                visualLength += 1;
            }
        }
        return visualLength + 1;
    }

    /**
     * Build a copy of `text` where every non-newline character that belongs
     * to a comment token is replaced with a space.  Line offsets are
     * preserved so the result can be split by `\n` without shifting line
     * numbers.
     * @param text The source text.
     * @param tokens The token list for the source text.
     * @returns Masked text with comment characters replaced by spaces.
     */
    private maskComments(text: string, tokens: Token[]): string {
        const chars = text.split('');
        for (const token of tokens) {
            if (
                token.type === TokenType.LineComment ||
                token.type === TokenType.BlockComment
            ) {
                const end = token.offset + token.value.length;
                for (let i = token.offset; i < end; i++) {
                    chars[i] = chars[i] === '\n' ? '\n' : ' ';
                }
            }
        }
        return chars.join('');
    }

    /**
     * Check for lines exceeding the maximum length.
     *
     * When `includeComments` is false, comment spans (identified via the
     * pre-computed token list) are blanked out before measuring each line.
     * This replaces the old line-by-line `removeComments()` state machine.
     * @param text The source text.
     * @param tokens The token list for the source text.
     * @returns Warning diagnostics for overlong lines.
     */
    private checkLineLength(text: string, tokens: Token[]): vscode.Diagnostic[] {
        const diagnostics: vscode.Diagnostic[] = [];

        const effectiveText = this.includeComments ? text : this.maskComments(text, tokens);

        const lines = effectiveText.split('\n');
        lines.forEach((line, index) => {
            // When comments are excluded the masked text has spaces where comment
            // characters were.  Trim trailing spaces so those blanked-out comment
            // spans don't inflate the measured visual length.
            const lineToMeasure = this.includeComments ? line : line.trimEnd();
            const visualLength = this.calculateVisualLength(lineToMeasure);
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
     * Check for missing include files.
     *
     * Reads include paths directly from the pre-computed token list instead
     * of re-parsing the document text.
     * @param document The document to inspect.
     * @param tokens The token list for the document.
     * @returns Warning diagnostics for missing include files.
     */
    private async checkIncludeFiles(
        document: vscode.TextDocument,
        tokens: Token[],
    ): Promise<vscode.Diagnostic[]> {
        const diagnostics: vscode.Diagnostic[] = [];
        const currentFileDir = path.dirname(document.uri.fsPath);

        for (const token of tokens) {
            if (!isIncludeToken(token)) {
                continue;
            }

            const targetUri = await this.linkProvider.findIncludedFile(
                token.includePath,
                currentFileDir
            );

            if (!targetUri) {
                const startChar = token.column + (token.pathOffset - token.offset);
                const endChar = startChar + token.includePath.length;
                const range = new vscode.Range(
                    new vscode.Position(token.line, startChar),
                    new vscode.Position(token.line, endChar)
                );
                const diagnostic = new vscode.Diagnostic(
                    range,
                    `Include file "${token.includePath}" was not found.\n` +
                    `Update the 'includeSearchPaths' settings for new location to search.`,
                    vscode.DiagnosticSeverity.Warning
                );
                diagnostic.source = 'DeviceTree';
                diagnostics.push(diagnostic);
            }
        }

        return diagnostics;
    }

    /**
     * Analyse a document and update the diagnostic collection.
     *
     * The source text is tokenised once; the resulting token list is shared
     * by all individual checks so the lexer only runs a single pass per
     * document change.
     * @param document The document to analyse.
     */
    public async analyzeDocument(
        document: vscode.TextDocument
    ): Promise<void> {
        if (document.languageId !== 'dts') {
            return;
        }

        // Sync tab size with the active editor in case it changed.
        const editor = vscode.window.visibleTextEditors.find(
            e => e.document.uri.toString() === document.uri.toString()
        );
        if (editor) {
            this.tabSize = editor.options.tabSize as number;
        }

        const text = document.getText();
        const tokens = tokenize(text);

        const diagnostics: vscode.Diagnostic[] = [
            ...this.checkLineLength(text, tokens),
            ...await this.checkIncludeFiles(document, tokens),
        ];

        this.diagnosticCollection.set(document.uri, diagnostics);
    }

    /**
     * Clear diagnostics for a specific document.
     * @param document The document whose diagnostics should be cleared.
     */
    public clearDocument(document: vscode.TextDocument): void {
        this.diagnosticCollection.delete(document.uri);
    }

    /**
     * Dispose the diagnostic collection.
     */
    public dispose(): void {
        this.diagnosticCollection.dispose();
    }
}
