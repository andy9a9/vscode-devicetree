'use strict';

// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
// Import the formatter and diagnostics providers
import { DtsDocumentLinkProvider } from './features/links';
import { DtsDiagnosticsProvider } from './features/diagnostics';
import { DtsFormatterProvider } from './features/formatter';
import { DtsSyntaxValidator } from './features/syntax-validator';

// Global provider instances
let linkProvider: DtsDocumentLinkProvider | undefined;
let diagnosticsProvider: DtsDiagnosticsProvider | undefined;
let formatterProvider: DtsFormatterProvider | undefined;
let syntaxValidator: DtsSyntaxValidator | undefined;

/**
 * Activate the extension
 * This method is called when your extension is activated
 * @param context The extension context
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function activate(context: vscode.ExtensionContext) {
    // Get configuration
    const config = vscode.workspace.getConfiguration('devicetree');
    const includeSearchPaths = config.get<string[]>('includeSearchPaths', ['include', 'include/dt-bindings']);
    const maxLineLength = config.get<number>('maxLineLength', 80);
    const includeComments = config.get<boolean>('diagnostics.lineLengthIncludeComments', true);
    const enableSyntaxValidation = config.get<boolean>('diagnostics.enableSyntaxValidation', true);
    const enableWarnings = config.get<boolean>('diagnostics.enableWarnings', true);

    // Create providers
    linkProvider = new DtsDocumentLinkProvider(includeSearchPaths);
    diagnosticsProvider = new DtsDiagnosticsProvider(maxLineLength, includeComments, linkProvider);
    formatterProvider = new DtsFormatterProvider(maxLineLength);
    syntaxValidator = new DtsSyntaxValidator();

    context.subscriptions.push(
        vscode.languages.registerDocumentLinkProvider('dts', linkProvider)
    );

    context.subscriptions.push(
        vscode.languages.registerDocumentFormattingEditProvider('dts', formatterProvider)
    );

    // Register the "Check Syntax" command
    context.subscriptions.push(syntaxValidator);
    context.subscriptions.push(
        vscode.commands.registerCommand('devicetree.validateSyntax', () => {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.languageId === 'dts' && syntaxValidator) {
                syntaxValidator.validateDocument(editor.document);
            }
        })
    );

    // Register diagnostics provider
    context.subscriptions.push(diagnosticsProvider);
    if (enableSyntaxValidation || enableWarnings) {
        // Helper function to check syntax and analyze document if it's a DTS file
        const analyzeIfDts = (document: vscode.TextDocument): void => {
            if (document.languageId === 'dts') {
                if (enableSyntaxValidation && syntaxValidator) {
                    syntaxValidator.validateDocument(document);
                }
                if (enableWarnings && diagnosticsProvider) {
                    void diagnosticsProvider.analyzeDocument(document);
                }
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
                if (document.languageId === 'dts') {
                    if (enableSyntaxValidation && syntaxValidator) {
                        syntaxValidator.clearDocument(document);
                    }
                    if (enableWarnings && diagnosticsProvider) {
                        diagnosticsProvider.clearDocument(document);
                    }
                }
            })
        );
    }

    // Listen for configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('devicetree')) {
                const config = vscode.workspace.getConfiguration('devicetree');
                const enableSyntaxValidation = config.get<boolean>('diagnostics.enableSyntaxValidation', true);
                const maxLineLength = config.get<number>('maxLineLength', 80);
                const includeComments = config.get<boolean>('diagnostics.lineLengthIncludeComments', true);
                const includeSearchPaths = config.get<string[]>('includeSearchPaths', ['include', 'include/dt-bindings']);

                if (syntaxValidator) {
                    vscode.workspace.textDocuments.forEach(document => {
                        if (document.languageId === 'dts' && syntaxValidator) {
                            if (enableSyntaxValidation) {
                                syntaxValidator.validateDocument(document);
                            } else {
                                syntaxValidator.clearDocument(document);
                            }
                        }
                    });
                }
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

                // Update link provider search paths
                if (linkProvider) {
                    linkProvider.updateSearchPaths(includeSearchPaths);
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
    if (syntaxValidator) {
        syntaxValidator.dispose();
        syntaxValidator = undefined;
    }
    if (formatterProvider) {
        formatterProvider.dispose();
        formatterProvider = undefined;
    }
    if (diagnosticsProvider) {
        diagnosticsProvider.dispose();
        diagnosticsProvider = undefined;
    }
    if (linkProvider) {
        linkProvider = undefined;
    }
}
