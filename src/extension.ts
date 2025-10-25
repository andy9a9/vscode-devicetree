'use strict';

// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
// Import the DtsFormatterProvider to register the formatter
import { DtsFormatterProvider } from './formatter';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function activate(context: vscode.ExtensionContext) {
    // Get configuration
    const maxLineLength = vscode.workspace.getConfiguration('devicetree').get<number>('maxLineLength', 80);

    // Register the formatter provider
    context.subscriptions.push(
        vscode.languages.registerDocumentFormattingEditProvider('dts', new DtsFormatterProvider(maxLineLength)),
    );
}

// This method is called when your extension is deactivated
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function deactivate() { }
