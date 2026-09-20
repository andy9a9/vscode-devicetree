import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

// Shared setup for all dtc validator tests
suiteSetup(async () => {
    const extension = vscode.extensions.getExtension('andy9a9.vscode-devicetree');
    if (extension && !extension.isActive) {
        await extension.activate();
    }
});

interface ToolBehavior {
    stdoutFromLastArg?: boolean;
    stdoutLines?: string[];
    stderrLines?: string[];
    exitCode: number;
}

suite('DTC Validator', () => {
    let tempDir: string;
    let cppPath: string;
    let dtcPath: string;
    let cppScriptPath: string;
    let dtcScriptPath: string;
    let originalDtcPath: unknown;
    let originalCppPath: unknown;
    let originalIncludeSearchPaths: unknown;

    suiteSetup(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-devicetree-dtc-test-'));

        const cppTool = await createNodeTool(tempDir, 'cpp');
        cppPath = cppTool.commandPath;
        cppScriptPath = cppTool.scriptPath;

        const dtcTool = await createNodeTool(tempDir, 'dtc');
        dtcPath = dtcTool.commandPath;
        dtcScriptPath = dtcTool.scriptPath;

        const config = vscode.workspace.getConfiguration('devicetree');
        originalDtcPath = config.get('DTCCompilerPath');
        originalCppPath = config.get('CPreprocessorPath');
        originalIncludeSearchPaths = config.get('includeSearchPaths');

        await config.update('DTCCompilerPath', dtcPath, vscode.ConfigurationTarget.Global);
        await config.update('CPreprocessorPath', cppPath, vscode.ConfigurationTarget.Global);
        await config.update('includeSearchPaths', [], vscode.ConfigurationTarget.Global);
    });

    suiteTeardown(async () => {
        const config = vscode.workspace.getConfiguration('devicetree');
        await config.update('DTCCompilerPath', originalDtcPath, vscode.ConfigurationTarget.Global);
        await config.update('CPreprocessorPath', originalCppPath, vscode.ConfigurationTarget.Global);
        await config.update('includeSearchPaths', originalIncludeSearchPaths, vscode.ConfigurationTarget.Global);
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    setup(async () => {
        await writeToolImplementation(cppScriptPath, {
            stdoutFromLastArg: true,
            exitCode: 0,
        });

        await writeToolImplementation(dtcScriptPath, {
            exitCode: 0,
        });
    });

    teardown(async () => {
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    });

    test('Should report a syntax error on the referenced line', async () => {
        await writeToolImplementation(dtcScriptPath, {
            stderrLines: [
                'Error: {lastArg}:3.5-8 syntax error',
                'FATAL ERROR: Unable to parse input tree',
            ],
            exitCode: 1,
        });

        const diagnostics = await validateDtcDocument('/dts-v1/;\n/ {\n\tbroken = <1 2>;\n};\n', diagnostics => diagnostics.length > 0);
        assert.strictEqual(diagnostics.length, 1);
        assert.strictEqual(diagnostics[0].severity, vscode.DiagnosticSeverity.Error);
        assert.strictEqual(diagnostics[0].range.start.line, 2);
        assert.ok(diagnostics[0].message.includes('syntax error'));
    });

    test('Should report dtc warnings on the matching line', async () => {
        await writeToolImplementation(dtcScriptPath, {
            stderrLines: [
                '{lastArg}:3.9-12: Warning (unit_address_vs_reg): /node@0: node has a unit name, but no reg or ranges property',
            ],
            exitCode: 0,
        });

        const diagnostics = await validateDtcDocument('/dts-v1/;\n/ {\n\tnode@0 {\n\t};\n};\n', diagnostics => diagnostics.length > 0);
        assert.strictEqual(diagnostics.length, 1);
        assert.strictEqual(diagnostics[0].severity, vscode.DiagnosticSeverity.Warning);
        assert.strictEqual(diagnostics[0].range.start.line, 2);
        assert.ok(diagnostics[0].message.includes('unit_address_vs_reg'));
    });

    test('Should clear previous diagnostics on rerun', async () => {
        await writeToolImplementation(dtcScriptPath, {
            stderrLines: [
                '{lastArg}:2.2-4: Warning (test_warning): first run warning',
            ],
            exitCode: 0,
        });

        const document = await openDtsDocument('/dts-v1/;\n/ {\n\tokay;\n};\n');
        await vscode.commands.executeCommand('devicetree.validateDTB');

        const firstRunDiagnostics = await waitForDtcDiagnostics(document.uri, diagnostics => diagnostics.length > 0);
        assert.strictEqual(firstRunDiagnostics.length, 1);
        assert.ok(firstRunDiagnostics[0].message.includes('first run warning'));

        await writeToolImplementation(dtcScriptPath, {
            exitCode: 0,
        });

        await vscode.commands.executeCommand('devicetree.validateDTB');

        const secondRunDiagnostics = await waitForDtcDiagnostics(document.uri, diagnostics => diagnostics.length === 0);
        assert.strictEqual(secondRunDiagnostics.length, 0);
    });
});

async function validateDtcDocument(
    content: string,
    predicate: (diagnostics: vscode.Diagnostic[]) => boolean,
): Promise<vscode.Diagnostic[]> {
    const document = await openDtsDocument(content);
    await vscode.commands.executeCommand('devicetree.validateDTB');
    return waitForDtcDiagnostics(document.uri, predicate);
}

async function openDtsDocument(content: string): Promise<vscode.TextDocument> {
    const document = await vscode.workspace.openTextDocument({
        language: 'dts',
        content,
    });
    await vscode.window.showTextDocument(document);
    return document;
}

async function waitForDtcDiagnostics(
    uri: vscode.Uri,
    predicate: (diagnostics: vscode.Diagnostic[]) => boolean,
): Promise<vscode.Diagnostic[]> {
    const timeoutMs = 5000;
    const intervalMs = 50;
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
        const diagnostics = getDtcDiagnostics(uri);
        if (predicate(diagnostics)) {
            return diagnostics;
        }
        await new Promise(resolve => setTimeout(resolve, intervalMs));
    }

    return getDtcDiagnostics(uri);
}

function getDtcDiagnostics(uri: vscode.Uri): vscode.Diagnostic[] {
    return vscode.languages.getDiagnostics(uri)
        .filter(diagnostic => diagnostic.source === 'dtc');
}

async function createNodeTool(dir: string, name: string): Promise<{ commandPath: string; scriptPath: string }> {
    const scriptPath = path.join(dir, `${name}.js`);
    const commandPath = process.platform === 'win32'
        ? path.join(dir, `${name}.cmd`)
        : path.join(dir, name);

    if (process.platform === 'win32') {
        const command = [
            '@echo off',
            `"${process.execPath}" "%~dp0${name}.js" %*`,
        ].join('\r\n');
        await fs.promises.writeFile(commandPath, `${command}\r\n`, 'utf8');
        return { commandPath, scriptPath };
    }

    const command = [
        '#!/bin/sh',
        `exec "${process.execPath}" "$0.js" "$@"`,
    ].join('\n');
    await fs.promises.writeFile(commandPath, `${command}\n`, { encoding: 'utf8', mode: 0o755 });
    await fs.promises.chmod(commandPath, 0o755);
    return { commandPath, scriptPath };
}

async function writeToolImplementation(scriptPath: string, behavior: ToolBehavior): Promise<void> {
    const content = [
        'const fs = require("fs");',
        'const args = process.argv.slice(2);',
        'const lastArg = args[args.length - 1] ?? "";',
        `const behavior = ${JSON.stringify(behavior)};`,
        'if (behavior.stdoutFromLastArg && lastArg) {',
        '  process.stdout.write(fs.readFileSync(lastArg, "utf8"));',
        '}',
        'for (const line of behavior.stdoutLines ?? []) {',
        '  process.stdout.write(formatLine(line, lastArg) + "\\n");',
        '}',
        'for (const line of behavior.stderrLines ?? []) {',
        '  process.stderr.write(formatLine(line, lastArg) + "\\n");',
        '}',
        'process.exit(behavior.exitCode);',
        'function formatLine(line, lastArg) {',
        '  return line.replaceAll("{lastArg}", lastArg);',
        '}',
    ].join('\n');

    await fs.promises.writeFile(scriptPath, `${content}\n`, 'utf8');
}