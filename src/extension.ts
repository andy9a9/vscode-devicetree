'use strict';

// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
// Import the formatter and diagnostics providers
import { DtsFormatterProvider } from './formatter';
import { DtsDiagnosticsProvider } from './diagnostics';

// Global diagnostics provider instance
let diagnosticsProvider: DtsDiagnosticsProvider | undefined;

/**
 * Activate the extension
 * This method is called when your extension is activated
 * @param context The extension context
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function activate(context: vscode.ExtensionContext) {
    // Get configuration
    const config = vscode.workspace.getConfiguration('devicetree');
    const maxLineLength = config.get<number>('maxLineLength', 80);
    const enableWarnings = config.get<boolean>('diagnostics.enableWarnings', true);
    const includeComments = config.get<boolean>('diagnostics.lineLengthIncludeComments', true);

    // Create diagnostics provider
    diagnosticsProvider = new DtsDiagnosticsProvider(maxLineLength, includeComments);

    // Register the formatter provider
    context.subscriptions.push(
        vscode.languages.registerDocumentFormattingEditProvider('dts', new DtsFormatterProvider(maxLineLength))
    );

    // Register diagnostics provider
    context.subscriptions.push(diagnosticsProvider);
    if (enableWarnings) {
        // Listen for document changes
        context.subscriptions.push(
            vscode.workspace.onDidChangeTextDocument(event => {
                if (event.document.languageId === 'dts' && diagnosticsProvider) {
                    // Debounce: analyze after a short delay to avoid excessive analysis
                    setTimeout(() => {
                        diagnosticsProvider?.analyzeDocument(event.document);
                    }, 500);
                }
            })
        );

        // Listen for text editor options changes (e.g., when tab size changes in the editor)
        context.subscriptions.push(
            vscode.window.onDidChangeTextEditorOptions(event => {
                const document = event.textEditor.document;
                if (document.languageId === 'dts' && diagnosticsProvider) {
                    diagnosticsProvider.analyzeDocument(document);
                }
            })
        );

        // Listen for document opens
        context.subscriptions.push(
            vscode.workspace.onDidOpenTextDocument(document => {
                if (document.languageId === 'dts' && diagnosticsProvider) {
                    diagnosticsProvider.analyzeDocument(document);
                }
            })
        );

        // Listen for document closes
        context.subscriptions.push(
            vscode.workspace.onDidCloseTextDocument(document => {
                if (document.languageId === 'dts' && diagnosticsProvider) {
                    diagnosticsProvider.clearDocument(document);
                }
            })
        );
    }
}

/**
 * Deactivate the extension
 * This method is called when your extension is deactivated
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function deactivate() {
    if (diagnosticsProvider) {
        diagnosticsProvider.dispose();
        diagnosticsProvider = undefined;
    }
}
