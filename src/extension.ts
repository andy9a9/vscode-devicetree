'use strict';

// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
// Import the formatter and diagnostics providers
import { DtsFormatterProvider } from './formatter';
import { DtsDiagnosticsProvider } from './diagnostics';

// Global provider instances
let diagnosticsProvider: DtsDiagnosticsProvider | undefined;
let formatterProvider: DtsFormatterProvider | undefined;

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

    // Create providers
    diagnosticsProvider = new DtsDiagnosticsProvider(maxLineLength, includeComments);
    formatterProvider = new DtsFormatterProvider(maxLineLength);

    context.subscriptions.push(
        vscode.languages.registerDocumentFormattingEditProvider('dts', formatterProvider)
    );

    // Register diagnostics provider
    context.subscriptions.push(diagnosticsProvider);
    if (enableWarnings) {
        // Helper function to analyze document if it's a DTS file
        const analyzeIfDts = (document: vscode.TextDocument): void => {
            if (document.languageId === 'dts' && diagnosticsProvider) {
                void diagnosticsProvider.analyzeDocument(document);
            }
        };

        // Listen for document changes
        context.subscriptions.push(
            vscode.workspace.onDidChangeTextDocument(event => {
                // Debounce: analyze after a short delay to avoid excessive analysis
                setTimeout(() => analyzeIfDts(event.document), 500);
            }));

        // Listen for text editor options changes (e.g., when tab size changes in the editor)
        context.subscriptions.push(
            vscode.window.onDidChangeTextEditorOptions(event => {
                analyzeIfDts(event.textEditor.document);
            })
        );

        // Listen for document opens
        context.subscriptions.push(
            vscode.workspace.onDidOpenTextDocument(analyzeIfDts)
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

    // Listen for configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('devicetree')) {
                const config = vscode.workspace.getConfiguration('devicetree');
                const maxLineLength = config.get<number>('maxLineLength', 80);
                const includeComments = config.get<boolean>('diagnostics.lineLengthIncludeComments', true);

                // Update formatter settings
                if (formatterProvider) {
                    formatterProvider.updateSettings(maxLineLength);
                }

                // Update diagnostics settings
                if (diagnosticsProvider) {
                    diagnosticsProvider.updateSettings(maxLineLength, includeComments);

                    // Re-analyze all open DTS documents with new settings
                    vscode.workspace.textDocuments.forEach(document => {
                        if (document.languageId === 'dts') {
                            void diagnosticsProvider?.analyzeDocument(document);
                        }
                    });
                }
            }
        })
    );
}

/**
 * Deactivate the extension
 * This method is called when your extension is deactivated
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function deactivate() {
    if (formatterProvider) {
        formatterProvider.dispose();
        formatterProvider = undefined;
    }
    if (diagnosticsProvider) {
        diagnosticsProvider.dispose();
        diagnosticsProvider = undefined;
    }
}
