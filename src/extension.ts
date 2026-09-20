'use strict';

// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
// Import the formatter and diagnostics providers
import { DtsDocumentLinkProvider } from './features/links';
import { DtsDiagnosticsProvider } from './features/diagnostics';
import { DtsFormatterProvider } from './features/formatter';
import { DtsSyntaxValidator } from './features/syntax-validator';
import { DtcValidator } from './features/dtc-validator';
import { disposeOutputChannel } from './utils/output-channel';

// Track document listener subscriptions so we can dispose and re-register them
let documentListenerDisposables: vscode.Disposable[] = [];

function clearDocumentListeners(): void {
    documentListenerDisposables.forEach(d => d.dispose());
    documentListenerDisposables = [];
}

// Global provider instances
let linkProvider: DtsDocumentLinkProvider | undefined;
let diagnosticsProvider: DtsDiagnosticsProvider | undefined;
let formatterProvider: DtsFormatterProvider | undefined;
let syntaxValidator: DtsSyntaxValidator | undefined;
let dtcValidator: DtcValidator | undefined;

interface DevicetreeSettings {
    includeSearchPaths: string[];
    maxLineLength: number;
    includeComments: boolean;
    enableSyntaxValidation: boolean;
    enableWarnings: boolean;
}

function getSettings(): DevicetreeSettings {
    const config = vscode.workspace.getConfiguration('devicetree');
    return {
        includeSearchPaths: config.get<string[]>('includeSearchPaths', ['include', 'include/dt-bindings']),
        maxLineLength: config.get<number>('maxLineLength', 80),
        includeComments: config.get<boolean>('diagnostics.lineLengthIncludeComments', true),
        enableSyntaxValidation: config.get<boolean>('diagnostics.enableSyntaxValidation', true),
        enableWarnings: config.get<boolean>('diagnostics.enableWarnings', true),
    };
}

function analyzeIfDts(document: vscode.TextDocument, settings: DevicetreeSettings): void {
    if (document.languageId !== 'dts') {
        return;
    }
    if (settings.enableSyntaxValidation && syntaxValidator) {
        syntaxValidator.validateDocument(document);
    }
    if (settings.enableWarnings && diagnosticsProvider) {
        void diagnosticsProvider.analyzeDocument(document);
    }
}

function clearDtsDiagnostics(document: vscode.TextDocument, settings: DevicetreeSettings): void {
    if (document.languageId !== 'dts') {
        return;
    }
    if (settings.enableSyntaxValidation && syntaxValidator) {
        syntaxValidator.clearDocument(document);
    }
    if (settings.enableWarnings && diagnosticsProvider) {
        diagnosticsProvider.clearDocument(document);
    }
    if (dtcValidator) {
        dtcValidator.clearDocument(document);
    }
}

function registerCommands(context: vscode.ExtensionContext): void {
    if (!syntaxValidator || !dtcValidator) {
        return;
    }

    context.subscriptions.push(syntaxValidator);
    context.subscriptions.push(
        vscode.commands.registerCommand('devicetree.validateSyntax', () => {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.languageId === 'dts' && syntaxValidator) {
                syntaxValidator.validateDocument(editor.document);
            }
        })
    );

    context.subscriptions.push(dtcValidator);
    context.subscriptions.push(
        vscode.commands.registerCommand('devicetree.validateDTB', () => {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.languageId === 'dts' && dtcValidator) {
                void dtcValidator.validateDocument(editor.document, true);
            }
        })
    );
}

function registerDocumentListeners(context: vscode.ExtensionContext, settings: DevicetreeSettings): void {
    // Always register close listener to clear all diagnostics including DTC ones.
    documentListenerDisposables.push(
        vscode.workspace.onDidCloseTextDocument(document => {
            clearDtsDiagnostics(document, settings);
        })
    );

    // Register change listeners with current settings captured in closure.
    if (settings.enableSyntaxValidation || settings.enableWarnings) {
        documentListenerDisposables.push(
            vscode.workspace.onDidChangeTextDocument(event => {
                setTimeout(() => analyzeIfDts(event.document, settings), 500);
            })
        );

        documentListenerDisposables.push(
            vscode.window.onDidChangeTextEditorOptions(event => {
                analyzeIfDts(event.textEditor.document, settings);
            })
        );

        documentListenerDisposables.push(
            vscode.workspace.onDidOpenTextDocument(document => {
                analyzeIfDts(document, settings);
            })
        );
    }

    // Also subscribe to the disposables in context so they're cleaned up on deactivation
    context.subscriptions.push(...documentListenerDisposables);
}

function refreshOpenDocuments(settings: DevicetreeSettings): void {
    if (syntaxValidator) {
        vscode.workspace.textDocuments.forEach(document => {
            if (document.languageId === 'dts' && syntaxValidator) {
                if (settings.enableSyntaxValidation) {
                    syntaxValidator.validateDocument(document);
                } else {
                    syntaxValidator.clearDocument(document);
                }
            }
        });
    }

    if (formatterProvider) {
        formatterProvider.updateSettings(settings.maxLineLength);
    }

    if (diagnosticsProvider) {
        const provider = diagnosticsProvider;
        provider.updateSettings(settings.maxLineLength, settings.includeComments);
        vscode.workspace.textDocuments.forEach(document => {
            if (document.languageId !== 'dts') {
                return;
            }
            if (settings.enableWarnings) {
                void provider.analyzeDocument(document);
            } else {
                provider.clearDocument(document);
            }
        });
    }

    if (linkProvider) {
        linkProvider.updateSearchPaths(settings.includeSearchPaths);
    }
}

/**
 * Activate the extension
 * This method is called when your extension is activated
 * @param context The extension context
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function activate(context: vscode.ExtensionContext) {
    const settings = getSettings();

    linkProvider = new DtsDocumentLinkProvider(settings.includeSearchPaths);
    diagnosticsProvider = new DtsDiagnosticsProvider(
        settings.maxLineLength,
        settings.includeComments,
        linkProvider,
    );
    formatterProvider = new DtsFormatterProvider(settings.maxLineLength);
    syntaxValidator = new DtsSyntaxValidator();
    dtcValidator = new DtcValidator();

    context.subscriptions.push(
        vscode.languages.registerDocumentLinkProvider('dts', linkProvider)
    );

    context.subscriptions.push(
        vscode.languages.registerDocumentFormattingEditProvider('dts', formatterProvider)
    );

    context.subscriptions.push(diagnosticsProvider);
    registerCommands(context);
    registerDocumentListeners(context, settings);

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('devicetree')) {
                const newSettings = getSettings();
                refreshOpenDocuments(newSettings);
                // Re-register listeners with new settings
                clearDocumentListeners();
                registerDocumentListeners(context, newSettings);
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
    if (dtcValidator) {
        dtcValidator.dispose();
        dtcValidator = undefined;
    }
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
    disposeOutputChannel();
}
