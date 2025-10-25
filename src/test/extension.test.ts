import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { DtsFormatter } from '../dts';

suite('DeviceTree Extension Test Suite', () => {
    vscode.window.showInformationMessage('Running DeviceTree extension tests...');

    test('Extension should be present', () => {
        assert.ok(vscode.extensions.getExtension('andy9a9.vscode-devicetree'));
    });

    test('Extension should activate', async () => {
        const extension = vscode.extensions.getExtension('andy9a9.vscode-devicetree');
        assert.ok(extension);
        await extension?.activate();
        assert.strictEqual(extension?.isActive, true);
    });

    suite('Language Support Tests', () => {
        test('DeviceTree language should be registered', () => {
            const languages = vscode.languages.getLanguages();
            return languages.then((langs) => {
                assert.ok(langs.includes('dts'));
            });
        });

        test('DeviceTree files should be recognized', async () => {
            // Create a test document with .dts extension
            const doc = await vscode.workspace.openTextDocument({
                language: 'dts',
                content: '/dts-v1/;\n\n/ {\n\tmodel = "Test Device";\n};'
            });

            assert.strictEqual(doc.languageId, 'dts');
        });
    });

    suite('Formatter Tests', () => {
        // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
        function runFormatterTest(useTabs: boolean, expectedFileName: string, testName: string) {
            const inputPath = path.join(__dirname, '../../src/test/input.dts');
            const input = fs.readFileSync(inputPath, 'utf8');

            const tabSize = 8;
            const maxLineLength = 80;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const outputChannel = { appendLine: () => { } } as any;

            const formatter = new DtsFormatter(useTabs, tabSize, maxLineLength, outputChannel);
            const [result, formatResult] = formatter.format(input);

            assert.strictEqual(formatResult.success, true, formatResult.message);
            assert.ok(result.length > 0, 'Formatter should produce output');

            const expectedPath = path.join(__dirname, `../../src/test/${expectedFileName}`);
            const expected = fs.readFileSync(expectedPath, 'utf8');
            assert.strictEqual(result.trim(), expected.trim(), `${testName} output does not match expected`);
        }

        test('formats input.dts with tabs', () => {
            runFormatterTest(true, 'output-tabs.dts', 'Tab-formatted');
        });

        test('formats input.dts with spaces', () => {
            runFormatterTest(false, 'output-spaces.dts', 'Space-formatted');
        });
    });
});
