import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { DtsDocumentLinkProvider, parseIncludes } from '../links';

// Shared setup for all definition tests
suiteSetup(async () => {
    const extension = vscode.extensions.getExtension('andy9a9.vscode-devicetree');
    if (extension && !extension.isActive) {
        await extension.activate();
    }
});

suite('DTS Include Parser', () => {
    test('Should parse include with double quotes', async () => {
        const content = '#include "test.dtsi"\n/ {\n};';
        const doc = await vscode.workspace.openTextDocument({
            language: 'dts',
            content: content
        });

        const includes = parseIncludes(doc);
        assert.strictEqual(includes.length, 1);
        assert.strictEqual(includes[0].path, 'test.dtsi');
        assert.strictEqual(includes[0].line, 0);
    });

    test('Should parse include with angle brackets', async () => {
        const content = '#include <dt-bindings/gpio/gpio.h>\n/ {\n};';
        const doc = await vscode.workspace.openTextDocument({
            language: 'dts',
            content: content
        });

        const includes = parseIncludes(doc);
        assert.strictEqual(includes.length, 1);
        assert.strictEqual(includes[0].path, 'dt-bindings/gpio/gpio.h');
        assert.strictEqual(includes[0].line, 0);
    });

    test('Should parse multiple includes', async () => {
        const content = '#include "file1.dtsi"\n#include <file2.dtsi>\n/ {\n};';
        const doc = await vscode.workspace.openTextDocument({
            language: 'dts',
            content: content
        });

        const includes = parseIncludes(doc);
        assert.strictEqual(includes.length, 2);
        assert.strictEqual(includes[0].path, 'file1.dtsi');
        assert.strictEqual(includes[0].line, 0);
        assert.strictEqual(includes[1].path, 'file2.dtsi');
        assert.strictEqual(includes[1].line, 1);
    });

    test('Should calculate correct character positions', async () => {
        const content = '#include "test.dtsi"\n';
        const doc = await vscode.workspace.openTextDocument({
            language: 'dts',
            content: content
        });

        const includes = parseIncludes(doc);
        assert.strictEqual(includes.length, 1);
        assert.strictEqual(includes[0].startChar, 10); // After #include "
        assert.strictEqual(includes[0].endChar, 19);   // End position of "test.dtsi"
    });

    test('Should ignore non-include lines', async () => {
        const content = '/ {\n\tmodel = "test";\n\t#address-cells = <1>;\n};';
        const doc = await vscode.workspace.openTextDocument({
            language: 'dts',
            content: content
        });

        const includes = parseIncludes(doc);
        assert.strictEqual(includes.length, 0);
    });

    test('Should ignore include commented out with //', async () => {
        const content = '//#include "input-tabs.dts"\n/ {\n};';
        const doc = await vscode.workspace.openTextDocument({
            language: 'dts',
            content: content
        });

        const includes = parseIncludes(doc);
        assert.strictEqual(includes.length, 0);
    });

    test('Should ignore include commented out with // and space', async () => {
        const content = '// #include "input-tabs.dts"\n/ {\n};';
        const doc = await vscode.workspace.openTextDocument({
            language: 'dts',
            content: content
        });

        const includes = parseIncludes(doc);
        assert.strictEqual(includes.length, 0);
    });

    test('Should ignore include inside block comment', async () => {
        const content = '/*\n#include "input-xxx.dts"\n*/\n/ {\n};';
        const doc = await vscode.workspace.openTextDocument({
            language: 'dts',
            content: content
        });

        const includes = parseIncludes(doc);
        assert.strictEqual(includes.length, 0);
    });

    test('Should ignore include on same line as /* comment */', async () => {
        const content = '/* #include "input-xxx.dts" */\n/ {\n};';
        const doc = await vscode.workspace.openTextDocument({
            language: 'dts',
            content: content
        });

        const includes = parseIncludes(doc);
        assert.strictEqual(includes.length, 0);
    });

    test('Should parse active include while ignoring commented ones', async () => {
        const content = '#include "active.dtsi"\n//#include "commented.dtsi"\n/*\n#include "block-commented.dtsi"\n*/\n/ {\n};';
        const doc = await vscode.workspace.openTextDocument({
            language: 'dts',
            content: content
        });

        const includes = parseIncludes(doc);
        assert.strictEqual(includes.length, 1);
        assert.strictEqual(includes[0].path, 'active.dtsi');
    });

    test('Should handle includes with paths containing slashes', async () => {
        const content = '#include "vendor/board/board.dtsi"\n';
        const doc = await vscode.workspace.openTextDocument({
            language: 'dts',
            content: content
        });

        const includes = parseIncludes(doc);
        assert.strictEqual(includes.length, 1);
        assert.strictEqual(includes[0].path, 'vendor/board/board.dtsi');
    });
});

suite('DTS DocumentLink Provider - File Resolution', () => {
    test('Should find file relative to current directory', async () => {
        // Create a temporary workspace structure
        const tempDir = path.join(__dirname, '..', '..', 'test-workspace-resolve');

        try {
            fs.mkdirSync(tempDir, { recursive: true });
            fs.writeFileSync(path.join(tempDir, 'test.dtsi'), '/ {};');
            fs.writeFileSync(path.join(tempDir, 'main.dts'), '#include "test.dtsi"\n/ {};');

            const provider = new DtsDocumentLinkProvider([]);
            const result = await provider.findIncludedFile('test.dtsi', tempDir);

            assert.ok(result, 'Should find file in current directory');
            assert.ok(result.fsPath.endsWith('test.dtsi'));
        } finally {
            if (fs.existsSync(tempDir)) {
                fs.rmSync(tempDir, { recursive: true, force: true });
            }
        }
    });

    test('Should find file with path relative to current directory', async () => {
        const tempDir = path.join(__dirname, '..', '..', 'test-workspace-subdir');

        try {
            fs.mkdirSync(path.join(tempDir, 'subdir'), { recursive: true });
            fs.writeFileSync(path.join(tempDir, 'subdir', 'test.dtsi'), '/ {};');
            fs.writeFileSync(path.join(tempDir, 'main.dts'), '#include "subdir/test.dtsi"\n/ {};');

            const provider = new DtsDocumentLinkProvider([]);
            const result = await provider.findIncludedFile('subdir/test.dtsi', tempDir);

            assert.ok(result, 'Should find file in subdirectory');
            assert.ok(result.fsPath.includes(path.join('subdir', 'test.dtsi')));
        } finally {
            if (fs.existsSync(tempDir)) {
                fs.rmSync(tempDir, { recursive: true, force: true });
            }
        }
    });

    test('Should return null for non-existent file', async () => {
        const tempDir = path.join(__dirname, '..', '..', 'test-workspace-nonexist');

        try {
            fs.mkdirSync(tempDir, { recursive: true });

            const provider = new DtsDocumentLinkProvider([]);
            const result = await provider.findIncludedFile('nonexistent.dtsi', tempDir);

            assert.strictEqual(result, null);
        } finally {
            if (fs.existsSync(tempDir)) {
                fs.rmSync(tempDir, { recursive: true, force: true });
            }
        }
    });
});

suite('DTS Diagnostics - Include File Warnings', () => {
    let tempDir: string;

    suiteSetup(() => {
        tempDir = path.join(__dirname, '..', '..', 'test-workspace-diag');

        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }

        fs.mkdirSync(tempDir, { recursive: true });
        fs.writeFileSync(path.join(tempDir, 'existing.dtsi'), '/ {};');
    });

    suiteTeardown(() => {
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('Should warn for missing include file', async () => {
        const content = '#include "missing.dtsi"\n/ {\n};';
        const mainFile = path.join(tempDir, 'test-missing.dts');
        fs.writeFileSync(mainFile, content);

        const doc = await vscode.workspace.openTextDocument(mainFile);

        // Wait for diagnostics
        await new Promise(resolve => setTimeout(resolve, 600));

        const diagnostics = vscode.languages.getDiagnostics(doc.uri);
        const includeDiag = diagnostics.find(d => d.message.includes('was not found'));

        assert.ok(includeDiag, 'Should have diagnostic for missing include');
        assert.strictEqual(includeDiag.severity, vscode.DiagnosticSeverity.Warning);
    });

    test('Should not warn for existing include file', async () => {
        const content = '#include "existing.dtsi"\n/ {\n};';
        const mainFile = path.join(tempDir, 'test-exists.dts');
        fs.writeFileSync(mainFile, content);

        const doc = await vscode.workspace.openTextDocument(mainFile);

        // Wait for diagnostics
        await new Promise(resolve => setTimeout(resolve, 600));

        const diagnostics = vscode.languages.getDiagnostics(doc.uri);
        const includeDiag = diagnostics.find(d => d.message.includes('was not found'));

        assert.strictEqual(includeDiag, undefined, 'Should not have diagnostic for existing include');
    });

    test('Should warn for multiple missing includes', async () => {
        const content = '#include "missing1.dtsi"\n#include "missing2.dtsi"\n/ {\n};';
        const mainFile = path.join(tempDir, 'test-multiple.dts');
        fs.writeFileSync(mainFile, content);

        const doc = await vscode.workspace.openTextDocument(mainFile);

        // Wait for diagnostics
        await new Promise(resolve => setTimeout(resolve, 600));

        const diagnostics = vscode.languages.getDiagnostics(doc.uri);
        const includeDiags = diagnostics.filter(d => d.message.includes('was not found'));

        assert.strictEqual(includeDiags.length, 2, 'Should have warnings for both missing includes');
    });
});
